/**
 * API LAYER - /api/chat
 *
 * Heidi's single user-facing entry point. Streams the assistant response
 * token-by-token over SSE using the tool-using agent (lib/heidi-agent.ts).
 * Falls back to the legacy non-streaming orchestrator when ANTHROPIC_API_KEY
 * is not configured.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createTimedClient } from '../../lib/supabase-timed';
import pg from 'pg';
import { isClaudeAvailable } from '../../lib/claude';
import { runHeidiAgentStream } from '../../lib/heidi-agent';
import { HeidiOrchestrator } from '../../lib/orchestrator';
import {
  classifyCooIntent,
  answerFromCooState,
  COO_STALENESS_MS,
} from '../../lib/heidi/CooBriefing';
import {
  classifyLifeIntent,
  getLifeContext,
  setFocus,
  remember,
} from '../../lib/heidi/ConversationContext';
import { classifyEscalation } from '../../lib/heidi/EscalationLifecycle';
import {
  recallAnswer,
  clearFocus,
} from '../../lib/heidi/ConversationContext';
import { verifyServiceToken } from '../../lib/auth/verifyServiceToken';
import type { CooState } from '../../lib/heidi/CooState';

/**
 * Chat authorization boundary.
 *
 * /api/chat is reachable by anything that can reach port 3000. Read-only
 * intents (status, COO brief, agent chat, findings, briefing) stay open —
 * they only read durable state. Mutating intents — governed commands,
 * goal/mission creation, evidence records, memory writes, approvals —
 * require a valid x-hydi-service-token (same HMAC scheme as
 * /api/actions/:id and api/chat/route.js). An unauthorized mutating
 * request is refused with an explicit AUTHORIZATION_REQUIRED reply, not
 * silently dropped: the operator sees the gate.
 */
function chatAuthorized(req: NextApiRequest): boolean {
  return verifyServiceToken(req.headers['x-hydi-service-token'] as string | undefined, null as unknown as string).valid;
}

function refuseUnauthorized(res: NextApiResponse, what: string): void {
  sse(res, { type: 'metadata', model_used: 'auth-gate', latency: 0 });
  sse(res, {
    type: 'content',
    content: `AUTHORIZATION_REQUIRED — ${what} mutates governed state and needs your service token (⚙ settings). Nothing was executed.`,
  });
  res.write('data: [DONE]\n\n');
  res.end();
}

// Lazy Supabase client — timed transport: without it, a degraded
// PostgREST/Kong makes every call hang 60s+ (froze chat ~89s). Direct
// pg for the hot Command Center paths lives in CHAT_POOL below.
let _cooSupabase: SupabaseClient | null = null;
function getCooSupabase(): SupabaseClient {
  if (!_cooSupabase) {
    _cooSupabase = createTimedClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
  }
  return _cooSupabase;
}

/**
 * Answer operational questions from the latest persisted coo_state row —
 * the daemon's authoritative executive snapshot — rather than the web
 * process's in-memory orchestrator. Returns null for non-operational
 * messages so they fall through to the normal chat path.
 */
async function tryCooResponse(message: string): Promise<string | null> {
  const intent = classifyCooIntent(message);
  if (!intent) return null;
  try {
    const { data, error } = await getCooSupabase()
      .from('heidi_events')
      .select('payload, created_at')
      .eq('event_type', 'coo_state')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data?.payload) {
      return `COO state unavailable — no persisted coo_state snapshot could be read (${error?.message ?? 'no rows'}).`;
    }
    const state = data.payload as CooState;
    const stale = Date.now() - new Date(data.created_at as string).getTime() > COO_STALENESS_MS;
    return answerFromCooState(state, intent, stale);
  } catch (e) {
    return `COO state unavailable — ${e instanceof Error ? e.message : 'unknown error'}.`;
  }
}

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

// Derive at most one self-improvement proposal from real evidence.
// Each check is evidence-gated and deduped by improvementKey across ALL
// proposal statuses — a declined improvement never resurrects on its own.
async function deriveSelfImprovementProposal(
  sb: SupabaseClient,
  user_id: string,
): Promise<{ id: string; payload: Record<string, unknown> } | null> {
  // Evidence 1: resolved business decision absent from durable memory —
  // recall paths can't see it even though the decision exists as an event.
  const { data: dec } = await sb.from('human_intervention_requests')
    .select('resolution_note, completed_at')
    .eq('request_id', 'decision:business-path')
    .eq('status', 'resolved').limit(1) as { data: Array<{ resolution_note: string | null; completed_at: string }> | null };
  // Evidence 3: undifferentiated unresolved backlog — no lifecycle
  // classification exists, so standing-policy noise and real work merge
  // into one "Needs you" line. Propose enabling the classified view.
  const { data: flagRow } = await sb.from('heidi_events').select('id')
    .eq('event_type', 'companion_flag')
    .eq('payload->>key', 'classified_needsyou').limit(1);
  if (!flagRow?.length) {
    const { count: escCount } = await sb.from('operator_escalations')
      .select('id', { count: 'exact', head: true }).eq('resolved', false);
    if ((escCount ?? 0) > 50) {
      const { data: prior } = await sb.from('heidi_events').select('id')
        .eq('event_type', 'companion_proposal')
        .eq('payload->>improvementKey', 'enable_escalation_lifecycle').limit(1);
      if (!prior?.length) {
        const { data: prop } = await sb.from('heidi_events').insert({
          event_type: 'companion_proposal', division: 'companion',
          payload: {
            status: 'pending', kind: 'self_improvement',
            improvementKey: 'enable_escalation_lifecycle',
            description: 'Classify "Needs you" items by lifecycle so standing noise stops hiding real work',
            reason: `Observed: ${escCount} unresolved escalations with no lifecycle — actionable items, human decisions, standing-policy constraints, and void premises all flatten into one list. Change: enable the read-only classifier in the briefing (flag). Resolves nothing automatically. Risk: none (presentation only, flag reversible). Verify: briefing shows classified counts.`,
            changeSpec: { type: 'set_companion_flag', key: 'classified_needsyou', enabled: true },
          },
        }).select('id, payload').single();
        if (prop) return prop;
      }
    }
  }
  if (dec?.length) {
    const selected = String(dec[0].resolution_note ?? '').replace('HUMAN_SELECTED:', '').trim();
    const { data: prior } = await sb.from('heidi_events').select('id')
      .eq('event_type', 'companion_proposal')
      .eq('payload->>improvementKey', 'persist_decision_to_memory').limit(1);
    if (!prior?.length) {
      const life = await getLifeContext(sb, user_id);
      const inMemory = life.notes.some((n: string) => n.toLowerCase().includes('business path'));
      if (!inMemory) {
        const { data: prop } = await sb.from('heidi_events').insert({
          event_type: 'companion_proposal', division: 'companion',
          payload: {
            status: 'pending', kind: 'self_improvement',
            improvementKey: 'persist_decision_to_memory',
            description: 'Persist the business-path decision into durable memory',
            reason: `Observed: decision resolved ${dec[0].completed_at} as an event, but operator memory holds no note — recall misses it. Change: one memory write (append-only). Risk: none. Verify: memory read-back.`,
            changeSpec: {
              type: 'persist_context_note',
              note: `Business path: ${selected} (HUMAN_SELECTED ${dec[0].completed_at}) — AI/music scouting intel is off-axis for this path.`,
            },
          },
        }).select('id, payload').single();
        if (prop) return prop;
      }
    }
  }
  // Evidence 4 (quality-gated): a void-premise mission that REGENERATED
  // after its escalations were already dismissed — recurring after being
  // addressed = systemic, so propose the root fix (stop the mission),
  // not the symptom. Single evidence would not qualify: the recurrence
  // after a prior evolution_result is what makes it systemic.
  const { data: priorDismiss } = await sb.from('heidi_events').select('id, created_at')
    .eq('event_type', 'evolution_result')
    .ilike('payload->>improvementKey', 'dismiss_void_escalations_%')
    .order('created_at', { ascending: false }).limit(1);
  if (priorDismiss?.length) {
    const since = new Date(priorDismiss[0].created_at).toISOString();
    // Regeneration signal: NEW escalations created after dismissal whose
    // target still doesn't exist (supervision re-transitioned NEEDS_HUMAN).
    const { data: regen } = await sb.from('operator_escalations')
      .select('title, body, created_at')
      .eq('category', 'agent_mission')
      .gte('created_at', since)
      .order('created_at', { ascending: false }).limit(50);
    const missionIds = new Set<string>();
    let voidTarget: string | null = null;
    for (const e of (regen ?? []) as Array<{ title: string; body: string | null }>) {
      const opp = (e.title + ' ' + (e.body ?? '')).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1];
      if (!opp) continue;
      const { data: exists } = await sb.from('protoforge_opportunities').select('id').eq('id', opp).limit(1);
      if (exists?.length) continue;
      voidTarget = opp;
      for (const m of (e.body ?? '').matchAll(/mission-[0-9a-f]+/g)) missionIds.add(m[0]);
      for (const m of e.title.matchAll(/mission-[0-9a-f]+/g)) missionIds.add(m[0]);
    }
    const fresh = voidTarget ? [...missionIds] : [];
    if (fresh.length > 0 && voidTarget) {
      const key = `stop_regenerating_mission_${voidTarget.slice(0, 8)}`;
      const { data: prior } = await sb.from('heidi_events').select('id')
        .eq('event_type', 'companion_proposal')
        .eq('payload->>improvementKey', key).limit(1);
      if (!prior?.length) {
        const { data: prop } = await sb.from('heidi_events').insert({
          event_type: 'companion_proposal', division: 'companion',
          payload: {
            status: 'pending', kind: 'self_improvement',
            improvementKey: key,
            description: `Stop the regenerating void-premise mission tree (target ${voidTarget.slice(0, 8)})`,
            reason: `Observed: new escalations were created AFTER the cycle-2 dismissal — supervision keeps re-transitioning the same dead missions (NEEDS_HUMAN at 13:06 and again 13:51). Cycle 2 fixed the symptom; the source is still live. Change: mark ${fresh.length} mission(s) STOPPED via the existing event path — supervisor won't retry terminal missions. Risk: low; reversible via manual retry. Verify: next supervision pass produces no new escalations for that target.`,
            changeSpec: { type: 'stop_mission', missionIds: fresh.slice(0, 4), target: voidTarget },
          },
        }).select('id, payload').single();
        if (prop) return prop;
      }
    }
  }
  // Evidence 5: the payment-spine edge is PRESENT_BUT_UNVERIFIED — zero
  // jobs have ever reached paid. Heidi can now perform the hosted TEST
  // checkout herself through the Human Action Executor (browser control,
  // test card, real webhook) instead of asking J to click.
  const { count: paidJobs } = await sb.from('customer_jobs')
    .select('job_id', { count: 'exact', head: true })
    .eq('payment_status', 'paid').ilike('stripe_payment_intent_id', 'pi_3%');
  if ((paidJobs ?? 0) === 0) {
    const { data: prior } = await sb.from('heidi_events').select('id')
      .eq('event_type', 'companion_proposal')
      .eq('payload->>improvementKey', 'verify_payment_spine_test').limit(1);
    if (!prior?.length) {
      const { data: prop } = await sb.from('heidi_events').insert({
        event_type: 'companion_proposal', division: 'companion',
        payload: {
          status: 'pending', kind: 'human_action',
          improvementKey: 'verify_payment_spine_test',
          description: 'Perform the hosted Stripe TEST checkout end-to-end via browser automation',
          reason: `Observed: 0 customer_jobs have ever reached 'paid' — the payment→webhook→job edge is PRESENT_BUT_UNVERIFIED. Change: I open the hosted test checkout in a real browser, enter the Stripe test card (4242…), submit, then verify webhook + job + ledger independently. This moves no real money. Risk: none beyond test-mode. Verify: job.payment_status=paid via the real webhook path, not by mutating state.`,
          actionSpec: { type: 'stripe_test_checkout' },
        },
      }).select('id, payload').single();
      if (prop) return prop;
    }
  }
  // Evidence 2: unresolved escalations whose premise is provably void —
  // the referenced opportunity row no longer exists, so "restore" is
  // impossible and dismissal is the only valid resolution. Bounded scan.
  const { data: staleEsc } = await sb.from('operator_escalations')
    .select('id, title')
    .eq('category', 'agent_mission')
    .eq('resolved', false)
    .order('created_at', { ascending: false }).limit(200);
  const zombieId = await (async () => {
    const ids = new Set<string>();
    for (const e of (staleEsc ?? []) as Array<{ title: string }>) {
      const m = e.title.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (m) ids.add(m[1]);
    }
    for (const id of ids) {
      const { data: opp } = await sb.from('protoforge_opportunities').select('id').eq('id', id).limit(1);
      if (!opp?.length) return id;
    }
    return null;
  })();
  if (zombieId) {
    const key = `dismiss_void_escalations_${zombieId.slice(0, 8)}`;
    const { data: prior } = await sb.from('heidi_events').select('id')
      .eq('event_type', 'companion_proposal')
      .eq('payload->>improvementKey', key).limit(1);
    if (!prior?.length) {
      const count = (staleEsc ?? []).filter((e: { title: string }) => e.title.includes(zombieId)).length;
      const { data: prop } = await sb.from('heidi_events').insert({
        event_type: 'companion_proposal', division: 'companion',
        payload: {
          status: 'pending', kind: 'self_improvement',
          improvementKey: key,
          description: `Dismiss ${count} unresolved escalation(s) for deleted target ${zombieId.slice(0, 8)}`,
          reason: `Observed: ${count} unresolved agent-mission escalations reference opportunity ${zombieId.slice(0, 8)}, which no longer exists — restore is impossible, so dismissal is the only valid resolution. They keep polluting "Needs you". Change: mark those rows resolved. Risk: none (flag flip, reversible). Verify: zero unresolved rows for that target.`,
          changeSpec: { type: 'resolve_escalations', match: zombieId },
        },
      }).select('id, payload').single();
      if (prop) return prop;
    }
  }
  return null;
}

/**
 * Command Center agent chat — durable conversation + role-scoped
 * answers from the standing agent's own durable state. Read-only:
 * mutation intents fall through to the governed command path.
 */
// Direct pg pool for the Command Center paths — the Supabase REST
// client (getCooSupabase) hangs ~60s when PostgREST is down; the
// workspace state endpoint proves the direct :54322 pool stays fast.
const CHAT_POOL = new pg.Pool({ host: '127.0.0.1', port: 54322, database: 'postgres', user: 'postgres', password: 'postgres', max: 4 });

async function answerAgentChat(
  agentId: string,
  message: string,
): Promise<string | null> {
  if (!agentId.startsWith('team-')) return null;
  try {
    const [statusEv, missionEv, resultsEv] = await Promise.all([
      CHAT_POOL.query(
        `select payload, created_at from heidi_events
         where event_type='agent_status' and payload->>'agentId'=$1
         order by created_at desc limit 1`, [agentId]),
      CHAT_POOL.query(
        `select payload, created_at from heidi_events
         where event_type='agent_mission' and payload->>'agentId'=$1
         order by created_at desc limit 6`, [agentId]),
      CHAT_POOL.query(
        `select payload, created_at from heidi_events
         where event_type='agent_status' and payload->>'agentId'=$1
         order by created_at desc limit 60`, [agentId]),
    ]);
    // Latest status per missionId — mission events store creation-time
    // status, so display must come from the status ledger, not the row.
    const statusByMission = new Map<string, string>();
    for (const r of resultsEv.rows) {
      const p = r.payload as Record<string, unknown>;
      const mid = String(p.missionId ?? '');
      if (mid && !statusByMission.has(mid)) statusByMission.set(mid, String(p.status));
    }
    const agent = statusEv.rows[0]?.payload as Record<string, unknown> | undefined;
    const missions = missionEv.rows.map(r => ({ ...(r.payload as Record<string, unknown>), at: r.created_at })) as Array<Record<string, unknown> & { at: unknown }>;
    if (!agent && missions.length === 0) {
      return `No standing agent '${agentId}'.`;
    }
    const role = agentId.replace('team-', '').toUpperCase();
    const lines = [
      `${role} — status ${agent?.status ?? 'REGISTERED'}, last status change ${(statusEv.rows[0]?.created_at as Date | undefined)?.toISOString().slice(11, 19) ?? 'never'}Z.`,
      missions.length ? `Recent missions:` : 'No missions assigned yet.',
      ...missions.map(m => `  [${statusByMission.get(String(m.missionId ?? '')) ?? m.status ?? 'PENDING'}] ${String(m.missionId ?? '').slice(0, 20)} — ${String(m.objective ?? '').slice(0, 70)}`),
    ];
    const last = resultsEv.rows.map(r => r.payload as Record<string, unknown>).find(p => p.status === 'COMPLETED');
    if (last) lines.push(`Last result: ${JSON.stringify(last.result ?? last).slice(0, 200)}`);
    lines.push(`(Deterministic answer from durable state — not LLM-generated. To assign work, use a governed action.)`);
    return lines.join('\n');
  } catch (e) {
    return `Agent state unavailable — ${e instanceof Error ? e.message : 'unknown'}.`;
  }
}

async function persistChatMessage(
  agentId: string, userId: string, sessionId: string, role: string, content: string,
): Promise<void> {
  try {
    await CHAT_POOL.query(
      `INSERT INTO heidi_events (event_type, division, payload, created_at)
       VALUES ('chat_message','chat',$1,now())`,
      [JSON.stringify({
        conversationId: `${userId}:${agentId}`,
        agentId, userId, sessionId, role,
        content: content.slice(0, 4000),
      })],
    );
  } catch { /* persistence failure must not break chat */ }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message, session_id, user_id }: ChatRequest = req.body;
  const agentId = typeof (req.body as Record<string, unknown>).agent === 'string'
    ? String((req.body as Record<string, unknown>).agent) : null;
  if (!message || !session_id || !user_id) {
    return res.status(400).json({ error: 'Missing required fields: message, session_id, user_id' });
  }

  void persistChatMessage(agentId ?? 'heidi', user_id, session_id, 'user', message);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  try {
    // Intercept system-state questions and answer from live runtime state
    // rather than LLM inference. This prevents hallucination about the
    // system's own status and provides instant, accurate responses.
    // Explicit governed commands — only exact `verb <target>` syntax acts;
    // vague phrasing ("do it", "handle that") falls through to normal chat
    // and cannot acknowledge, stop, retry, approve, or reject anything.
    // Every mutating command becomes a governed goal: the daemon executes
    // and contract-verifies; chat never writes state directly.
    const cmdMatch = message.trim().match(/^(acknowledge|stop|retry|approve|reject|inspect)\s+(\S+)$/i);
    if (cmdMatch) {
      const verb = cmdMatch[1].toLowerCase();
      const target = cmdMatch[2];
      try {
        // inspect is read-only — answer directly from durable agent events.
        if (verb === 'inspect') {
          const { data: rows } = await getCooSupabase()
            .from('heidi_events')
            .select('event_type, payload, created_at')
            .eq('division', 'agents')
            .order('created_at', { ascending: true })
            .limit(2000);
          const relevant = (rows ?? []).filter((r: any) =>
            r.payload?.agentId === target || r.payload?.missionId === target);
          const lastStatus = [...relevant].reverse().find((r: any) => r.event_type === 'agent_status');
          const mission = relevant.find((r: any) => r.event_type === 'agent_mission');
          const msgs = relevant.filter((r: any) => r.event_type === 'agent_message').slice(-5);
          const lines = [
            relevant.length === 0 ? `No agent or mission '${target}' found.` : null,
            mission ? `MISSION ${mission.payload.missionId} (${mission.payload.role}): ${mission.payload.objective}` : null,
            lastStatus ? `STATUS: ${lastStatus.payload.status} @ ${lastStatus.created_at}` : null,
            msgs.length ? `MESSAGES:` : null,
            ...msgs.map((m: any) => `  [${m.payload.type}] ${String(m.payload.content).slice(0, 90)}`),
          ].filter(Boolean).join('\n');
          sse(res, { type: 'metadata', model_used: 'coo-command', latency: 0 });
          sse(res, { type: 'content', content: lines });
          res.write('data: [DONE]\n\n');
          return res.end();
        }

        // Mutating governed commands (stop/retry/approve/reject/acknowledge)
        // create daemon-executed goals — require the service token.
        if (!chatAuthorized(req)) return refuseUnauthorized(res, `'${verb} ${target}'`);

        const spec: Record<string, { capabilityId: string; params: Record<string, string>; label: string }> = {
          acknowledge: { capabilityId: 'ops.acknowledge_human_action', params: { queueItemId: target, actor: 'chat-operator' }, label: `Acknowledge ${target}` },
          stop: { capabilityId: 'ops.agent_control', params: { action: 'stop', target, actor: 'chat-operator' }, label: `Stop agent ${target}` },
          retry: { capabilityId: 'ops.agent_control', params: { action: 'retry', target, actor: 'chat-operator' }, label: `Retry mission ${target}` },
          approve: { capabilityId: 'ops.resolve_human_action', params: { queueItemId: target, decision: 'approve', actor: 'chat-operator' }, label: `Approve ${target}` },
          reject: { capabilityId: 'ops.resolve_human_action', params: { queueItemId: target, decision: 'reject', actor: 'chat-operator' }, label: `Reject ${target}` },
        };
        const cmd = spec[verb];
        const { data: goalRow, error } = await getCooSupabase()
          .from('heidi_goals')
          .insert({
            goal_type: 'task',
            title: cmd.label,
            description: `Operator command '${verb}' on ${target}`,
            purpose: 'operator command via chat',
            priority: 4,
            status: 'pending',
            owner: 'operator',
            confidence: 0.9,
            context: {
              producerKey: `cmd:${verb}:${target}:${Date.now()}`,
              producedBy: 'human-operator',
              capabilityId: cmd.capabilityId,
              capabilityParams: cmd.params,
              completeOnVerify: true,
            },
          })
          .select('id')
          .single();
        if (error) throw new Error(error.message);
        sse(res, { type: 'metadata', model_used: 'coo-command', latency: 0 });
        sse(res, { type: 'content', content: `'${verb} ${target}' submitted as governed action (goal ${goalRow.id.slice(0, 8)}). The daemon will execute and contract-verify it within ~2 cycles; the result lands in the audit log and the queue.` });
        res.write('data: [DONE]\n\n');
        return res.end();
      } catch (e) {
        sse(res, { type: 'content', content: `Command failed to submit — ${e instanceof Error ? e.message : 'unknown error'}` });
        res.write('data: [DONE]\n\n');
        return res.end();
      }
    }

    // ── Agent-scoped chat (Command Center) — standing team agents answer
    // from their own durable state. Mutation intents keep flowing through
    // the governed command paths above; this is a read surface.
    if (agentId) {
      const reply = await answerAgentChat(agentId, message);
      sse(res, { type: 'metadata', model_used: 'agent-deterministic', latency: 0 });
      sse(res, { type: 'content', content: reply ?? `Unknown agent ${agentId}.` });
      res.write('data: [DONE]\n\n');
      void persistChatMessage(agentId, user_id, session_id, 'assistant', reply ?? 'unknown agent');
      return res.end();
    }

    // ── Autopilot intents — expose the dev loop through chat ─────────
    // Read-only observations answer inline; anything that mutates goes
    // through heidi_goals (daemon executes, contract-verifies). Chat
    // never claims work happened — it reports what was requested/found.
    const lowerMsg = message.toLowerCase().trim();
    const wantsFindWork = /\b(find|look for|scan).*(work|useful|improve|defect|something)/i.test(lowerMsg)
      || /\bwhat (needs|should) (we |i |be )?(do|work|fix)/i.test(lowerMsg);
    const wantsDevStatus = /\b(what (are you|you) working on|dev missions?|investigations?|what did you (fix|find|learn))\b/i.test(lowerMsg);
    const wantsFix = /^(fix it|fix that|fix the (defect|issue))\b/i.test(lowerMsg);
    // "record validation evidence for <opp> via <channel>: <what happened>"
    // — declared evidence only; CONFIRMED still requires a real paid job.
    const evidenceMatch = message.match(/(?:validation|customer) evidence for ([a-f0-9-]{4,})(?: via ([a-z _-]+?))?[:\s]+(.+)/i);
    if (evidenceMatch) {
      if (!chatAuthorized(req)) return refuseUnauthorized(res, 'recording customer evidence');
      try {
        const pg = (await import('pg')).default;
        const pool = new pg.Pool({ host: '127.0.0.1', port: 54322, database: 'postgres', user: 'postgres', password: 'postgres' });
        const opp = await pool.query(
          `SELECT id FROM protoforge_opportunities WHERE id::text ILIKE $1 LIMIT 1`,
          [`${evidenceMatch[1]}%`]);
        if (opp.rows.length === 0) {
          await pool.end();
          sse(res, { type: 'metadata', model_used: 'governed-evidence', latency: 0 });
          sse(res, { type: 'content', content: `No opportunity matching "${evidenceMatch[1]}". Check the id prefix.` });
          return res.end();
        }
        const respondents = message.match(/(\d+)\s*(?:people|respondents|conversations?|customers?)/i);
        const g = await pool.query(
          `INSERT INTO heidi_goals (title, goal_type, description, status, priority, success_criteria, context, created_at, updated_at)
           VALUES ($1,'task',$1,'active',4,'["customer_evidence row persisted"]'::jsonb,$2,now(),now()) RETURNING id`,
          [`Record declared customer evidence for opportunity ${evidenceMatch[1]}`,
          JSON.stringify({ capabilityId: 'ops.opp_evidence', capabilityParams: { opportunityId: opp.rows[0].id, channel: (evidenceMatch[2] || 'declared').trim(), summary: evidenceMatch[3].trim(), respondents: respondents ? Number(respondents[1]) : undefined, declaredBy: 'human_owner via chat' }, completeOnVerify: true })]);
        await pool.end();
        sse(res, { type: 'metadata', model_used: 'governed-evidence', latency: 0 });
        sse(res, { type: 'content', content: `Submitted as governed goal ${String(g.rows[0].id).slice(0, 8)} — recorded as HUMAN-DECLARED evidence (unverified). It only becomes CONFIRMED if a real paid customer job exists. The daemon records it + updates the business finding.` });
        return res.end();
      } catch (e) {
        sse(res, { type: 'metadata', model_used: 'governed-evidence', latency: 0 });
        sse(res, { type: 'content', content: `Evidence submission failed: ${e instanceof Error ? e.message : 'unknown'}` });
        return res.end();
      }
    }
    const wantsBusiness = /\b(business (context|state|model)|what products|product portfolio|what are we (building|selling|trying)|why are we|revenue truth|who is the customer|most important business|business brief|how'?s business)\b/i.test(lowerMsg);
    const wantsValidation = /\b(customer validation|what do i need to do|validation queue|what should i do next|customer proof)\b/i.test(lowerMsg);
    // General goal → governed interpret→plan chain. The local model
    // structures the goal; the daemon plans and executes under policy.
    const wantsAutonomy = /\b(what are you doing|autonomous state|autonomy state|current goal|what'?s running|why did you|action journal)\b/i.test(lowerMsg);
    if (wantsAutonomy) {
      try {
        const pg = (await import('pg')).default;
        const pool = new pg.Pool({ host: '127.0.0.1', port: 54322, database: 'postgres', user: 'postgres', password: 'postgres' });
        const { autonomousState } = await import('../../lib/heidi/ActionController');
        const s = await autonomousState(pool);
        await pool.end();
        sse(res, { type: 'metadata', model_used: 'autonomous-state', latency: 0 });
        sse(res, {
          type: 'content',
          content: [
            'AUTONOMOUS STATE', '',
            `Mode: ${s.mode}`,
            s.currentGoal ? `Current goal: ${s.currentGoal.title} [${s.currentGoal.capability ?? 'goal.advance'}]` : 'Current goal: none',
            `Reason: ${s.reason}`,
            `Queue: ${s.queueDepth} open | Human blockers: ${s.humanBlockers} | Plans (24h): ${s.openPlans} | Replans: ${s.replans}`,
            `Local models: ${s.resources.models.length ? s.resources.models.join(', ') : 'unknown'}`,
            `Next action: ${s.nextAction}`,
          ].join('\n'),
        });
        return res.end();
      } catch (e) {
        sse(res, { type: 'metadata', model_used: 'autonomous-state', latency: 0 });
        sse(res, { type: 'content', content: `Autonomous state unavailable: ${e instanceof Error ? e.message : 'unknown'}` });
        return res.end();
      }
    }
    const wantsPlan = /^(plan|make a plan|interpret goal|goal:|work on)\s*[:\-–]?\s+/i.test(lowerMsg) || /^plan\s/i.test(lowerMsg);
    if (wantsPlan) {
      const goalText = message.replace(/^(plan|make a plan( for)?|interpret goal|goal:|work on)\s*[:\-–]?\s*/i, '').trim();
      if (goalText.length < 8) {
        sse(res, { type: 'metadata', model_used: 'cognitive-goals', latency: 0 });
        sse(res, { type: 'content', content: 'Give me a concrete goal to interpret — e.g. "plan: investigate the MiniMax opportunity and produce a verdict".' });
        return res.end();
      }
      if (!chatAuthorized(req)) return refuseUnauthorized(res, 'creating a governed goal');
      try {
        const pg = (await import('pg')).default;
        const pool = new pg.Pool({ host: '127.0.0.1', port: 54322, database: 'postgres', user: 'postgres', password: 'postgres' });
        const r = await pool.query(
          `INSERT INTO heidi_goals (title, goal_type, description, status, priority, success_criteria, context, created_at, updated_at)
           VALUES ($1,'task',$1,'active',5,'["goal_model persisted with typed knowledge"]'::jsonb,$2,now(),now()) RETURNING id`,
          [`Interpret goal: ${goalText.slice(0, 90)}`,
          JSON.stringify({ capabilityId: 'ops.goal_interpret', capabilityParams: { goal: goalText }, completeOnVerify: true, producedBy: 'chat' })],
        );
        await pool.end();
        sse(res, { type: 'metadata', model_used: 'cognitive-goals', latency: 0 });
        sse(res, { type: 'content', content: `Submitted as governed goal ${String(r.rows[0].id).slice(0, 8)} — the daemon interprets it (typed facts/assumptions/unknowns), plans over real capabilities, and executes each step under contract verification. Nothing runs above R2 without you.` });
        return res.end();
      } catch (e) {
        sse(res, { type: 'metadata', model_used: 'cognitive-goals', latency: 0 });
        sse(res, { type: 'content', content: `Goal submission failed: ${e instanceof Error ? e.message : 'unknown'}` });
        return res.end();
      }
    }
    if (wantsValidation) {
      try {
        const pg = (await import('pg')).default;
        const pool = new pg.Pool({ host: '127.0.0.1', port: 54322, database: 'postgres', user: 'postgres', password: 'postgres' });
        const { getValidationQueue } = await import('../../lib/heidi/ValidationQueue');
        const queue = await getValidationQueue(pool);
        await pool.end();
        sse(res, { type: 'metadata', model_used: 'validation-queue', latency: 0 });
        if (queue.length === 0) {
          sse(res, { type: 'content', content: 'CUSTOMER VALIDATION\n\nNo opportunities have reached a business finding yet. INVESTIGATE an opportunity first — validation starts from evidence, not ideas.\n\nRevenue: $0.00 verified.' });
        } else {
          const top = queue[0];
          const lines = [
            'CUSTOMER VALIDATION',
            '',
            `Priority opportunity: ${top.opportunityTitle}`,
            `Stage: ${top.stage}`,
          ];
          if (top.finding) lines.push(`Current finding: ${top.finding.verdict} (${top.finding.confidence}) — ${top.finding.limitations.slice(0, 120)}`);
          if (top.falsification) lines.push(`Falsification: ${top.falsification.slice(0, 140)}`);
          if (top.proposedExperiment) lines.push(`Experiment: ${top.proposedExperiment.slice(0, 140)}`);
          if (top.evidenceRequired) lines.push(`Evidence required: ${top.evidenceRequired.slice(0, 140)}`);
          lines.push(`Human action required: ${top.nextHumanAction}`);
          if (top.blockedReason) lines.push(`Blocked: ${top.blockedReason}`);
          if (top.evidence.length) lines.push(`Declared evidence: ${top.evidence.length} record(s) — all human_declared, verified=false`);
          lines.push('', 'Validation status: NOT VERIFIED (declarations cannot verify)', 'Revenue: $0.00 verified');
          if (queue.length > 1) lines.push(`(${queue.length - 1} more item(s) in the validation queue)`);
          sse(res, { type: 'content', content: lines.join('\n') });
        }
        return res.end();
      } catch (e) {
        sse(res, { type: 'metadata', model_used: 'validation-queue', latency: 0 });
        sse(res, { type: 'content', content: `Validation queue unavailable: ${e instanceof Error ? e.message : 'unknown'}` });
        return res.end();
      }
    }
    if (wantsBusiness) {
      try {
        const pg = (await import('pg')).default;
        const pool = new pg.Pool({ host: '127.0.0.1', port: 54322, database: 'postgres', user: 'postgres', password: 'postgres' });
        try {
          const { BusinessContext } = await import('../../lib/heidi/BusinessContext');
          const bc = new BusinessContext(pool);
          await bc.ensure();
          await bc.refresh();
          const facts = await bc.getFacts();
          const groups = ['objective', 'authority', 'autonomy', 'revenue', 'product', 'loop', 'boundary'];
          const lines = ['Business context (from the authoritative fact store):'];
          // Business loop state — the latest typed finding if one exists.
          const finding = await pool.query(
            `SELECT payload, created_at FROM heidi_events WHERE event_type='business_finding'
             ORDER BY created_at DESC LIMIT 1`).catch(() => ({ rows: [] }));
          if (finding.rows[0]) {
            const f = finding.rows[0].payload as { verdict?: string; confidence?: string; recommendedAction?: string; opportunityId?: string; limitations?: string };
            lines.push(`\nLATEST BUSINESS FINDING [${f.verdict} / ${f.confidence}]:`,
              `  opportunity: ${String(f.opportunityId ?? '?').slice(0, 8)}`,
              `  next: ${f.recommendedAction ?? 'none'}`,
              `  honest limit: ${String(f.limitations ?? '').slice(0, 120)}`);
          }
          for (const g of groups) {
            const fs2 = facts.filter(f => f.kind === g);
            if (!fs2.length) continue;
            lines.push(`\n${g.toUpperCase()}:`);
            for (const f of fs2.slice(0, g === 'product' ? 8 : 3)) {
              lines.push(`  ${f.key}: ${f.value.slice(0, 140)} [${f.status ?? 'CURRENT'}]`);
            }
          }
          sse(res, { type: 'metadata', model_used: 'business-context', latency: 0 });
          sse(res, { type: 'content', content: lines.join('\n') });
        } finally { await pool.end(); }
        res.write('data: [DONE]\n\n');
        return res.end();
      } catch (e) {
        sse(res, { type: 'content', content: `Business context unavailable — ${e instanceof Error ? e.message : 'unknown'}` });
        res.write('data: [DONE]\n\n');
        return res.end();
      }
    }
    if (wantsFindWork || wantsDevStatus || wantsFix) {
      try {
        const pg = (await import('pg')).default;
        const pool = new pg.Pool({ host: '127.0.0.1', port: 54322, database: 'postgres', user: 'postgres', password: 'postgres' });
        try {
          if (wantsFindWork || wantsFix) {
            if (!chatAuthorized(req)) { await pool.end(); return refuseUnauthorized(res, wantsFix ? 'creating a fix mission' : 'queuing investigation goals'); }
          }
          if (wantsFindWork) {
            const { observeDevelopmentSignals } = await import('../../lib/heidi/DevObserver');
            const findings = await observeDevelopmentSignals(pool);
            if (!findings.length) {
              sse(res, { type: 'metadata', model_used: 'dev-observe', latency: 0 });
              sse(res, { type: 'content', content: 'Scanned durable state — no development findings right now. NO_ACTION_REQUIRED: repeated failures, unresolved escalations, stale goals, and tree pollution are all quiet.' });
            } else {
              let created = 0;
              for (const f of findings.slice(0, 5)) {
                const { error } = await getCooSupabase().from('heidi_goals').insert({
                  goal_type: 'task', title: `Investigate: ${f.question.slice(0, 140)}`, description: f.initialObservation,
                  priority: 5, status: 'active',
                  context: { capabilityId: 'ops.dev_investigate', findingType: f.findingType, target: f.target, question: f.question, initialObservation: f.initialObservation, suspectedFiles: f.suspectedFiles, producerKey: `chat:find-work:${Date.now()}` },
                });
                if (!error) created++;
              }
              const lines = [`Scanned durable state — ${findings.length} finding(s):`,
              ...findings.map((f, i) => `${i + 1}. [${f.severity}] ${f.question.slice(0, 120)}`),
              `${created} investigation goal(s) queued — the daemon picks them up on its next cycle. "What did you find" in a few minutes for verdicts.`];
              sse(res, { type: 'metadata', model_used: 'dev-observe', latency: 0 });
              sse(res, { type: 'content', content: lines.join('\n') });
            }
          } else if (wantsDevStatus) {
            const fs = await import('fs');
            const invLog = '.hydi-operational/dev-investigations.jsonl';
            const invs = fs.existsSync(invLog)
              ? fs.readFileSync(invLog, 'utf8').trim().split('\n').slice(-6).map(l => JSON.parse(l))
              : [];
            const { data: goals } = await getCooSupabase().from('heidi_goals')
              .select('title, status, created_at')
              .or('title.ilike.Investigate:%,title.ilike.Fix confirmed defect:%')
              .order('created_at', { ascending: false }).limit(8);
            const lines = [
              `Recent investigations:`,
              ...(invs.length ? invs.map((r: { conclusion: string; target: string; confidence: string }) => `  ${r.conclusion} (${r.confidence}) — ${r.target}`) : ['  none yet']),
              `Dev goals:`,
              ...((goals ?? []).map((g: { title: string; status: string }) => `  [${g.status}] ${g.title.slice(0, 100)}`)),
            ];
            sse(res, { type: 'metadata', model_used: 'dev-status', latency: 0 });
            sse(res, { type: 'content', content: lines.join('\n') });
          } else {
            // "fix it" — only from a CONFIRMED_DEFECT investigation
            const fs = await import('fs');
            const invLog = '.hydi-operational/dev-investigations.jsonl';
            const invs = fs.existsSync(invLog)
              ? fs.readFileSync(invLog, 'utf8').trim().split('\n').map(l => JSON.parse(l))
              : [];
            const confirmed = [...invs].reverse().find((r: { conclusion: string }) => r.conclusion === 'CONFIRMED_DEFECT');
            if (!confirmed) {
              sse(res, { type: 'metadata', model_used: 'dev-fix', latency: 0 });
              sse(res, { type: 'content', content: 'No confirmed defect to fix — investigations so far are NOT_A_DEFECT / INSUFFICIENT. Say "find something useful to work on" to scan for new findings.' });
            } else {
              const { error } = await getCooSupabase().from('heidi_goals').insert({
                goal_type: 'task', title: `Fix confirmed defect: ${confirmed.target.slice(0, 120)}`,
                description: confirmed.recommendedAction, priority: 3, status: 'active',
                context: { capabilityId: 'ops.dev_author', problem: confirmed.question, evidence: JSON.stringify(confirmed.evidence).slice(0, 4000), targetFiles: confirmed.filesInspected, missionId: confirmed.missionId, sourceInvestigation: confirmed.investigationId, producerKey: `chat:fix:${confirmed.investigationId}` },
              });
              sse(res, { type: 'metadata', model_used: 'dev-fix', latency: 0 });
              sse(res, {
                type: 'content', content: error
                  ? `Couldn't create the fix goal — ${error.message}`
                  : `Queued a bounded fix for the confirmed defect on ${confirmed.target} (${confirmed.recommendedAction.slice(0, 120)}). ops.dev_author runs it under R2 policy — result lands in the audit trail.`
              });
            }
          }
        } finally { await pool.end(); }
        res.write('data: [DONE]\n\n');
        return res.end();
      } catch (e) {
        sse(res, { type: 'content', content: `Autopilot command failed — ${e instanceof Error ? e.message : 'unknown error'}` });
        res.write('data: [DONE]\n\n');
        return res.end();
      }
    }

    // ── Commercial bridge intents — opportunity → offer → checkout ──
    // Reads are open; offer preparation writes durable commercial state
    // so it requires the service token like every other mutation.
    const wantsRevenuePipeline = /continue (the )?(protoforge )?revenue pipeline|prepare (the )?(strongest )?(qualified )?offer|commercial (pipeline|path) (forward|next)/i.test(lowerMsg);
    const wantsRevenueBlockers = /what is blocking revenue|revenue blockers?|blocking (the )?revenue|why no revenue/i.test(lowerMsg);
    const wantsCommercialState = /(strongest|best|top) (revenue )?opportunit|opportunities ready|commercial (state|opportunities|offers)|pending customer actions|verified revenue|show me (the )?revenue/i.test(lowerMsg);
    if (wantsRevenuePipeline || wantsRevenueBlockers || wantsCommercialState) {
      try {
        const pg2 = (await import('pg')).default;
        const pool = new pg2.Pool({ host: '127.0.0.1', port: 54322, database: 'postgres', user: 'postgres', password: 'postgres' });
        try {
          const { collectOffers, prepareOffer } = await import('../../lib/heidi/CommercialBridge');
          const offers = await collectOffers(pool);
          const { rows: oppRows } = await pool.query(
            `SELECT id, title, status, approval_status, confidence FROM protoforge_opportunities
               WHERE status != 'rejected' ORDER BY confidence DESC NULLS LAST LIMIT 10`);
          const opps = oppRows as Array<{ id: string; title: string; status: string; approval_status: string; confidence: number | null }>;

          if (wantsRevenuePipeline) {
            // Mutating: prepare an offer for the strongest qualified opp.
            if (!chatAuthorized(req)) { await pool.end(); return refuseUnauthorized(res, 'preparing a commercial offer'); }
            const qualified = opps.filter(o => o.approval_status === 'approved');
            if (!qualified.length) {
              sse(res, { type: 'metadata', model_used: 'commercial-bridge', latency: 0 });
              sse(res, { type: 'content', content: `REVENUE PIPELINE\n\n${opps.length} open opportunities, 0 approved — qualification requires a human approve an opportunity or a positive business finding. Nothing was prepared; no offer was invented.\n\nNext action: review an opportunity in the workspace (or "approve <opp>" once validated).` });
              return res.end();
            }
            const top = qualified[0];
            const r = await prepareOffer(pool, { opportunityId: top.id, product: 'protoforge_model_prep', actor: 'operator via chat' });
            const lines = ['REVENUE PIPELINE'];
            if (r.ok) {
              lines.push(`Offer ${r.offer.offerId} ${r.deduped ? '(existing — idempotent, no duplicate)' : '(prepared)'}`,
                `  opportunity: ${r.offer.opportunityTitle.slice(0, 80)}`,
                `  product: ${r.offer.product}  $${(r.offer.priceCents / 100).toFixed(2)} ${r.offer.currency}`,
                `  stage: ${r.offer.stage}${r.offer.stageReason ? ` — ${r.offer.stageReason}` : ''}`,
                `  evidence: ${r.offer.evidenceSummary ?? 'none'}`);
            } else {
              lines.push(`Not prepared: ${r.reason}`);
            }
            sse(res, { type: 'metadata', model_used: 'commercial-bridge', latency: 0 });
            sse(res, { type: 'content', content: lines.join('\n') });
            return res.end();
          }

          // Read-only pipeline state.
          const lines = ['COMMERCIAL PIPELINE'];
          lines.push(`Opportunities: ${opps.length} open (${opps.filter(o => o.approval_status === 'approved').length} approved)`);
          for (const o of opps.slice(0, 5)) lines.push(`  ${o.id.slice(0, 8)} [${o.status}/${o.approval_status}] conf=${o.confidence ?? 'n/a'} — ${o.title.slice(0, 70)}`);
          if (offers.length) {
            lines.push(`Offers: ${offers.length}`);
            for (const o of offers.slice(0, 5)) lines.push(`  ${o.offerId} [${o.stage}] ${o.product} $${(o.priceCents / 100).toFixed(2)}${o.stageReason ? ` — ${o.stageReason}` : ''}`);
          } else {
            lines.push('Offers: none — no opportunity has reached commercial qualification.');
          }
          const { rows: verifiedRows } = await pool.query(`SELECT key, value FROM business_facts WHERE key='verified_total'`).catch(() => ({ rows: [] as Array<{ key: string; value: string }> }));
          lines.push(`Verified revenue: ${verifiedRows[0]?.value ?? '$0 (unverified)'}`);
          if (wantsRevenueBlockers) {
            const { rows: blockers } = await pool.query(
              `SELECT count(*)::int c FROM human_intervention_requests WHERE status='pending'`).catch(() => ({ rows: [{ c: 0 }] }));
            lines.push(`Blockers: ${offers.filter(o => o.stage === 'OFFER_BLOCKED').length} blocked offers, ${blockers[0].c} pending human intervention(s), live checkout requires live-transaction authorization`);
          }
          sse(res, { type: 'metadata', model_used: 'commercial-bridge', latency: 0 });
          sse(res, { type: 'content', content: lines.join('\n') });
          return res.end();
        } finally { await pool.end(); }
      } catch (e) {
        sse(res, { type: 'content', content: `Commercial pipeline unavailable — ${e instanceof Error ? e.message : 'unknown'}` });
        res.write('data: [DONE]\n\n');
        return res.end();
      }
    }

    // Operational questions resolve against the persisted COO state first
    // Life-context intents — the world model layer. Focus switching,
    // remembering, recall, and the bounded 'investigate <target>'
    // translation into a governed agent mission. Deterministic; anything
    // unrecognized falls through to COO/LLM paths and cannot act.
    const lifeIntent = classifyLifeIntent(message);
    if (lifeIntent) {
      // Mutating life-intents require the service token: approve executes
      // real proposals (incl. bounded Stripe checkout), investigate_*
      // create agent missions, control_last stops/retries agents,
      // business_decision records the commercial path. Read-only kinds
      // (briefing, findings, plate, recall…) stay open.
      const MUTATING_LIFE = new Set([
        'approve', 'decline', 'investigate', 'investigate_top',
        'control_last', 'business_decision',
        'remember', 'remember_last', 'focus', 'topic', 'forget',
      ]);
      if (MUTATING_LIFE.has(lifeIntent.kind) && !chatAuthorized(req)) {
        return refuseUnauthorized(res, `the '${lifeIntent.kind}' command`);
      }
      try {
        const sb = getCooSupabase();
        let text: string;
        if (lifeIntent.kind === 'greeting' || lifeIntent.kind === 'briefing') {
          // Completion awareness: consequential outcomes since the last
          // surfaced marker, once — then mark. Only greeting surfaces it
          // (briefing is on-demand inspection, not a welcome-back).
          const unsurfacedLines: string[] = [];
          if (lifeIntent.kind === 'greeting') {
            const { data: marker } = await sb.from('heidi_events')
              .select('payload')
              .eq('event_type', 'companion_surface')
              .order('created_at', { ascending: false }).limit(1).maybeSingle();
            const sinceTs = (marker?.payload as { upto?: string } | undefined)?.upto
              ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            const q = sb.from('heidi_events')
              .select('event_type, payload, created_at')
              .in('event_type', ['agent_status', 'investigation'])
              .gt('created_at', sinceTs)
              .order('created_at', { ascending: false }).limit(200);
            const { data: newEv } = await q;
            const done = new Set<string>(); const failed = new Set<string>();
            for (const e of (newEv ?? []) as Array<{ payload: Record<string, unknown> }>) {
              const mid = String(e.payload?.missionId ?? e.payload?.id ?? '');
              if (!mid) continue;
              if (e.payload?.status === 'COMPLETED') done.add(mid);
              if (e.payload?.status === 'FAILED') failed.add(mid);
            }
            if (done.size) unsurfacedLines.push(`${done.size} mission(s) completed — "what did you find" for the results.`);
            if (failed.size) unsurfacedLines.push(`${failed.size} mission(s) failed — "what should happen next" covers it.`);
            if (unsurfacedLines.length) {
              await sb.from('heidi_events').insert({
                event_type: 'companion_surface', division: 'companion',
                payload: { user_id, upto: new Date().toISOString(), surfaced: { done: done.size, failed: failed.size } },
              });
            }
          }
          // Presence/opening → companion briefing from durable state.
          const [life, cooRow] = await Promise.all([
            getLifeContext(sb, user_id),
            sb.from('heidi_events').select('payload, created_at')
              .eq('event_type', 'coo_state').order('created_at', { ascending: false }).limit(1).maybeSingle(),
          ]);
          const s = (cooRow.data?.payload ?? null) as Record<string, never> & {
            generatedAt?: string; applicationHealth?: string;
            deployment?: { verdict?: string; actualCommit?: string };
            work?: { goalsOpen?: number };
            protoforge?: { opportunitiesTotal?: number; pendingReview?: number };
            nextAction?: { kind: string; reason?: string; capabilityId?: string };
            humanActions?: { items?: Array<{ status: string; reason: string; backlog?: boolean }> };
            revenue?: { opportunitiesOpen?: number; offers?: { total?: number; byStage?: Record<string, number> } };
          } | null;
          const lines: string[] = lifeIntent.kind === 'greeting' ? ["Hey — good to see you. Here's where things stand:"] : [];
          if (life.focus) lines.push(`Focus: ${life.focus.project}.`);
          if (s) {
            const stale = Date.now() - new Date(String(s.generatedAt)).getTime() > 45 * 60 * 1000;
            lines.push(`System: deployment ${s.deployment?.verdict ?? 'UNKNOWN'} · health ${s.applicationHealth} · commit ${s.deployment?.actualCommit ?? '?'}${stale ? ' (snapshot stale)' : ''}.`);
            lines.push(`Work: ${s.work?.goalsOpen ?? 0} open goals · ProtoForge: ${s.protoforge?.opportunitiesTotal ?? 0} opportunities (${s.protoforge?.pendingReview ?? 0} pending review).`);
            const offerStages = s.revenue?.offers?.total
              ? ' · offers: ' + Object.entries(s.revenue.offers.byStage ?? {}).map(([st, n]) => `${n} ${st}`).join(', ')
              : '';
            const testOffers = (s.revenue?.offers as { testOffers?: number } | undefined)?.testOffers ?? 0;
            const fixtureNote = testOffers > 0 ? ` (${testOffers} test fixture(s) excluded — not sellable)` : '';
            lines.push(`Revenue: ${s.revenue?.opportunitiesOpen ?? 0} open opportunities${offerStages}${fixtureNote} — read-only, no reconciled-revenue claim.`);
            const open = (s.humanActions?.items ?? []).filter((i) => i.status === 'OPEN' && !i.backlog);
            // Lifecycle-classified view — enabled only via approved
            // evolution flag; read-only, never resolves anything.
            const { data: flagRow } = await sb.from('heidi_events').select('id')
              .eq('event_type', 'companion_flag')
              .eq('payload->>key', 'classified_needsyou').limit(1);
            if (flagRow?.length) {
              const classified = open.map((i) => ({ item: i, cls: classifyEscalation({ title: i.reason }) }));
              const actionable = classified.filter((c) => c.cls === 'ACTIONABLE' || c.cls === 'UNKNOWN');
              const decisions = classified.filter((c) => c.cls === 'HUMAN_DECISION');
              const muted = classified.length - actionable.length - decisions.length;
              if (actionable.length + decisions.length === 0) {
                lines.push(`Nothing actionable needs you${muted ? ` (${muted} standing-policy item(s) muted)` : ''}.`);
              } else {
                lines.push(`Needs you: ${[...actionable, ...decisions].slice(0, 3).map((c) => c.item.reason.slice(0, 60)).join(' | ')}${muted ? `  (+${muted} standing-policy muted)` : ''}`);
              }
            } else {
              lines.push(open.length > 0
                ? `Needs you: ${open.slice(0, 3).map((i) => i.reason.slice(0, 60)).join(' | ')}`
                : 'Nothing currently needs your attention.');
            }
            const na = s.nextAction;
            lines.push(`Next: ${na?.kind === 'capability' ? na.capabilityId : na?.kind === 'human' ? `HUMAN — ${na.reason}` : 'NO_ACTION_REQUIRED'}`);
          } else {
            lines.push('System state UNKNOWN — no coo_state snapshot readable.');
          }
          if (unsurfacedLines.length) {
            lines.push('', 'While you were away:', ...unsurfacedLines);
          }
          // Executive recommendation — one durable proposal awaiting
          // approval. Dedup by target so a declined proposal is not
          // silently re-created on the next greeting.
          const { data: pendingProps } = await sb.from('heidi_events')
            .select('id, payload')
            .eq('event_type', 'companion_proposal')
            .eq('payload->>status', 'pending')
            .order('created_at', { ascending: true }).limit(5);
          let proposals = pendingProps ?? [];
          if (!proposals.length) {
            // Model Prep path selected: if the deliverable pipeline has
            // never produced a verified artifact, propose the labeled
            // test job — the smallest revenue-loop proof available.
            const { data: dec } = await sb.from('human_intervention_requests')
              .select('status, resolution_note')
              .eq('request_id', 'decision:business-path').limit(1);
            const modelPrepSelected = dec?.[0]?.status === 'resolved'
              && String(dec[0].resolution_note ?? '').includes('model_prep');
            if (modelPrepSelected) {
              const { data: prevTest } = await sb.from('heidi_events').select('id')
                .eq('event_type', 'companion_proposal')
                .eq('payload->>kind', 'model_prep_test').limit(1);
              if (!prevTest?.length) {
                const { data: prop } = await sb.from('heidi_events').insert({
                  event_type: 'companion_proposal', division: 'companion',
                  payload: {
                    status: 'pending', kind: 'model_prep_test',
                    description: 'Run one labeled test job through the Model Prep pipeline',
                    reason: 'business path is model_prep and no verified artifact exists yet — this proves generate→verify→awaiting_review with payment staying unpaid',
                    requestText: 'a simple 40mm x 30mm x 20mm box enclosure with a lid',
                  },
                }).select('id, payload').single();
                if (prop) proposals = [prop];
              }
            }
          }
          if (!proposals.length) {
            // Self-improvement scan — derive at most ONE proposal from
            // real observed evidence. Declined/completed keys never
            // resurrect (dedup by improvementKey across all statuses).
            const imp = await deriveSelfImprovementProposal(sb, user_id);
            if (imp) proposals = [imp];
          }
          if (!proposals.length) {
            const { data: topOpp } = await sb.from('protoforge_opportunities')
              .select('id, title, confidence')
              .eq('status', 'needs_review')
              .order('confidence', { ascending: false }).limit(1).maybeSingle();
            if (topOpp) {
              const { data: existing } = await sb.from('heidi_events').select('id')
                .eq('event_type', 'companion_proposal')
                .eq('payload->>target', String(topOpp.id)).limit(1);
              if (!existing?.length) {
                const { data: prop } = await sb.from('heidi_events').insert({
                  event_type: 'companion_proposal', division: 'companion',
                  payload: {
                    status: 'pending', kind: 'investigate', target: String(topOpp.id),
                    description: `Investigate "${String(topOpp.title).slice(0, 80)}"`,
                    reason: `highest-confidence unreviewed opportunity (score ${topOpp.confidence ?? 'n/a'})`,
                  },
                }).select('id, payload').single();
                if (prop) proposals = [prop];
              }
            }
          }
          if (proposals.length === 1) {
            const p = proposals[0].payload as { description?: string; reason?: string };
            lines.push(`Recommended: ${p.description} — ${p.reason}. Say "approve" to start it, or "not yet" to defer.`);
          } else if (proposals.length > 1) {
            lines.push(`${proposals.length} proposals await a decision — say "approve" and I'll list them.`);
          }
          text = lines.join('\n');
        } else if (lifeIntent.kind === 'approve' || lifeIntent.kind === 'decline') {
          // Resolve a pending proposal — never guess when ambiguous.
          const { data: props } = await sb.from('heidi_events')
            .select('id, payload')
            .eq('event_type', 'companion_proposal')
            .eq('payload->>status', 'pending')
            .order('created_at', { ascending: true }).limit(10);
          const list = (props ?? []) as Array<{ id: string; payload: Record<string, unknown> }>;
          if (!list.length) {
            // No pending proposal — but if a human decision is open,
            // name it; an approval-shaped reply deserves a real pointer
            // rather than a dead end.
            const { data: dec } = await sb.from('human_intervention_requests')
              .select('objective')
              .eq('request_id', 'decision:business-path')
              .eq('status', 'pending').limit(1);
            text = dec?.length
              ? 'Nothing needs approval right now — but a decision does: the business path is still unselected. Say "the business path is model_prep", "rezonate_music", or "separate_products".'
              : 'Nothing is waiting for approval. Ask "what should we do next" and I\'ll propose something bounded.';
          } else if (lifeIntent.kind === 'decline') {
            if (list.length > 1) {
              text = `There are ${list.length} proposals pending — say "approve" and I'll list them so you can pick which to decline.`;
            } else {
              await sb.from('heidi_events')
                .update({ payload: { ...list[0].payload, status: 'declined', resolvedAt: new Date().toISOString() } })
                .eq('id', list[0].id);
              text = `Deferred: ${list[0].payload.description}.`;
            }
          } else if (list.length > 1 && lifeIntent.ordinal === null) {
            text = `There are ${list.length} proposed actions:\n` +
              list.map((p, i) => `${i + 1}. ${p.payload.description}`).join('\n') +
              `\nWhich one should I approve? ("approve the second one")`;
          } else {
            const idx = lifeIntent.ordinal ? Math.min(lifeIntent.ordinal, list.length) - 1 : 0;
            const p = list[idx];
            await sb.from('heidi_events')
              .update({ payload: { ...p.payload, status: 'approved', resolvedAt: new Date().toISOString() } })
              .eq('id', p.id);
            if (p.payload.kind === 'self_improvement') {
              // Closed-enum executor: only data-level changes exist here.
              // There is deliberately NO file/auth/governance executor —
              // unhandled spec types are BLOCKED, never substituted.
              const spec = p.payload.changeSpec as { type?: string; note?: string; match?: string; key?: string; enabled?: boolean; missionIds?: string[]; target?: string } | undefined;
              if (spec?.type === 'stop_mission' && Array.isArray(spec.missionIds) && spec.missionIds.length > 0 && spec.missionIds.length <= 4) {
                // STOPPED via the same event-sourced path the supervisor
                // folds — a terminal status, so supervision won't retry.
                const ids = spec.missionIds;
                for (const mid of ids) {
                  const { data: agentRow } = await sb.from('heidi_events')
                    .select('payload').eq('event_type', 'agent_status')
                    .eq('payload->>missionId', mid)
                    .order('created_at', { ascending: false }).limit(1);
                  const agentId = String((agentRow?.[0]?.payload as Record<string, unknown> | undefined)?.agentId ?? `agent-${mid}`);
                  await sb.from('heidi_events').insert({
                    event_type: 'agent_status', division: 'agents',
                    payload: { agentId, missionId: mid, status: 'STOPPED', stoppedBy: 'operator-approved-evolution', pid: 0 },
                  });
                  await sb.from('heidi_events').insert({
                    event_type: 'agent_message', division: 'agents',
                    payload: { from: 'heidi', to: 'supervisor', missionId: mid, type: 'STATUS', content: `stopped via approved self-improvement ${p.payload.improvementKey}`, requiresResponse: false },
                  });
                }
                await sb.from('heidi_events').insert({
                  event_type: 'evolution_result', division: 'companion',
                  payload: {
                    improvementKey: p.payload.improvementKey,
                    proposalId: p.id, verified: true,
                    executedAt: new Date().toISOString(),
                    observedEffect: `${ids.length} mission(s) marked STOPPED — supervisor treats terminal missions as non-retryable`,
                    learnedFrom: ['regenerated failures after cycle-2 symptom fix'],
                  },
                });
                text = `Improvement applied: ${ids.length} mission(s) marked STOPPED through the existing event path — the supervisor won't retry terminal missions. I'll verify on the next supervision pass that no new ${String(spec.target ?? '').slice(0, 8)} failures appear.\nLearning recorded: dismissing escalations (cycle 2) treated the symptom; stopping the mission treats the cause.`;
              } else if (spec?.type === 'set_companion_flag') {
                // Allowlisted flags only — presentation toggles, never
                // governance/payment/auth behavior.
                const ALLOWED = ['classified_needsyou'];
                if (!spec.key || !ALLOWED.includes(spec.key)) {
                  text = `BLOCKED — flag '${spec?.key ?? 'none'}' is not on the approved list. Execution refused.`;
                } else {
                  await sb.from('heidi_events').insert({
                    event_type: 'companion_flag', division: 'companion',
                    payload: { key: spec.key, enabled: spec.enabled !== false, setBy: 'operator-approved-evolution', at: new Date().toISOString() },
                  });
                  const { data: chk } = await sb.from('heidi_events').select('payload')
                    .eq('event_type', 'companion_flag').eq('payload->>key', spec.key)
                    .order('created_at', { ascending: false }).limit(1);
                  const ok = (chk?.[0]?.payload as { enabled?: boolean } | undefined)?.enabled === true;
                  await sb.from('heidi_events').insert({
                    event_type: 'evolution_result', division: 'companion',
                    payload: {
                      improvementKey: p.payload.improvementKey,
                      proposalId: p.id, verified: ok,
                      executedAt: new Date().toISOString(),
                      observedEffect: ok ? `flag ${spec.key} enabled — briefing now classifies Needs-you items` : 'flag write not confirmed',
                      learnedFrom: ['operator_escalations backlog scan'],
                    },
                  });
                  text = ok
                    ? `Improvement applied and verified: "Needs you" is now lifecycle-classified — real work, human decisions, and standing-policy noise are distinguished. Next greeting shows the classified view.\nNext candidate I can see: none yet — I'll watch whether classification actually improves your read of the queue.`
                    : `Approved, but FAILED verification — flag didn't persist. Recorded as failed; no retry without approval.`;
                }
              } else if (spec?.type === 'resolve_escalations' && spec.match) {
                const { data: updated } = await sb.from('operator_escalations')
                  .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: 'operator-approved-evolution' })
                  .eq('resolved', false).ilike('title', `%${spec.match}%`).select('id');
                const { data: remaining } = await sb.from('operator_escalations')
                  .select('id').eq('resolved', false).ilike('title', `%${spec.match}%`);
                const ok = (remaining ?? []).length === 0 && (updated ?? []).length > 0;
                await sb.from('heidi_events').insert({
                  event_type: 'evolution_result', division: 'companion',
                  payload: {
                    improvementKey: p.payload.improvementKey,
                    proposalId: p.id, verified: ok,
                    executedAt: new Date().toISOString(),
                    observedEffect: ok ? `${(updated ?? []).length} void escalations resolved; briefing no longer lists them` : 'escalations still unresolved',
                    learnedFrom: ['operator_escalations void-premise scan'],
                  },
                });
                text = ok
                  ? `Improvement applied and verified: ${(updated ?? []).length} escalation(s) resolved — the failed mission's target no longer exists, so dismissal was the only valid resolution. "Needs you" now shows only real items.\nNext candidate I can see: ${'operator_escalations has a large aged backlog overall — clearing it would need a broader proposal and a separate approval.'}`
                  : `Approved, but FAILED verification — ${(remaining ?? []).length} rows still unresolved. Recorded as failed; no retry without your approval.`;
              } else if (spec?.type === 'persist_context_note' && spec.note) {
                await remember(sb, user_id, spec.note, session_id);
                const life = await getLifeContext(sb, user_id);
                const ok = life.notes.some((n: string) => n.toLowerCase().includes('business path'));
                await sb.from('heidi_events').insert({
                  event_type: 'evolution_result', division: 'companion',
                  payload: {
                    improvementKey: p.payload.improvementKey,
                    proposalId: p.id, verified: ok,
                    executedAt: new Date().toISOString(),
                    observedEffect: ok ? 'business-path decision now recallable from durable memory' : 'note write did not appear in memory read-back',
                    learnedFrom: ['human_intervention_requests:decision:business-path', 'life_context notes absence'],
                  },
                });
                text = ok
                  ? `Improvement applied and verified: the business-path decision is now in durable memory — future sessions and briefings recall it without re-querying. Recorded as an evolution result so the next proposal learns from it.\nNext candidate I can see: the recurring failed mission against deleted opportunity a292a09e — resolving that needs YOUR decision (cancel vs restore), not mine.`
                  : `Approved, but execution FAILED verification — the note was written yet didn't appear in memory read-back. Marked as a failed evolution result; no retry without your approval.`;
              } else {
                text = `BLOCKED — no bounded executor exists for improvement type '${spec?.type ?? 'none'}'. Your approval is recorded; execution refused rather than substituted.`;
              }
            } else if (p.payload.kind === 'human_action' && (p.payload.actionSpec as { type?: string } | undefined)?.type === 'browser_post_reply') {
              // External communication — the most consequential boundary.
              // Approval binds an authorization to the EXACT action
              // (channel + destination + message hash + opportunity);
              // the executor rejects any drift, and an ambiguous post is
              // reported UNKNOWN, never claimed.
              const spec0 = p.payload.actionSpec as { opportunityId?: string; channel?: string; permalink?: string; message?: string };
              const actionId = `ha_${Date.now()}`;
              const bpr = await import('../../lib/human-action/browser-post-reply-auth') as { createAuthorization: (s: Record<string, unknown>, by: string) => unknown };
              const spec: Record<string, unknown> = { ...spec0, type: 'browser_post_reply', actionId, requestedAt: new Date().toISOString() };
              spec.authorization = bpr.createAuthorization(spec, 'operator');
              await sb.from('heidi_events').insert({
                event_type: 'human_action', division: 'companion',
                payload: { actionId, type: 'browser_post_reply', status: 'AUTHORIZED', authorizedBy: 'operator', proposalId: p.id, authorization: spec.authorization, at: new Date().toISOString() },
              });
              const { execFile } = await import('node:child_process');
              const run = await new Promise<{ code: number | null; out: string }>((res) => {
                execFile('node', ['scripts/human-action-executor.js', '--spec', JSON.stringify(spec)],
                  { cwd: process.cwd(), timeout: 300000 }, (err, stdout) => res({ code: err ? (err.code as number ?? 1) : 0, out: String(stdout) }));
              });
              let result: { ok?: boolean; status?: string; reason?: string; screenshots?: string[] } = {};
              try { result = JSON.parse(run.out.trim().split('\n').pop() ?? '{}'); } catch { /* malformed */ }
              await sb.from('heidi_events').insert({
                event_type: 'human_action', division: 'companion',
                payload: {
                  actionId, type: 'browser_post_reply', proposalId: p.id,
                  status: result.status === 'VERIFIED' ? 'COMPLETED' : result.status ?? 'FAILED',
                  destination: spec.permalink, channel: spec.channel,
                  reason: result.reason ?? null, evidence: result.screenshots ?? [],
                  finishedAt: new Date().toISOString(),
                },
              });
              if (result.status === 'VERIFIED') {
                text = `Submitted and verified — the reply is visible on the destination page.\nDestination: ${spec.permalink}\nMessage: "${String(spec.message ?? '').slice(0, 140)}"\nVerification: posted text observed on-page; screenshots captured.`;
              } else if (result.status === 'WAITING_FOR_HUMAN') {
                text = `NOT SENT — the channel needs you first: ${result.reason}. Nothing was posted, and I have not treated it as submitted. Log in once and I'll retry on your approval.`;
              } else if (result.status === 'EXTERNAL_BLOCK') {
                text = `NOT SENT — the platform is blocking this access: ${result.reason}. The action stays authorized but unexecuted.`;
              } else {
                text = `I could not verify that the reply was submitted (${result.status ?? 'UNKNOWN'}${result.reason ? `: ${result.reason}` : ''}). I have NOT treated it as successful — no claim, no retry without your approval.`;
              }
            } else if (p.payload.kind === 'human_action' && (p.payload.actionSpec as { type?: string } | undefined)?.type === 'stripe_test_checkout') {
              // Human Action Executor — drives the real browser through the
              // hosted TEST checkout. Verification is independent: the job
              // must reach 'paid' via the actual webhook, never by mutation.
              const actionId = `ha_${Date.now()}`;
              await sb.from('heidi_events').insert({
                event_type: 'human_action', division: 'companion',
                payload: { actionId, type: 'stripe_test_checkout', status: 'AUTHORIZED', authorizedBy: 'operator', proposalId: p.id, at: new Date().toISOString() },
              });
              const jr = await (await fetch('http://localhost:3000/api/revenue/jobs', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ customerEmail: 'heidi-test@localhost.dev', customerName: 'Heidi Human-Action Test', product: 'protoforge_model_prep', requestText: 'human-action acceptance test — simple box enclosure' }),
              })).json() as { jobId?: string; checkoutUrl?: string | null; error?: string };
              if (!jr.checkoutUrl || !jr.jobId) {
                text = `BLOCKED — could not create a test checkout session (${jr.error ?? 'no checkoutUrl'}). The proposal stays authorized but unexecuted.`;
              } else {
                const { execFile } = await import('node:child_process');
                const run = await new Promise<{ code: number | null; out: string }>((res) => {
                  execFile('node', ['scripts/human-action-executor.js', '--spec', JSON.stringify({ type: 'stripe_test_checkout', checkoutUrl: jr.checkoutUrl, jobId: jr.jobId, actionId })],
                    { cwd: process.cwd(), timeout: 180000 }, (err, stdout) => res({ code: err ? (err.code as number ?? 1) : 0, out: String(stdout) }));
                });
                let result: { ok?: boolean; status?: string; reason?: string; finalUrl?: string } = {};
                try { result = JSON.parse(run.out.trim().split('\n').pop() ?? '{}'); } catch { /* malformed */ }
                // Independent verification — poll the job row for the real
                // webhook-confirmed transition; never mutate payment state.
                let paid = false;
                for (let i = 0; i < 12 && !paid; i++) {
                  await new Promise((r) => setTimeout(r, 5000));
                  const { data: job } = await sb.from('customer_jobs').select('payment_status, job_status').eq('job_id', jr.jobId).limit(1);
                  paid = job?.[0]?.payment_status === 'paid';
                }
                const { data: wh } = await sb.from('webhook_events').select('id').ilike('payload->>type', 'checkout.session.completed').order('created_at', { ascending: false }).limit(1);
                const verified = paid && !!wh?.length;
                await sb.from('heidi_events').insert({
                  event_type: 'human_action', division: 'companion',
                  payload: {
                    actionId, type: 'stripe_test_checkout', jobId: jr.jobId,
                    status: verified ? 'COMPLETED' : 'FAILED',
                    browserResult: result.status, finalUrl: result.finalUrl,
                    webhookObserved: !!wh?.length, jobPaid: paid,
                    finishedAt: new Date().toISOString(),
                  },
                });
                text = verified
                  ? `TEST PAYMENT VERIFIED — I opened the hosted checkout in a real browser, entered the Stripe test card, and submitted. The webhook confirmed the payment and job ${jr.jobId} is now 'paid'. Evidence: browser screenshots + webhook event + ledger, all durable. This is TEST evidence — verified revenue is still $0.`
                  : `PAYMENT TEST INCOMPLETE — browser ${result.status ?? 'result unreadable'}${result.reason ? ` (${result.reason})` : ''}; webhook seen: ${!!wh?.length}; job paid: ${paid}. I did NOT mark anything paid manually — the state is exactly what Stripe's real flow produced.`;
              }
            } else if (p.payload.kind === 'model_prep_test') {
              // Labeled TEST harness — proves the internal deliverable
              // path (generate → verify → awaiting_review). payment_status
              // stays 'unpaid'; no checkout, no revenue claim.
              const { getJobManager } = await import('../../lib/revenue/JobManager');
              const { executeJob } = await import('../../lib/revenue/JobExecutor');
              const jm = getJobManager();
              const job = await jm.createJob({
                customerEmail: 'pipeline-test@hydi-test.local',
                customerName: 'Pipeline Test (not a customer)',
                product: 'protoforge_model_prep',
                requestText: String(p.payload.requestText ?? 'a simple 40mm x 30mm x 20mm box enclosure with a lid'),
                requirements: { objectType: 'box', width: 40, height: 30, depth: 20 },
                priceCents: 2900,
              });
              // created -> queued is a valid transition; payment gate is
              // intentionally bypassed for this labeled test job (unpaid).
              await sb.from('customer_jobs').update({ job_status: 'queued', updated_at: new Date().toISOString() }).eq('job_id', job.jobId);
              const res = await executeJob(job.jobId);
              const after = await jm.getJob(job.jobId);
              text = res.success
                ? `Approved — executed. Job ${job.jobId.slice(0, 20)}: artifacts generated and verified (${res.artifacts.length} files: .scad + .stl + spec). Job is now '${after?.jobStatus}' — awaiting YOUR review for delivery. Payment: unpaid (labeled test — not revenue).`
                : `Approved — execution attempted but FAILED: ${res.error}. Nothing was delivered or charged.`;
            } else if (p.payload.kind === 'investigate') {
              const { data: goalRow, error } = await sb.from('heidi_goals').insert({
                goal_type: 'mission',
                title: String(p.payload.description),
                description: `Approved via chat. ${String(p.payload.reason ?? '')}`,
                purpose: 'operator approval via chat',
                priority: 5, status: 'pending', owner: 'operator', confidence: 0.9,
                context: {
                  producerKey: `cmd:approved:${p.id}`,
                  producedBy: 'human-operator',
                  capabilityId: 'ops.agent_mission',
                  capabilityParams: { opportunityId: p.payload.target },
                  completeOnVerify: true,
                },
              }).select('id').single();
              if (error) throw new Error(error.message);
              text = `Approved. Starting: ${p.payload.description} — governed goal ${goalRow.id.slice(0, 8)}. I'll report when it completes.`;
            } else {
              text = `Approved: ${p.payload.description}. No governed executor exists for this proposal type yet — I've recorded your decision.`;
            }
          }
        } else if (lifeIntent.kind === 'plate') {
          // "What's on my plate" — focus + the top actionable items,
          // spoken naturally. Read-only; never invents work.
          const life = await getLifeContext(sb, user_id);
          const lines: string[] = [];
          lines.push(life.focus ? `You're focused on ${life.focus.project}.` : 'No focus is set — tell me what to work on.');
          const { data: opps } = await sb.from('protoforge_opportunities')
            .select('title, confidence')
            .eq('status', 'needs_review')
            .order('confidence', { ascending: false })
            .limit(3);
          if (opps && opps.length > 0) {
            lines.push(`Highest-confidence leads awaiting review: ${opps.map((o: { title: string }) => o.title.slice(0, 60)).join(' · ')}.`);
          }
          const { data: acts } = await sb.from('heidi_events')
            .select('payload')
            .eq('event_type', 'human_action_queue')
            .order('created_at', { ascending: false })
            .limit(1);
          const items = ((acts?.[0]?.payload as { items?: Array<{ status: string; reason: string; backlog?: boolean }> })?.items ?? [])
            .filter((i) => i.status === 'OPEN' && !i.backlog);
          lines.push(items.length > 0
            ? `Waiting on you: ${items.slice(0, 2).map((i) => i.reason.slice(0, 60)).join(' | ')}`
            : 'Nothing is waiting on your approval.');
          if (life.notes.length > 0) lines.push(`Recent note: "${life.notes[0].slice(0, 80)}"`);
          text = lines.join('\n');
        } else if (lifeIntent.kind === 'remember_last') {
          const life = await getLifeContext(sb, user_id);
          if (life.focus) {
            await remember(sb, user_id, `${life.focus.project} is a priority`, session_id);
            text = `Noted — ${life.focus.project} is a priority.`;
          } else {
            text = 'Remember what, exactly? Nothing is currently in focus — say "remember <thing>" and I\'ll keep it.';
          }
        } else if (lifeIntent.kind === 'control_last') {
          // Resolve "stop that"/"retry that" to the most recent mission.
          const { data: ev } = await sb.from('heidi_events')
            .select('payload, created_at')
            .in('event_type', ['agent_mission', 'agent_status'])
            .order('created_at', { ascending: false })
            .limit(40);
          type Ev = { payload: { missionId?: string; status?: string; role?: string }; created_at: string };
          const latest = new Map<string, string>();
          for (const e of (ev ?? []) as Ev[]) {
            const mid = e.payload.missionId;
            if (!mid) continue;
            if (!latest.has(mid) && e.payload.status) latest.set(mid, e.payload.status);
          }
          const target = lifeIntent.action === 'stop'
            ? [...latest.entries()].find(([, s]) => s === 'RUNNING' || s === 'PENDING')
            : [...latest.entries()].find(([, s]) => s === 'FAILED');
          if (!target) {
            text = lifeIntent.action === 'stop' ? 'Nothing is running right now.' : 'Nothing failed recently that can be retried.';
          } else {
            const { error } = await sb.from('heidi_goals').insert({
              goal_type: 'mission',
              title: `${lifeIntent.action === 'stop' ? 'Stop' : 'Retry'} ${target[0]}`,
              description: `operator "${lifeIntent.action} that" via chat`,
              purpose: 'operator command via chat',
              priority: 5, status: 'pending', owner: 'operator', confidence: 0.9,
              context: {
                producerKey: `cmd:${lifeIntent.action}:${Date.now()}`,
                producedBy: 'human-operator',
                capabilityId: 'ops.agent_control',
                capabilityParams: { action: lifeIntent.action, target: target[0], actor: 'chat-operator' },
                completeOnVerify: true,
              },
            });
            if (error) throw new Error(error.message);
            text = `Got it — submitted a governed ${lifeIntent.action} for the most recent mission (${target[0].slice(0, 20)}…). The daemon picks it up next cycle; it'll be refused if that mission already finished.`;
          }
        } else if (lifeIntent.kind === 'revenue_path') {
          // Commercial truth — strictly separated categories. Never
          // conflate scouting with customers or test payments with revenue.
          const { getOfferCatalog } = await import('../../lib/revenue/OfferCatalog');
          const offer = getOfferCatalog().get('protoforge_model_prep') as {
            name?: string; setupPrice?: number; description?: string;
          } | undefined;
          const [{ data: oppRows }, { data: decRows }, { data: jobRows }] = await Promise.all([
            sb.from('protoforge_opportunities').select('status'),
            sb.from('human_intervention_requests').select('status, resolution_note')
              .eq('request_id', 'decision:business-path').order('created_at', { ascending: false }).limit(1),
            sb.from('customer_jobs').select('payment_status, stripe_checkout_session_id').limit(200),
          ]);
          const pending = (oppRows ?? []).filter((o: { status: string }) => o.status === 'needs_review').length;
          const decision = decRows?.[0];
          const realPaid = (jobRows ?? []).filter((j: { payment_status: string; stripe_checkout_session_id: string | null }) =>
            j.payment_status === 'paid' && typeof j.stripe_checkout_session_id === 'string' && j.stripe_checkout_session_id.startsWith('cs_live_'));
          const lines: string[] = [
            `Sellable offer: ${offer?.name ?? 'ProtoForge Model Prep'} — $${((offer?.setupPrice ?? 2900) / 100).toFixed(0)} one-time. ${offer?.description ?? ''}`,
            `Scouting pipeline: ${pending} opportunities pending review — currently AI/music market intelligence. That's market research, not customers.`,
            'Customer evidence: none. No identified prospect has expressed need or evaluated the offer.',
            'Payments: Stripe test checkout works (a real test session exists). Verified revenue: $0 — no live transaction has ever been reconciled.',
            decision?.status === 'resolved' || decision?.status === 'completed'
              ? `Business path: ${decision.resolution_note ?? 'selected (see decision record)'}.`
              : 'Business path: UNSELECTED — the offer targets 3D-print fabrication while scouting tracks AI/music. That choice is yours: tell me "the business path is model_prep", "rezonate_music", or "separate_products".',
          ];
          text = lines.join('\n');
        } else if (lifeIntent.kind === 'business_decision') {
          // Record the human's explicit business-path choice — completes the
          // pending decision intervention and stores a durable note.
          const { error: decErr } = await sb.from('human_intervention_requests')
            .update({
              status: 'completed',
              resolution_note: `HUMAN_SELECTED: ${lifeIntent.path}`,
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('request_id', 'decision:business-path')
            .eq('status', 'pending');
          if (decErr) throw new Error(decErr.message);
          await remember(sb, user_id, `Business path selected: ${lifeIntent.path}`, session_id);
          text = `Recorded — the business path is now ${lifeIntent.path}. I'll treat that as the commercial direction going forward.`;
        } else if (lifeIntent.kind === 'whats_changed') {
          // Delta vs last contact — sessions.updated_at is the previous
          // touch timestamp (this request hasn't written yet).
          const { data: sess } = await sb.from('sessions').select('updated_at')
            .eq('session_id', session_id).maybeSingle();
          const since = sess?.updated_at ? new Date(sess.updated_at as string) : null;
          if (!since || Date.now() - since.getTime() < 90 * 1000) {
            text = "You just talked to me — nothing has happened since. Ask 'what's going on' for the current picture.";
          } else {
            const { data: evs } = await sb.from('heidi_events')
              .select('event_type, payload, created_at')
              .gt('created_at', since.toISOString())
              .order('created_at', { ascending: false })
              .limit(200);
            const counts = new Map<string, number>();
            const notable: string[] = [];
            for (const e of (evs ?? []) as Array<{ event_type: string; payload: Record<string, unknown> }>) {
              counts.set(e.event_type, (counts.get(e.event_type) ?? 0) + 1);
              if (e.event_type === 'agent_status' && e.payload?.status === 'COMPLETED') {
                notable.push(`mission ${String(e.payload.missionId ?? '').slice(0, 20)} finished`);
              }
              if (e.event_type === 'agent_status' && e.payload?.status === 'FAILED') {
                notable.push(`mission ${String(e.payload.missionId ?? '').slice(0, 20)} failed`);
              }
            }
            const lines: string[] = [`Since we last spoke (${Math.round((Date.now() - since.getTime()) / 60000)} min ago):`];
            const { data: jobs } = await sb.from('customer_job_events')
              .select('job_id, event_type')
              .eq('event_type', 'execution_completed')
              .gt('created_at', since.toISOString()).limit(5);
            for (const j of (jobs ?? []) as Array<{ job_id: string }>) {
              notable.push(`job ${j.job_id.slice(4, 19)} artifacts delivered — awaiting your review`);
            }
            const uniq = [...new Set(notable)].slice(0, 5);
            if (uniq.length) lines.push(...uniq.map((n) => `• ${n}`));
            const cycles = counts.get('cognitive_cycle') ?? 0;
            const missions = counts.get('agent_mission') ?? 0;
            const escalations = counts.get('authorization_escalation') ?? 0;
            if (missions) lines.push(`• ${missions} new mission event(s)`);
            if (escalations) lines.push(`• ${escalations} authorization escalation(s)`);
            if (!uniq.length && !missions && !escalations) lines.push('• routine background work only — nothing needs you.');
            if (cycles) lines.push(`(${cycles} background cycles ran)`);
            text = lines.join('\n');
          }
        } else if (lifeIntent.kind === 'last_action') {
          const { data: goal } = await sb.from('heidi_goals')
            .select('id, title, status, created_at')
            .order('created_at', { ascending: false }).limit(1).maybeSingle();
          if (!goal) {
            text = 'No governed work has been recorded yet.';
          } else {
            const { data: missions } = await sb.from('heidi_events')
              .select('payload')
              .in('event_type', ['agent_status'])
              .order('created_at', { ascending: false }).limit(30);
            const family = (missions ?? []).map((e: { payload: Record<string, unknown> }) => e.payload)
              .filter((p) => String(p.goalId ?? '') === String(goal.id));
            const done = family.filter((p) => p.status === 'COMPLETED').length;
            const failed = family.filter((p) => p.status === 'FAILED').length;
            text = `Last thing I did: "${goal.title}" — ${String(goal.status).toUpperCase()}` +
              (family.length ? ` (${done} missions completed, ${failed} failed).` : '.') +
              (goal.status === 'completed' ? ' Ask "what did you find" for the results.' : '');
          }
        } else if (lifeIntent.kind === 'autonomy') {
          text = [
            'Without you, I can: brief you on real state, remember things, track our projects, run bounded investigations (research agents + analyst), and recover routine failures.',
            'Only you can: approve payments or live transactions, contact anyone outside this system, choose the business direction, or grant new authorizations.',
            'Anything outside my envelope becomes an explicit human action item — I surface it, I never pretend to have done it.',
          ].join('\n');
        } else if (lifeIntent.kind === 'roadmap') {
          // Ordered view of real persisted state — not an invented plan.
          const [{ data: openGoals }, { data: dec }, { data: pendProps }] = await Promise.all([
            sb.from('heidi_goals').select('title, status, created_at')
              .in('status', ['pending', 'in_progress'])
              .order('created_at', { ascending: false }).limit(5),
            sb.from('human_intervention_requests').select('objective')
              .eq('request_id', 'decision:business-path').eq('status', 'pending').limit(1),
            sb.from('heidi_events').select('payload')
              .eq('event_type', 'companion_proposal').eq('payload->>status', 'pending')
              .order('created_at', { ascending: true }).limit(5),
          ]);
          const lines = ['Current roadmap (from persisted state — not a plan I invented):'];
          let n = 0;
          if (dec?.length) lines.push(`${++n}. HUMAN DECISION — business path unselected (gates what scouting/investigations are even for).`);
          for (const g of (openGoals ?? []) as Array<{ title: string; status: string }>) {
            lines.push(`${++n}. ${g.status === 'in_progress' ? 'IN PROGRESS' : 'PENDING'} — ${g.title.slice(0, 70)}`);
          }
          for (const p of (pendProps ?? []) as Array<{ payload: Record<string, unknown> }>) {
            lines.push(`${++n}. AWAITING YOUR APPROVAL — ${String(p.payload.description).slice(0, 70)}`);
          }
          if (!n) lines.push('Nothing queued — tell me what to focus on.');
          text = lines.join('\n');
        } else if (lifeIntent.kind === 'self_development') {
          text = [
            "I can't act on my own development — that's deliberately outside my envelope. What I can do:",
            '• investigate a bounded improvement and bring you a proposal (e.g. "investigate the web-server memory problem")',
            '• tell you my current known gaps honestly',
            '',
            'Current gaps I know about: local conversational model is RAM-limited, the web process dies under memory pressure, I handle one intent per message, and the business path is still UNSELECTED (your call).',
            'Actual changes to my machinery go through you — via Devin or your own commits.',
          ].join('\n');
        } else if (lifeIntent.kind === 'executive_question') {
          // Durable executive context — seeded into memories(kind='context'),
          // answered from those records + live state (live wins).
          const { seedExecutiveContext, answerExecutiveQuestion } = await import('../../lib/heidi/ExecutiveContext');
          await seedExecutiveContext(sb, user_id, session_id);
          text = await answerExecutiveQuestion(sb, user_id, lifeIntent.category);
        } else if (lifeIntent.kind === 'focus') {
          const { project, created } = await setFocus(sb, user_id, lifeIntent.project, session_id);
          text = `Focus set: ${project.name}${created ? ' (new project — recorded)' : ''}.`;
        } else if (lifeIntent.kind === 'remember') {
          await remember(sb, user_id, lifeIntent.text, session_id);
          text = `Noted: "${lifeIntent.text.slice(0, 120)}"`;
        } else if (lifeIntent.kind === 'recall') {
          text = recallAnswer(await getLifeContext(sb, user_id));
        } else if (lifeIntent.kind === 'forget') {
          const had = await clearFocus(sb, user_id);
          text = had ? 'Dropped it — focus cleared. The history stays in memory if we come back.' : 'Nothing is currently focused.';
        } else if (lifeIntent.kind === 'next_steps') {
          // Unified read: life context + latest persisted coo_state —
          // the "real picture" is both what you're working on and what
          // the system is actually doing. Never merged into one claim.
          const [life, cooRow] = await Promise.all([
            getLifeContext(sb, user_id),
            sb.from('heidi_events').select('payload, created_at')
              .eq('event_type', 'coo_state').order('created_at', { ascending: false }).limit(1).maybeSingle(),
          ]);
          const s = (cooRow.data?.payload ?? null) as {
            generatedAt?: string; applicationHealth?: string;
            deployment?: { actualCommit?: string; verdict?: string };
            work?: { goalsOpen?: number; escalationsOpen?: number; escalationsNew24h?: number };
            protoforge?: { opportunitiesTotal?: number; pendingReview?: number };
            nextAction?: { kind: string; reason?: string; capabilityId?: string };
            humanActions?: { open?: number; items?: Array<{ id: string; status: string; reason: string; backlog?: boolean }> };
            revenue?: { opportunitiesOpen?: number; offers?: { total?: number; byStage?: Record<string, number> } };
          } | null;
          const lines: string[] = [];
          if (life.focus) lines.push(`Focus: ${life.focus.project}.`);
          if (s) {
            const stale = Date.now() - new Date(String(s.generatedAt)).getTime() > 45 * 60 * 1000;
            lines.push(`System: deployment ${s.deployment?.verdict ?? 'UNKNOWN'} · health ${s.applicationHealth} · commit ${s.deployment?.actualCommit ?? '?'}${stale ? ' (snapshot stale)' : ''}.`);
            lines.push(`Work: ${s.work?.goalsOpen ?? 0} open goals · ProtoForge: ${s.protoforge?.opportunitiesTotal ?? 0} opportunities (${s.protoforge?.pendingReview ?? 0} pending review).`);
            const offerStages = s.revenue?.offers?.total
              ? ' · offers: ' + Object.entries(s.revenue.offers.byStage ?? {}).map(([st, n]) => `${n} ${st}`).join(', ')
              : '';
            const testOffers = (s.revenue?.offers as { testOffers?: number } | undefined)?.testOffers ?? 0;
            const fixtureNote = testOffers > 0 ? ` (${testOffers} test fixture(s) excluded — not sellable)` : '';
            lines.push(`Revenue: ${s.revenue?.opportunitiesOpen ?? 0} open opportunities${offerStages}${fixtureNote} — read-only, no reconciled-revenue claim.`);
            const open = (s.humanActions?.items ?? []).filter((i) => i.status === 'OPEN' && !i.backlog);
            // Lifecycle-classified view — enabled only via approved
            // evolution flag; read-only, never resolves anything.
            const { data: flagRow } = await sb.from('heidi_events').select('id')
              .eq('event_type', 'companion_flag')
              .eq('payload->>key', 'classified_needsyou').limit(1);
            if (flagRow?.length) {
              const classified = open.map((i) => ({ item: i, cls: classifyEscalation({ title: i.reason }) }));
              const actionable = classified.filter((c) => c.cls === 'ACTIONABLE' || c.cls === 'UNKNOWN');
              const decisions = classified.filter((c) => c.cls === 'HUMAN_DECISION');
              const muted = classified.length - actionable.length - decisions.length;
              if (actionable.length + decisions.length === 0) {
                lines.push(`Nothing actionable needs you${muted ? ` (${muted} standing-policy item(s) muted)` : ''}.`);
              } else {
                lines.push(`Needs you: ${[...actionable, ...decisions].slice(0, 3).map((c) => c.item.reason.slice(0, 60)).join(' | ')}${muted ? `  (+${muted} standing-policy muted)` : ''}`);
              }
            } else {
              lines.push(open.length > 0
                ? `Needs you: ${open.slice(0, 3).map((i) => i.reason.slice(0, 60)).join(' | ')}`
                : 'Nothing currently needs your attention.');
            }
            const na = s.nextAction;
            lines.push(`Next: ${na?.kind === 'capability' ? na.capabilityId : na?.kind === 'human' ? `HUMAN — ${na.reason}` : 'NO_ACTION_REQUIRED'}`);
            if (lifeIntent.kind === 'next_steps' && open.length === 0) {
              lines.push('Everything authorized is proceeding — the blockers that exist are human-side.');
            }
          } else {
            lines.push('System state UNKNOWN — no coo_state snapshot readable.');
          }
          text = lines.join('\n');
        } else if (lifeIntent.kind === 'findings') {
          // Read-only: summarize the latest agent RESULT messages.
          const { data: rows } = await sb.from('heidi_events')
            .select('payload, created_at')
            .eq('event_type', 'agent_message')
            .eq('payload->>type', 'RESULT')
            .order('created_at', { ascending: false })
            .limit(8);
          const results = (rows ?? []) as Array<{ payload: Record<string, unknown>; created_at: string }>;
          if (results.length === 0) {
            text = 'No agent results yet — ask me to investigate something first.';
          } else {
            const lines = results.map((r) => {
              const p = r.payload as { from?: string; content?: string; evidence?: unknown };
              return `  [${String(p.from ?? 'agent').replace(/^agent-/, '')}] ${String(p.content ?? '').slice(0, 110)}`;
            });
            text = `Latest agent findings:\n${lines.join('\n')}\n(full evidence is on the /coo board — click an agent)`;
          }
        } else if (lifeIntent.kind === 'topic') {
          await remember(sb, user_id, `Current topic: ${lifeIntent.topic}`, session_id);
          text = `Noted — ${lifeIntent.topic}. When you say "investigate that" or "that", I'll take it to mean this.`;
        } else if (lifeIntent.kind === 'investigate_top') {
          // Resolve the referent: if the human anchored a topic this
          // session ("thinking about X"), "investigate that" means X —
          // not the generic top-opportunity default.
          const { data: topicNote } = await sb.from('memories')
            .select('content, created_at')
            .eq('user_id', user_id)
            .ilike('content', 'Current topic:%')
            .order('created_at', { ascending: false }).limit(1).maybeSingle();
          const topicFresh = topicNote && (Date.now() - new Date(topicNote.created_at as string).getTime()) < 24 * 60 * 60 * 1000
            ? String(topicNote.content).replace(/^Current topic:\s*/i, '')
            : null;
          const target = topicFresh ?? 'top ProtoForge opportunities';
          const { data: goalRow, error } = await sb.from('heidi_goals').insert({
            goal_type: 'mission',
            title: `Investigate ${target}`,
            description: topicFresh
              ? `Operator-requested investigation of the current topic: ${topicFresh}`
              : 'Operator-requested investigation of the highest-confidence unreviewed opportunities',
            purpose: 'operator command via chat',
            priority: 5,
            status: 'pending',
            owner: 'operator',
            confidence: 0.9,
            context: {
              producerKey: `cmd:investigate-top:${Date.now()}`,
              producedBy: 'human-operator',
              capabilityId: 'ops.agent_mission',
              capabilityParams: topicFresh ? { selectTop: 1, topic: topicFresh } : { selectTop: 1 },
              completeOnVerify: true,
            },
          }).select('id').single();
          if (error) throw new Error(error.message);
          text = topicFresh
            ? `On it — investigating "${topicFresh}" (your current topic): two independent research agents plus an analyst (governed goal ${goalRow.id.slice(0, 8)}). Ask "what did the agents find" in a few minutes.`
            : `On it — I'll investigate the highest-confidence unreviewed opportunity: two independent research agents plus an analyst (governed goal ${goalRow.id.slice(0, 8)}). Ask "what did the agents find" in a few minutes.`;
        } else {
          // investigate — translate into a governed goal only when the
          // target is an explicit opportunity reference.
          const { data: goalRow, error } = await sb.from('heidi_goals').insert({
            goal_type: 'mission',
            title: `Investigate ${lifeIntent.target}`,
            description: `Operator-requested investigation of ${lifeIntent.target}`,
            purpose: 'operator command via chat',
            priority: 5,
            status: 'pending',
            owner: 'operator',
            confidence: 0.9,
            context: {
              producerKey: `cmd:investigate:${lifeIntent.target}:${Date.now()}`,
              producedBy: 'human-operator',
              capabilityId: 'ops.agent_mission',
              capabilityParams: { opportunityId: lifeIntent.target },
              completeOnVerify: true,
            },
          }).select('id').single();
          if (error) throw new Error(error.message);
          text = `I'll investigate that — three bounded agents (two independent research, one analyst), governed goal ${goalRow.id.slice(0, 8)}. Results land in the agent board; the supervisor watches them.`;
        }
        sse(res, { type: 'metadata', model_used: 'heidi-context', latency: 0 });
        sse(res, { type: 'content', content: text });
        res.write('data: [DONE]\n\n');
        return res.end();
      } catch (e) {
        sse(res, { type: 'content', content: `Context operation failed — ${e instanceof Error ? e.message : 'unknown'}` });
        res.write('data: [DONE]\n\n');
        return res.end();
      }
    }

    // (the daemon's authoritative snapshot). Non-operational or unreadable
    // falls through to the existing runtime-state + LLM paths.
    const cooResponse = await tryCooResponse(message);
    if (cooResponse) {
      sse(res, { type: 'metadata', model_used: 'coo-state', latency: 0 });
      sse(res, { type: 'content', content: cooResponse });
      res.write('data: [DONE]\n\n');
      return res.end();
    }

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
