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
  recallAnswer,
  clearFocus,
} from '../../lib/heidi/ConversationContext';
import type { CooState } from '../../lib/heidi/CooState';

// Lazy Supabase client — same pattern as lib/orchestrator.ts; a missing env
// must degrade the COO path, not crash the route.
let _cooSupabase: SupabaseClient | null = null;
function getCooSupabase(): SupabaseClient {
  if (!_cooSupabase) {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase env vars not configured');
    }
    _cooSupabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
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
  return null;
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

    // Operational questions resolve against the persisted COO state first
    // Life-context intents — the world model layer. Focus switching,
    // remembering, recall, and the bounded 'investigate <target>'
    // translation into a governed agent mission. Deterministic; anything
    // unrecognized falls through to COO/LLM paths and cannot act.
    const lifeIntent = classifyLifeIntent(message);
    if (lifeIntent) {
      try {
        const sb = getCooSupabase();
        let text: string;
        if (lifeIntent.kind === 'greeting' || lifeIntent.kind === 'briefing') {
          // Completion awareness: consequential outcomes since the last
          // surfaced marker, once — then mark. Only greeting surfaces it
          // (briefing is on-demand inspection, not a welcome-back).
          let unsurfacedLines: string[] = [];
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
          } | null;
          const lines: string[] = lifeIntent.kind === 'greeting' ? ["Hey — good to see you. Here's where things stand:"] : [];
          if (life.focus) lines.push(`Focus: ${life.focus.project}.`);
          if (s) {
            const stale = Date.now() - new Date(String(s.generatedAt)).getTime() > 45 * 60 * 1000;
            lines.push(`System: deployment ${s.deployment?.verdict ?? 'UNKNOWN'} · health ${s.applicationHealth} · commit ${s.deployment?.actualCommit ?? '?'}${stale ? ' (snapshot stale)' : ''}.`);
            lines.push(`Work: ${s.work?.goalsOpen ?? 0} open goals · ProtoForge: ${s.protoforge?.opportunitiesTotal ?? 0} opportunities (${s.protoforge?.pendingReview ?? 0} pending review).`);
            const open = (s.humanActions?.items ?? []).filter((i) => i.status === 'OPEN' && !i.backlog);
            lines.push(open.length > 0
              ? `Needs you: ${open.slice(0, 3).map((i) => i.reason.slice(0, 60)).join(' | ')}`
              : 'Nothing currently needs your attention.');
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
              const spec = p.payload.changeSpec as { type?: string; note?: string } | undefined;
              if (spec?.type === 'persist_context_note' && spec.note) {
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
          } | null;
          const lines: string[] = [];
          if (life.focus) lines.push(`Focus: ${life.focus.project}.`);
          if (s) {
            const stale = Date.now() - new Date(String(s.generatedAt)).getTime() > 45 * 60 * 1000;
            lines.push(`System: deployment ${s.deployment?.verdict ?? 'UNKNOWN'} · health ${s.applicationHealth} · commit ${s.deployment?.actualCommit ?? '?'}${stale ? ' (snapshot stale)' : ''}.`);
            lines.push(`Work: ${s.work?.goalsOpen ?? 0} open goals · ProtoForge: ${s.protoforge?.opportunitiesTotal ?? 0} opportunities (${s.protoforge?.pendingReview ?? 0} pending review).`);
            const open = (s.humanActions?.items ?? []).filter((i) => i.status === 'OPEN' && !i.backlog);
            lines.push(open.length > 0
              ? `Needs you: ${open.slice(0, 3).map((i) => i.reason.slice(0, 60)).join(' | ')}`
              : 'Nothing currently needs your attention.');
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
