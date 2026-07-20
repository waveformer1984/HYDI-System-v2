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
import structuredLogger from '../../lib/structured-logger';

const logger = structuredLogger.child({ component: 'api/chat' });

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
        logger.warn('Claude agent failed, falling back to orchestrator', { error: claudeErr instanceof Error ? claudeErr.message : String(claudeErr) });
        // Fall through to legacy orchestrator
      }
    }

    // Fallback: legacy non-streaming orchestrator
    const orchestrator = new HeidiOrchestrator();
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
    logger.error('Chat API error', { error: error instanceof Error ? error.message : String(error) });
    const messageText = error instanceof Error ? error.message : 'Unknown error';
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Internal server error', message: messageText });
    }
    sse(res, { type: 'error', error: messageText });
    return res.end();
  }
}
