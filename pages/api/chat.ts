/**
 * API LAYER - /api/chat
 *
 * Heidi's single user-facing entry point. Streams the assistant response
 * token-by-token over SSE using the tool-using agent (lib/heidi-agent.ts).
 * Falls back to the legacy non-streaming orchestrator when ANTHROPIC_API_KEY
 * is not configured.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { isClaudeAvailable } from '../../lib/claude';
import { runHeidiAgentStream } from '../../lib/heidi-agent';
import { HeidiOrchestrator } from '../../lib/orchestrator';

/**
 * Detect system-state questions that HEIDI should answer from live runtime
 * state rather than LLM inference. This prevents hallucination about the
 * system's own status and provides instant, accurate responses.
 */
function trySystemStateResponse(message: string, orchestrator: HeidiOrchestrator): string | null {
  const lower = message.toLowerCase().trim();

  // Pattern matching for system-state queries
  const isStateQuery =
    /\b(pid|daemon|cycle|uptime|status|health|capability|blocked|ready|unavailable)\b/i.test(lower) &&
    /\b(what|current|your|system|heidi|daemon|show|tell|give)\b/i.test(lower);

  const isProtoForgeQuery = /\bprotoforge\b/i.test(lower) && /\b(what|your|port|service|running|do)\b/i.test(lower);

  const isRevenueQuery = /\b(revenue|prospect|opportunity|customer|payment|pipeline)\b/i.test(lower) &&
    /\b(what|current|show|tell|how many|status)\b/i.test(lower);

  const isCapabilityQuery = /\b(what can you do|capabilities|abilities|blocked|credentials)\b/i.test(lower);

  if (!isStateQuery && !isProtoForgeQuery && !isRevenueQuery && !isCapabilityQuery) {
    return null;
  }

  // Gather live state
  const parts: string[] = [];

  try {
    const daemon = orchestrator.getDaemonStatus();
    if (daemon.running) {
      const uptime = daemon.startedAt
        ? `${Math.round((Date.now() - new Date(daemon.startedAt).getTime()) / 3600000)}h ${Math.round((Date.now() - new Date(daemon.startedAt).getTime()) % 3600000 / 60000)}m`
        : 'unknown';
      parts.push(`Daemon: running, PID ${daemon.pid}, ${daemon.selfSufficiencyCycles} self-sufficiency cycles, uptime ${uptime}.`);
      if (daemon.lastCapabilityHealth) {
        const h = daemon.lastCapabilityHealth;
        parts.push(`Capability health: ${h.ready} ready, ${h.blocked} blocked, ${h.unavailable} unavailable (of ${h.total} total).`);
      }
      if (daemon.lastSelfRepairResult) {
        const r = daemon.lastSelfRepairResult;
        parts.push(`Last self-repair cycle: ${r.totalIssues} issues, ${r.workedAround} worked around, ${r.escalated} escalated, ${r.repaired} repaired.`);
      }
    } else {
      parts.push(`Daemon: not running.`);
    }
  } catch { /* ignore */ }

  if (isProtoForgeQuery) {
    parts.push(`ProtoForge: the policy/governance engine in the HYDI six-layer pipeline (Ingestion → RAW LEDGER → CASCADE → KILO → ProtoForge → Emission). Running as protoforge-core on port 3005. It evaluates KILO hypotheses against policy rules and approves, rejects, or escalates them. It is NOT related to Protocol Buffers or any external project of the same name.`);
  }

  if (isCapabilityQuery) {
    parts.push(`I am HEIDI, the governed cognitive operator for HYDI System v2. I run a continuous self-sufficiency loop that monitors capability health, works around blockers, and escalates issues that need human action. I can answer questions about system state, manage the cognitive loop, and execute governed actions within my authorization level.`);
  }

  // Add blocked capabilities if asked about health/capabilities
  if (isStateQuery || isCapabilityQuery) {
    try {
      const health = orchestrator.getDaemonStatus();
      if (health.lastCapabilityHealth && health.lastCapabilityHealth.blocked > 0) {
        parts.push(`The ${health.lastCapabilityHealth.blocked} blocked capabilities require external credentials (Stripe, SendGrid, Google Places, Twilio) that need human provisioning. I work around them rather than fabricating availability.`);
      }
    } catch { /* ignore */ }
  }

  if (isRevenueQuery) {
    parts.push(`Revenue information is available in the System Status tab. The revenue dashboard shows prospects, opportunities, pipeline value, customers, and verified revenue from the live database.`);
  }

  parts.push(`Services: protoforge-core (port 3005), heidi-web (port 3000), heidi-mobile-chat (port 3006), Ollama (port 11434), Supabase DB (port 54322).`);

  return parts.join(' ');
}

interface ChatRequest {
  message: string;
  session_id: string;
  user_id: string;
}

function sse(res: NextApiResponse, payload: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message, session_id, user_id }: ChatRequest = req.body;
  if (!message || !session_id || !user_id) {
    return res.status(400).json({ error: 'Missing required fields: message, session_id, user_id' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  try {
    // Intercept system-state questions and answer from live runtime state
    // rather than LLM inference. This prevents hallucination about the
    // system's own status and provides instant, accurate responses.
    const orchestrator = new HeidiOrchestrator();
    const stateResponse = trySystemStateResponse(message, orchestrator);
    if (stateResponse) {
      sse(res, { type: 'metadata', model_used: 'heidi-runtime', latency: 0 });
      sse(res, { type: 'content', content: stateResponse });
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    if (isClaudeAvailable()) {
      try {
        // Streaming, tool-using path
        const result = await runHeidiAgentStream({
          message,
          sessionId: session_id,
          userId: user_id,
          onText: (delta) => sse(res, { type: 'content', content: delta }),
          onTool: (event) => sse(res, { type: 'tool', tool: event }),
        });

        sse(res, { type: 'metadata', model_used: result.model });
        sse(res, { type: 'actions', actions: result.actions });
        res.write('data: [DONE]\n\n');
        return res.end();
      } catch (claudeErr) {
        console.warn('Claude agent failed, falling back to orchestrator:', claudeErr instanceof Error ? claudeErr.message : claudeErr);
        // Fall through to legacy orchestrator
      }
    }

    // Fallback: legacy non-streaming orchestrator (reuse instance from above)
    const response = await orchestrator.processChat({ message, session_id, user_id });

    sse(res, {
      type: 'metadata',
      model_used: response.model_used,
      latency: response.latency,
      session_state: response.session_state,
    });
    sse(res, { type: 'content', content: response.response });
    if (response.actions?.length) {
      sse(res, { type: 'actions', actions: response.actions });
    }
    res.write('data: [DONE]\n\n');
    return res.end();
  } catch (error) {
    console.error('Chat API error:', error);
    const messageText = error instanceof Error ? error.message : 'Unknown error';
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Internal server error', message: messageText });
    }
    sse(res, { type: 'error', error: messageText });
    return res.end();
  }
}
