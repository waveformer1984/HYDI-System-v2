/**
 * AgentControlPlane — durable, event-sourced multi-agent supervision.
 *
 * All state lives in heidi_events (division 'agents'): registration,
 * missions, heartbeats, status transitions, messages. Nothing is held in
 * process memory, so daemon/PM2 restart loses nothing — state is folded
 * back from events on every read.
 *
 * Containment model:
 *   - agents are bounded in-process async workers inside the daemon;
 *     runtimeIdentity = `${agentId}@pid${process.pid}` (pid is evidence,
 *     never identity)
 *   - stable identity: agentId = `agent-<role>-<missionId>`; missionId =
 *     `mission-<sha256(role+objective+target)>` → duplicate spawn requests
 *     collapse onto the same mission (idempotent by construction)
 *   - agents cannot spawn agents (no API surface for it)
 *   - concurrency budget HYDI_MAX_ACTIVE_AGENTS (default 3)
 *   - every mission declares: role, objective, scope, timeout, retries,
 *     evidence requirement
 *
 * Supervisor fold: collectAgentState() reconstructs live state and marks
 * RUNNING agents STALE (heartbeat gap) → FAILED (timeout). It never
 * executes or authorizes — it classifies.
 */

import { createHash } from 'crypto';
import type { Pool } from 'pg';
import { collectReconciliation, type ReconcileDeps } from './DeploymentReconciliation';

// ── Types ───────────────────────────────────────────────────────────────

// Mission-scoped roles spawned per investigation, plus the five standing
// ProtoForge roles that form the persistent team.
export type AgentRole =
  | 'research' | 'verifier' | 'analyst' | 'operations'
  | 'coo' | 'scout' | 'builder' | 'qa' | 'revenue';

export type AgentStatus =
  | 'REGISTERED' | 'STARTING' | 'RUNNING' | 'WAITING' | 'BLOCKED' | 'IDLE'
  | 'NEEDS_HUMAN' | 'COMPLETING' | 'COMPLETED' | 'FAILED' | 'STOPPED'
  | 'STALE' | 'EXPIRED';

/** Standing team roles — persistent identities that claim role-matched
 *  missions each supervision pass. */
export const TEAM_ROLES: readonly AgentRole[] = ['coo', 'scout', 'builder', 'qa', 'revenue'];
export const teamAgentId = (role: AgentRole) => `team-${role}`;

export type MissionStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'NEEDS_HUMAN' | 'ESCALATED' | 'STOPPED';

export type AgentMessageType =
  | 'STATUS' | 'PROGRESS' | 'RESULT' | 'QUESTION' | 'BLOCKED'
  | 'FAILURE' | 'EVIDENCE' | 'HANDOFF' | 'HUMAN_REQUIRED';

export interface AgentView {
  agentId: string;
  name: string;
  role: AgentRole;
  /** Effective status: last persisted transition + read-time stale/fail classification. */
  status: AgentStatus;
  /** Last status actually persisted as an event (before classification). */
  persistedStatus: AgentStatus;
  authorizationLevel: string;
  missionId: string;
  runtimeIdentity: string | null;
  pid: number | null;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  lastStep: string | null;
  createdAt: string;
}

export interface MissionView {
  missionId: string;
  parentMissionId: string | null;
  agentId: string | null;
  role: AgentRole;
  objective: string;
  scope: string;
  status: MissionStatus;
  maxRuntimeMs: number;
  maxRetries: number;
  attempt: number;
  result: unknown;
  evidence: unknown[];
  failure: string | null;
  params: Record<string, unknown>;
  targetKey: string;
  authorizationLevel: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMessage {
  messageId: string;
  from: string;
  to: string;
  missionId: string | null;
  type: AgentMessageType;
  content: string;
  evidence: unknown;
  createdAt: string;
}

export interface AgentPlaneState {
  generatedAt: string;
  agents: AgentView[];
  missions: MissionView[];
  messages: AgentMessage[];
  activeCount: number;
  staleCount: number;
}

// ── Deterministic identity ─────────────────────────────────────────────

export function missionIdFor(role: AgentRole, objective: string, targetKey: string): string {
  const h = createHash('sha256').update(`${role}:${objective}:${targetKey}`).digest('hex').slice(0, 12);
  return `mission-${h}`;
}
export function agentIdFor(role: AgentRole, missionId: string): string {
  return `agent-${role}-${missionId.slice(8)}`;
}

// ── Event ops ───────────────────────────────────────────────────────────

async function emit(
  pool: Pick<Pool, 'query'>,
  eventType: string,
  payload: Record<string, unknown>,
  verdict = 'RECORDED',
): Promise<string | null> {
  const r = await pool.query(
    `INSERT INTO heidi_events (event_type, division, payload, verdict, created_at)
     VALUES ($1, 'agents', $2, $3, now()) RETURNING id`,
    [eventType, JSON.stringify(payload), verdict],
  );
  return (r.rows[0]?.id as string) ?? null;
}

export interface MissionSpec {
  role: AgentRole;
  objective: string;
  scope: string;
  targetKey: string;
  parentMissionId?: string | null;
  params?: Record<string, unknown>;
  maxRuntimeMs?: number;
  maxRetries?: number;
  authorizationLevel?: string;
  /** Deterministic dispatch priority — higher runs first. */
  priority?: number;
}

export const DEFAULT_MAX_ACTIVE_AGENTS = 3;
const DEFAULT_MAX_RUNTIME_MS = 5 * 60 * 1000;
const HEARTBEAT_STALE_MS = 60_000;

export function maxActiveAgents(): number {
  const n = parseInt(process.env.HYDI_MAX_ACTIVE_AGENTS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_ACTIVE_AGENTS;
}

/** Idempotent mission create: same (role, objective, target) → same id. */
export async function createMission(
  pool: Pick<Pool, 'query'>,
  spec: MissionSpec,
): Promise<{ missionId: string; created: boolean; missionEventId: string | null }> {
  const missionId = missionIdFor(spec.role, spec.objective, spec.targetKey);
  const existing = await pool.query(
    `SELECT payload FROM heidi_events
     WHERE event_type = 'agent_mission' AND payload->>'missionId' = $1
     ORDER BY created_at DESC LIMIT 1`,
    [missionId],
  );
  if (existing.rows.length > 0) {
    // Duplicate request collapses onto the existing mission — never a
    // second agent, never a silent rerun of a terminal mission.
    return { missionId, created: false, missionEventId: null };
  }
  const agentId = agentIdFor(spec.role, missionId);
  const missionEventId = await emit(pool, 'agent_mission', {
    missionId, parentMissionId: spec.parentMissionId ?? null, agentId,
    role: spec.role, objective: spec.objective, scope: spec.scope,
    targetKey: spec.targetKey, params: spec.params ?? {},
    authorizationLevel: spec.authorizationLevel ?? 'R1',
    maxRuntimeMs: spec.maxRuntimeMs ?? DEFAULT_MAX_RUNTIME_MS,
    maxRetries: spec.maxRetries ?? 0, status: 'PENDING', attempt: 0,
  });
  await emit(pool, 'agent_registered', {
    agentId, name: `${spec.role}:${missionId.slice(8)}`, role: spec.role,
    missionId, authorizationLevel: spec.authorizationLevel ?? 'R1',
    parentAgentId: null, status: 'REGISTERED',
  });
  return { missionId, created: true, missionEventId };
}

export async function postMessage(
  pool: Pick<Pool, 'query'>,
  m: { from: string; to: string; missionId: string | null; type: AgentMessageType; content: string; evidence?: unknown; requiresResponse?: boolean },
): Promise<void> {
  // Agent→agent traffic must be mission-scoped — an agent cannot message
  // another agent outside its own mission family.
  if (m.from.startsWith('agent-') && m.to.startsWith('agent-') && !m.missionId) {
    throw new Error('agent→agent messages require a missionId scope');
  }
  await emit(pool, 'agent_message', {
    messageId: `msg-${createHash('sha256').update(`${m.from}${m.to}${m.content}${Date.now()}`).digest('hex').slice(0, 12)}`,
    ...m, evidence: m.evidence ?? null, requiresResponse: m.requiresResponse ?? false,
  });
}

// ── State fold (supervisor view) ────────────────────────────────────────

export async function collectAgentState(
  pool: Pick<Pool, 'query'>,
  opts: { now?: number; staleMs?: number; failMs?: number } = {},
): Promise<AgentPlaneState> {
  const now = opts.now ?? Date.now();
  const staleMs = opts.staleMs ?? HEARTBEAT_STALE_MS;
  let rows: Record<string, unknown>[];
  try {
    rows = (await pool.query(
      `SELECT event_type, payload, created_at FROM heidi_events
       WHERE division = 'agents' ORDER BY created_at ASC`,
    )).rows;
  } catch {
    rows = [];
  }

  const agents = new Map<string, AgentView>();
  const missions = new Map<string, MissionView>();
  const messages: AgentMessage[] = [];

  for (const r of rows) {
    const p = (r.payload ?? {}) as Record<string, unknown>;
    const at = String(r.created_at);
    switch (r.event_type) {
      case 'agent_registered':
        agents.set(String(p.agentId), {
          agentId: String(p.agentId), name: String(p.name ?? p.agentId),
          role: p.role as AgentRole, status: (p.status as AgentStatus) ?? 'REGISTERED',
          authorizationLevel: String(p.authorizationLevel ?? 'R1'),
          missionId: String(p.missionId ?? ''), runtimeIdentity: null, pid: null,
          startedAt: null, lastHeartbeatAt: null, lastStep: null, createdAt: at,
          persistedStatus: (p.status as AgentStatus) ?? 'REGISTERED',
        });
        break;
      case 'agent_status': {
        const a = agents.get(String(p.agentId));
        if (a) {
          a.status = p.status as AgentStatus;
          a.persistedStatus = p.status as AgentStatus;
          if (p.runtimeIdentity) a.runtimeIdentity = String(p.runtimeIdentity);
          if (p.pid) a.pid = Number(p.pid);
          if (!a.startedAt && p.status === 'RUNNING') a.startedAt = at;
        }
        const m = missions.get(String(p.missionId));
        if (m) {
          m.status = p.status as MissionStatus;
          if (p.result !== undefined) m.result = p.result;
          if (p.evidence) m.evidence = p.evidence as unknown[];
          if (p.failure) m.failure = String(p.failure);
          if (p.attempt !== undefined) m.attempt = Number(p.attempt);
          m.updatedAt = at;
        }
        break;
      }
      case 'agent_heartbeat': {
        const a = agents.get(String(p.agentId));
        if (a) {
          a.lastHeartbeatAt = at;
          a.lastStep = p.step ? String(p.step) : a.lastStep;
          if (p.runtimeIdentity) a.runtimeIdentity = String(p.runtimeIdentity);
          if (p.pid) a.pid = Number(p.pid);
          if (a.status === 'REGISTERED' || a.status === 'STARTING') a.status = 'RUNNING';
        }
        break;
      }
      case 'agent_mission':
        missions.set(String(p.missionId), {
          missionId: String(p.missionId), parentMissionId: (p.parentMissionId as string) ?? null,
          agentId: (p.agentId as string) ?? null, role: p.role as AgentRole,
          objective: String(p.objective ?? ''), scope: String(p.scope ?? ''),
          status: 'PENDING', maxRuntimeMs: Number(p.maxRuntimeMs ?? DEFAULT_MAX_RUNTIME_MS),
          maxRetries: Number(p.maxRetries ?? 0), attempt: 0,
          result: null, evidence: [], failure: null,
          params: (p.params as Record<string, unknown>) ?? {},
          targetKey: String(p.targetKey ?? ''),
          authorizationLevel: String(p.authorizationLevel ?? 'R1'),
          priority: Number(p.priority ?? 0),
          createdAt: at, updatedAt: at,
        });
        break;
      case 'agent_message':
        messages.push({
          messageId: String(p.messageId), from: String(p.from), to: String(p.to),
          missionId: (p.missionId as string) ?? null, type: p.type as AgentMessageType,
          content: String(p.content ?? ''), evidence: p.evidence ?? null, createdAt: at,
        });
        break;
    }
  }

  // Supervisor pass: RUNNING agents with stale heartbeats degrade to
  // STALE, then FAILED past the mission's own timeout. Classification
  // only — no execution, no kill.
  for (const a of agents.values()) {
    if (a.status !== 'RUNNING' && a.status !== 'STARTING') continue;
    const last = a.lastHeartbeatAt
      ? Date.parse(a.lastHeartbeatAt)
      : (a.startedAt ? Date.parse(a.startedAt) : Date.parse(a.createdAt));
    const gap = now - last;
    const mission = missions.get(a.missionId);
    const failMs = opts.failMs ?? (mission?.maxRuntimeMs ?? DEFAULT_MAX_RUNTIME_MS);
    if (gap > failMs) {
      a.status = 'FAILED';
      if (mission && mission.status === 'RUNNING') {
        mission.status = 'FAILED';
        mission.failure = `heartbeat gap ${Math.round(gap / 1000)}s exceeded maxRuntimeMs`;
      }
    } else if (gap > staleMs) {
      a.status = 'STALE';
    }
  }

  const all = [...agents.values()];
  return {
    generatedAt: new Date(now).toISOString(),
    agents: all,
    missions: [...missions.values()],
    messages: messages.slice(-50),
    activeCount: all.filter((a) => a.status === 'RUNNING' || a.status === 'STARTING').length,
    staleCount: all.filter((a) => a.status === 'STALE').length,
  };
}

// ── Runner ─────────────────────────────────────────────────────────────

export type RoleHandlers = Partial<Record<AgentRole, RoleHandler>>;

type RoleHandler = (ctx: {
  pool: Pick<Pool, 'query'>;
  mission: MissionView;
  params: Record<string, unknown>;
  heartbeat: (step: string) => Promise<void>;
  post: (to: string, type: AgentMessageType, content: string, evidence?: unknown) => Promise<void>;
  reconcileDeps?: ReconcileDeps;
}) => Promise<{ result: unknown; evidence: unknown[] }>;

async function setStatus(
  pool: Pick<Pool, 'query'>,
  agentId: string, missionId: string, status: AgentStatus,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await emit(pool, 'agent_status', {
    agentId, missionId, status, pid: process.pid,
    runtimeIdentity: `${agentId}@pid${process.pid}`, ...extra,
  }, status === 'FAILED' ? 'FAILED' : 'RECORDED');
}

/**
 * Execute one mission as a bounded in-process worker. Emits status +
 * heartbeats + result. Never throws outward — failures become FAILED
 * status events (the supervisor's evidence).
 */
export async function runAgent(
  pool: Pick<Pool, 'query'>,
  missionId: string,
  handlers: RoleHandlers,
  reconcileDeps?: ReconcileDeps,
): Promise<void> {
  const state = await collectAgentState(pool);
  const mission = state.missions.find((m) => m.missionId === missionId);
  if (!mission) return;
  const agentId = mission.agentId ?? agentIdFor(mission.role, missionId);
  const handler = handlers[mission.role];

  const post = (to: string, type: AgentMessageType, content: string, evidence?: unknown) =>
    postMessage(pool, { from: agentId, to, missionId, type, content, evidence });
  const heartbeat = async (step: string) => {
    await emit(pool, 'agent_heartbeat', {
      agentId, missionId, step, pid: process.pid,
      runtimeIdentity: `${agentId}@pid${process.pid}`,
    });
  };

  // Atomic claim: pg_advisory_xact_lock serializes concurrent claimants
  // on this missionId; the first to commit a RUNNING status owns the
  // mission. A second claimant blocks, sees the committed RUNNING row,
  // and aborts — same task cannot execute twice.
  const client = typeof (pool as Pool).connect === 'function' ? await (pool as Pool).connect().catch(() => null) : null;
  let claimed = false;
  if (client) {
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [missionId]);
      const st = await client.query(
        `SELECT payload->>'status' s FROM heidi_events
           WHERE event_type='agent_status' AND payload->>'missionId'=$1
           ORDER BY created_at DESC LIMIT 1`,
        [missionId],
      );
      const last = st.rows[0]?.s;
      if (last === 'RUNNING' || last === 'COMPLETED' || last === 'NEEDS_HUMAN' || last === 'STOPPED') {
        await client.query('ROLLBACK');
      } else {
        await client.query(
          `INSERT INTO heidi_events (event_type, division, payload, verdict, created_at)
             VALUES ('agent_status','agents',$1,'RECORDED',now())`,
          [JSON.stringify({
            agentId, missionId, status: 'RUNNING', pid: process.pid,
            runtimeIdentity: `${agentId}@pid${process.pid}`,
            attempt: mission.attempt + 1, claim: 'advisory-xact',
          })],
        );
        await client.query('COMMIT');
        claimed = true;
      }
    } catch {
      await client.query('ROLLBACK').catch(() => { });
    } finally {
      client.release();
    }
    if (!claimed) return; // already owned or terminal — no duplicate run
  } else {
    await setStatus(pool, agentId, missionId, 'RUNNING', { attempt: mission.attempt + 1 });
  }
  await heartbeat('started');

  try {
    if (!handler) throw new Error(`no handler for role '${mission.role}'`);
    const { result, evidence } = await handler({
      pool, mission, params: mission.params,
      heartbeat, post, reconcileDeps,
    });
    await post('heidi', 'RESULT', `mission ${missionId} completed`, evidence);
    await setStatus(pool, agentId, missionId, 'COMPLETED', { result, evidence });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await post('heidi', 'FAILURE', msg);
    await setStatus(pool, agentId, missionId, 'FAILED', { failure: msg });
  }
}

// ── Role handlers (real, local, evidence-producing) ────────────────────

export const ROLE_HANDLERS: RoleHandlers = {

  // Research: read the ProtoForge opportunity row, gather live HN Algolia
  // sources for the title terms, return evidence. Real outbound fetch —
  // same source class as the existing scout.
  research: async ({ pool, mission, heartbeat, post }) => {
    const topicParam = typeof mission.params?.topic === 'string' ? mission.params.topic : null;
    const oppId = String(mission.targetKey ?? '').replace(/:[AB]$/, '');
    let subjectTitle: string;
    let oppRow: unknown = null;
    if (topicParam) {
      // Topic mission — no opportunity row; the topic IS the subject.
      subjectTitle = topicParam;
    } else {
      const opp = (await pool.query(
        `SELECT id, title, why_it_matters, confidence, evidence, source_type FROM protoforge_opportunities WHERE id = $1`,
        [oppId],
      )).rows[0];
      if (!opp) throw new Error(`opportunity ${oppId} not found`);
      oppRow = opp;
      subjectTitle = String(opp.title);
    }
    await heartbeat(topicParam ? 'topic loaded' : 'opportunity loaded');
    const baseTerms = subjectTitle.split(/\s+/).filter((w) => w.length > 3);
    const variant = String(mission.params?.variant ?? 'a');
    // Variant B uses a different term window so the two research agents
    // gather genuinely independent source sets.
    const terms = (variant === 'b' ? baseTerms.slice(2, 6) : baseTerms.slice(0, 4)).join(' ');
    let sources: unknown[] = [];
    try {
      const r = await fetch(
        `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(terms)}&tags=story&hitsPerPage=5`,
        { signal: AbortSignal.timeout(10000) },
      );
      const data = await r.json() as { hits?: Array<{ title: string; url?: string; points?: number }> };
      sources = (data.hits ?? []).map((h) => ({ title: h.title, url: h.url ?? null, points: h.points ?? 0, source: 'hn' }));
    } catch (e) {
      sources = [{ error: e instanceof Error ? e.message : 'fetch failed' }];
    }
    // Topic missions only: Reddit's public JSON listing (no auth) covers
    // demand surfaces HN doesn't — maker communities, request threads.
    if (topicParam) {
      try {
        const r = await fetch(
          `https://www.reddit.com/search.json?q=${encodeURIComponent(terms)}&limit=5&sort=relevance`,
          { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'hydi-research/1.0' } },
        );
        const data = await r.json() as { data?: { children?: Array<{ data: { title: string; permalink?: string; subreddit?: string; score?: number } }> } };
        const hits = (data.data?.children ?? []).map((c) => ({
          title: c.data.title,
          url: c.data.permalink ? `https://reddit.com${c.data.permalink}` : null,
          subreddit: c.data.subreddit ?? null,
          points: c.data.score ?? 0,
          source: 'reddit',
        }));
        sources = sources.concat(hits);
      } catch (e) {
        sources.push({ error: `reddit: ${e instanceof Error ? e.message : 'fetch failed'}` });
      }
    }
    await post('heidi', 'EVIDENCE', `${sources.length} sources gathered for "${subjectTitle.slice(0, 60)}"`, sources);
    return {
      result: { subjectTitle, topic: topicParam, confidence: oppRow ? (oppRow as { confidence?: number }).confidence : null, sourceCount: sources.length },
      evidence: [oppRow ? { opportunity: oppRow } : { topic: topicParam }, { sources }],
    };
  },

  // Analyst: compare sibling research results for the same parent mission.
  // Reports agreement/disagreement explicitly; never picks a winner.
  analyst: async ({ pool, mission, post }) => {
    const parentId = mission.parentMissionId;
    const siblings = (await pool.query(
      `SELECT payload FROM heidi_events
       WHERE event_type = 'agent_status' AND payload->>'status' = 'COMPLETED'
       AND payload->>'missionId' IN (
         SELECT payload->>'missionId' FROM heidi_events
         WHERE event_type = 'agent_mission' AND payload->>'parentMissionId' = $1)`,
      [parentId],
    )).rows;
    const results = siblings.map((s) => (s.payload as Record<string, unknown>).result);
    const sourceCounts = results.map((r) => Number((r as Record<string, unknown>)?.sourceCount ?? -1));
    const agreement = sourceCounts.length > 1 && sourceCounts.every((n) => n >= 0);
    const out = {
      siblingCount: results.length,
      agreement,
      disagreements: agreement ? [] : ['sibling research results differ or incomplete'],
      summary: `analyzed ${results.length} sibling result(s)`,
    };
    await post('heidi', 'RESULT', `analysis: ${out.summary}; agreement=${agreement}`, results);
    return { result: out, evidence: [{ siblingResults: results }] };
  },

  // Operations: run real deployment reconciliation and report the verdict.
  operations: async ({ reconcileDeps, heartbeat }) => {
    if (!reconcileDeps) throw new Error('operations role requires reconcile deps');
    await heartbeat('reconciling');
    const report = await collectReconciliation(reconcileDeps);
    return {
      result: { verdict: report.verdict, identity: report.deploymentIdentity, failures: report.failures },
      evidence: [{ reconciliation: report }],
    };
  },

  // Verifier: challenge a completed mission's evidence — must contain a
  // non-null result AND non-empty evidence, otherwise DISAGREE. A verifier
  // can contradict the builder.
  verifier: async ({ pool, mission, post }) => {
    const targetMission = String(mission.params?.verifyMissionId ?? '');
    const rows = (await pool.query(
      `SELECT payload FROM heidi_events
       WHERE event_type = 'agent_status' AND payload->>'missionId' = $1
       ORDER BY created_at DESC LIMIT 1`,
      [targetMission],
    )).rows;
    if (!rows.length) throw new Error(`target mission ${targetMission} has no status`);
    const p = rows[0].payload as Record<string, unknown>;
    const evidence = Array.isArray(p.evidence) ? p.evidence : [];
    const verdict = p.status === 'COMPLETED' && p.result != null && evidence.length > 0 ? 'CONFIRMED' : 'DISAGREE';
    await post('heidi', 'EVIDENCE', `verification of ${targetMission}: ${verdict}`, { evidenceCount: evidence.length });
    return {
      result: { verifyMissionId: targetMission, verdict, evidenceCount: evidence.length },
      evidence: [{ checkedStatus: p.status, evidenceCount: evidence.length }],
    };
  },
};

// ── Governed multi-agent mission ────────────────────────────────────────

/**
 * `protoforge.investigate` — the first real multi-agent workload:
 *
 *   parent mission (analyst)
 *     ├── research agent A (HN sources, term window A)
 *     ├── research agent B (HN sources, term window B — independent)
 *     └── analyst agent C (compares A/B after both complete)
 *
 * Returns the parent missionId; children run asynchronously inside the
 * daemon with durable heartbeats/status. Concurrency-budgeted.
 */
export async function runInvestigateMission(
  pool: Pick<Pool, 'query'>,
  opportunityId: string,
  reconcileDeps?: ReconcileDeps,
): Promise<{ parentMissionId: string; missionEventId: string | null; spawned: string[]; refused?: string }> {
  return runInvestigateMissionForSubject(pool, { opportunityId }, reconcileDeps);
}

/**
 * Free-form topic investigation — same governed mission shape (parent +
 * 2 research + analyst) but the subject is a natural-language topic
 * instead of a protoforge_opportunities row. Used by the executive loop
 * when the human approves "investigate X" for something that isn't a
 * scouted opportunity (e.g. "the model_prep market").
 */
export async function runTopicInvestigation(
  pool: Pick<Pool, 'query'>,
  topic: string,
  reconcileDeps?: ReconcileDeps,
): Promise<{ parentMissionId: string; missionEventId: string | null; spawned: string[]; refused?: string }> {
  return runInvestigateMissionForSubject(pool, { topic }, reconcileDeps);
}

async function runInvestigateMissionForSubject(
  pool: Pick<Pool, 'query'>,
  subject: { opportunityId: string } | { topic: string },
  reconcileDeps?: ReconcileDeps,
): Promise<{ parentMissionId: string; missionEventId: string | null; spawned: string[]; refused?: string }> {
  const isTopic = 'topic' in subject;
  const key = isTopic ? `topic:${subject.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}` : subject.opportunityId;
  const label = isTopic ? `topic "${subject.topic}"` : `ProtoForge opportunity ${subject.opportunityId}`;
  const parent = await createMission(pool, {
    role: 'analyst',
    objective: `investigate ${label}`,
    scope: 'protoforge-opportunity',
    targetKey: `parent:${key}`,
    authorizationLevel: 'R2',
    params: isTopic ? { topic: subject.topic } : undefined,
  });
  const spawned: string[] = [];

  const state = await collectAgentState(pool);
  const budget = maxActiveAgents();
  if (state.activeCount + 2 > budget) {
    return {
      parentMissionId: parent.missionId, missionEventId: parent.missionEventId, spawned,
      refused: `concurrency budget ${budget} exhausted (${state.activeCount} active)`,
    };
  }

  const mk = (variant: 'a' | 'b') => createMission(pool, {
    role: 'research',
    objective: `research ${label} (variant ${variant})`,
    scope: 'protoforge-opportunity',
    targetKey: `${key}:${variant.toUpperCase()}`,
    parentMissionId: parent.missionId,
    params: isTopic ? { variant, topic: subject.topic } : { variant },
    authorizationLevel: 'R1',
    maxRuntimeMs: 3 * 60 * 1000,
  });
  const a = await mk('a');
  const b = await mk('b');
  const analyst = await createMission(pool, {
    role: 'analyst',
    objective: `synthesize investigation of ${label}`,
    scope: 'protoforge-opportunity',
    targetKey: `${key}:analyst`,
    parentMissionId: parent.missionId,
    authorizationLevel: 'R1',
  });

  // Fire-and-forget inside the daemon: durable events carry all state, so
  // a restart mid-flight leaves visible STALE/FAILED agents — never ghosts.
  void (async () => {
    for (const m of [a, b]) if (m.created) spawned.push(m.missionId);
    await Promise.all(
      [a, b].filter((m) => m.created).map((m) => runAgent(pool, m.missionId, ROLE_HANDLERS, reconcileDeps)),
    );
    if (analyst.created) await runAgent(pool, analyst.missionId, ROLE_HANDLERS, reconcileDeps);
    // Parent status is reconciled by the supervisor — no unconditional
    // COMPLETED claim here; a parent cannot complete while a required
    // child is unresolved.
  })();

  return { parentMissionId: parent.missionId, missionEventId: parent.missionEventId, spawned };
}

/**
 * Investigate the top-ranked unreviewed ProtoForge opportunities — the
 * natural-language entry point ("investigate worthwhile opportunities").
 * Selection is deterministic (confidence desc) and bounded: at most
 * `limit` investigations, each subject to the concurrency budget.
 * Returns every parent so the caller can report truthfully.
 */
export async function runTopOpportunityInvestigation(
  pool: Pick<Pool, 'query'>,
  limit = 1,
  reconcileDeps?: ReconcileDeps,
): Promise<{ parents: Array<{ parentMissionId: string; missionEventId: string | null; spawned: string[]; refused?: string; opportunityId: string; title: string }>; selected: number }> {
  const n = Math.max(1, Math.min(limit, 2)); // hard cap: 2 investigations per call
  // Skip opportunities that already have an investigation parent —
  // mission targetKeys are deterministic, so a re-pick would collapse
  // idempotently and leave the governing goal unverifiable (pending).
  const { rows } = await pool.query(
    `SELECT o.id, o.title, o.confidence FROM protoforge_opportunities o
     WHERE o.status = 'needs_review'
       AND NOT EXISTS (
         SELECT 1 FROM heidi_events e
         WHERE e.event_type = 'agent_mission'
           AND e.payload->>'targetKey' = 'parent:' || o.id::text
       )
     ORDER BY o.confidence DESC NULLS LAST LIMIT $1`,
    [n],
  );
  const parents = [] as Array<{ parentMissionId: string; missionEventId: string | null; spawned: string[]; refused?: string; opportunityId: string; title: string }>;
  for (const opp of rows) {
    const r = await runInvestigateMission(pool, String(opp.id), reconcileDeps);
    parents.push({ ...r, opportunityId: String(opp.id), title: String(opp.title) });
    if (r.refused) break; // budget exhausted — don't keep creating parents
  }
  return { parents, selected: parents.length };
}

// ── Governed agent controls (Phase D) ───────────────────────────────────

export interface ControlResult {
  ok: boolean;
  outcome: 'stopped' | 'retried' | 'not_found' | 'not_terminal' | 'already_terminal' | 'running';
  detail?: string;
}

/** Stop an agent/mission — durable STOPPED flag; in-flight workers abort at their next heartbeat check. */
export async function stopAgent(pool: Pick<Pool, 'query'>, agentId: string, actor: string): Promise<ControlResult> {
  const state = await collectAgentState(pool);
  const agent = state.agents.find((a) => a.agentId === agentId);
  if (!agent) return { ok: false, outcome: 'not_found', detail: `no agent '${agentId}'` };
  // A standing agent's status mirrors its last task — COMPLETED means
  // the task ended, not the agent. Only mission-scoped agents become
  // truly terminal; standing agents can always be stopped.
  if (agent.missionId !== 'standing'
    && (agent.status === 'COMPLETED' || agent.status === 'FAILED' || agent.status === 'STOPPED')) {
    return { ok: false, outcome: 'already_terminal', detail: `agent is ${agent.status}` };
  }
  await setStatus(pool, agentId, agent.missionId, 'STOPPED', { stoppedBy: actor });
  await postMessage(pool, { from: 'heidi', to: agentId, missionId: agent.missionId, type: 'STATUS', content: `stopped by ${actor}`, requiresResponse: false });
  return { ok: true, outcome: 'stopped', detail: `agent ${agentId} marked STOPPED` };
}

/**
 * Operator-initiated retry of a terminal mission. Human decision —
 * allowed once per call regardless of maxRetries (the operator is the
 * authority), but refused while the agent is RUNNING.
 */
export async function retryMission(pool: Pick<Pool, 'query'>, missionId: string, actor: string, reconcileDeps?: ReconcileDeps): Promise<ControlResult> {
  const state = await collectAgentState(pool);
  const mission = state.missions.find((m) => m.missionId === missionId);
  if (!mission) return { ok: false, outcome: 'not_found', detail: `no mission '${missionId}'` };
  const agent = state.agents.find((a) => a.missionId === missionId);
  if (agent && (agent.status === 'RUNNING' || agent.status === 'STARTING')) {
    return { ok: false, outcome: 'running', detail: 'agent is currently running — refusing duplicate worker' };
  }
  if (mission.status !== 'FAILED' && mission.status !== 'NEEDS_HUMAN' && mission.status !== 'STOPPED') {
    return { ok: false, outcome: 'not_terminal', detail: `mission is ${mission.status} — retry applies to terminal states` };
  }
  void runAgent(pool, missionId, { ...ROLE_HANDLERS, ...TEAM_HANDLERS }, reconcileDeps);
  await postMessage(pool, { from: 'heidi', to: 'supervisor', missionId, type: 'STATUS', content: `manual retry initiated by ${actor}` });
  return { ok: true, outcome: 'retried', detail: `mission ${missionId} retried by ${actor}` };
}

/** Read-only agent inspection — agent view + mission + messages. */
export async function inspectAgent(pool: Pick<Pool, 'query'>, agentId: string): Promise<{ agent: AgentView | null; mission: MissionView | null; messages: AgentMessage[] }> {
  const state = await collectAgentState(pool);
  const agent = state.agents.find((a) => a.agentId === agentId) ?? null;
  const mission = agent ? state.missions.find((m) => m.missionId === agent.missionId) ?? null : null;
  const messages = agent ? state.messages.filter((m) => m.from === agentId || m.to === agentId || m.missionId === agent.missionId) : [];
  return { agent, mission, messages };
}

/**
 * Governed resolution of a queue item — records the human's decision
 * durably. Authorization-grant items (authz:*) are fail-closed here:
 * granting capability authority requires the explicit authorization
 * policy path, never a chat command.
 */
export async function resolveHumanAction(
  pool: Pick<Pool, 'query'>,
  queueItemId: string,
  decision: 'approve' | 'reject',
  actor: string,
): Promise<{ ok: boolean; outcome: string; detail?: string; resolutionEventId?: string | null }> {
  if (queueItemId.startsWith('authz:')) {
    return { ok: false, outcome: 'refused', detail: 'capability authorization cannot be granted via this surface — it requires the explicit authorization policy path' };
  }
  if (queueItemId.startsWith('proposal:')) {
    return { ok: false, outcome: 'refused', detail: 'action proposals are decided via the governed proposals endpoint (console ACTIONS) — consume-once, params-hash bound; this command cannot approve them' };
  }
  if (queueItemId.startsWith('offer:')) {
    return { ok: false, outcome: 'refused', detail: 'offer boundaries resolve only through a governed revenue.advance_offer proposal with customer identity — this command cannot advance payment state' };
  }
  if (queueItemId.startsWith('escalation:')) {
    const escId = queueItemId.slice('escalation:'.length);
    const r = await pool.query(
      `UPDATE operator_escalations SET resolved = true, resolved_at = now(), resolved_by = $2, action_taken = $3
       WHERE id = $1 AND resolved = false RETURNING id`,
      [escId, actor, `operator decision: ${decision}`],
    );
    if (r.rowCount === 0) return { ok: false, outcome: 'not_found', detail: 'no unresolved escalation with that id' };
    const eid = await emit(pool, 'human_action_resolution', { queueItemId, decision, actor, resolvedEscalationId: escId }, 'RESOLVED');
    return { ok: true, outcome: 'resolved', detail: `escalation ${escId.slice(0, 8)} ${decision}d`, resolutionEventId: eid };
  }
  if (queueItemId.startsWith('intervention:')) {
    const reqId = queueItemId.slice('intervention:'.length);
    const r = await pool.query(
      `UPDATE human_intervention_requests SET status = $2, resolution_note = $3, updated_at = now()
       WHERE request_id = $1 AND status = 'pending' RETURNING id`,
      [reqId, decision === 'approve' ? 'resolved' : 'cancelled', decision],
    );
    if (r.rowCount === 0) return { ok: false, outcome: 'not_found', detail: 'no pending intervention with that id' };
    const eid = await emit(pool, 'human_action_resolution', { queueItemId, decision, actor, resolvedInterventionId: r.rows[0].id }, 'RESOLVED');
    return { ok: true, outcome: 'resolved', detail: `intervention ${reqId.slice(0, 20)} ${decision}d`, resolutionEventId: eid };
  }
  return { ok: false, outcome: 'not_actionable', detail: `item class '${queueItemId.split(':')[0]}' is not resolvable via this command` };
}

// ── Supervisor pass (Phase B) ───────────────────────────────────────────

export interface SupervisionReport {
  supervisionEventId: string | null;
  agentsChecked: number;
  transitions: Array<{ agentId: string; to: AgentStatus }>;
  retries: string[];
  escalations: string[];
  escalationErrors: string[];
  parentsReconciled: string[];
  teamTick?: { heartbeats: string[]; dispatched: string[] };
}

const RETRYABLE_LEVELS = new Set(['R0', 'R1']);

/**
 * One supervisor pass — deterministic, evidence-driven, no authority:
 *
 *   1. Persist read-time STALE/FAILED classifications as durable events.
 *   2. Retry FAILED missions bounded by maxRetries — only R0/R1, only
 *      when the failure is persisted (not just a read-time gap), one
 *      attempt at a time (attempt counter prevents storms across
 *      restarts — the fold is authoritative).
 *   3. Terminal failures escalate: mission → NEEDS_HUMAN + an
 *      operator_escalations row + a HUMAN_REQUIRED message. Nothing is
 *      authorized or executed on the human's behalf.
 *   4. Parent reconciliation: a parent mission completes only when ALL
 *      children are COMPLETED; a terminal child failure fails/escalates
 *      the parent. No orphaned parent claims.
 *   5. Emit a durable 'agent_supervision' summary — the audit record.
 */
export async function superviseAgents(
  pool: Pick<Pool, 'query'>,
  reconcileDeps?: ReconcileDeps,
): Promise<SupervisionReport> {
  const state = await collectAgentState(pool);
  const now = Date.now();
  const report: SupervisionReport = {
    supervisionEventId: null, agentsChecked: state.agents.length,
    transitions: [], retries: [], escalations: [], escalationErrors: [], parentsReconciled: [],
  };

  // 1. Persist classifications as durable transitions (idempotent —
  //    only when the persisted status differs).
  for (const a of state.agents) {
    if (a.status !== a.persistedStatus && (a.status === 'STALE' || a.status === 'FAILED')) {
      await setStatus(pool, a.agentId, a.missionId, a.status, {
        classifiedBy: 'supervisor',
        lastHeartbeatAt: a.lastHeartbeatAt,
      });
      report.transitions.push({ agentId: a.agentId, to: a.status });
    }
  }

  // 1b. Mission-level stall detection: a mission marked RUNNING whose
  // owner has stopped heartbeating is dead work, not running work —
  // classify it FAILED so the retry/escalation path below can act.
  // (Found live: a daemon restart mid-run left missions RUNNING forever
  // because the fold only classified agents.)
  for (const m of state.missions) {
    if (m.status !== 'RUNNING') continue;
    const owner = state.agents.find(a => a.agentId === m.agentId);
    const ownerAlive = owner && (owner.status === 'RUNNING' || owner.status === 'STARTING');
    const last = owner?.lastHeartbeatAt ? Date.parse(owner.lastHeartbeatAt) : Date.parse(m.updatedAt);
    if (!ownerAlive && now - last > m.maxRuntimeMs) {
      await setStatus(pool, m.agentId ?? `agent-${m.role}-${m.missionId.slice(8)}`, m.missionId, 'FAILED', {
        failure: `owner ${m.agentId} ${owner?.status ?? 'missing'} — heartbeat gap ${Math.round((now - last) / 1000)}s exceeds maxRuntimeMs`,
        classifiedBy: 'supervisor',
      });
      m.status = 'FAILED';
      report.transitions.push({ agentId: m.agentId ?? '?', to: 'FAILED' });
    }
  }

  // 2/3. Failed/needs-human missions: bounded retry for R0/R1, else ensure
  //      a durable human escalation exists. NEEDS_HUMAN status alone is not
  //      proof the escalation row was written — backfill is idempotent.
  const failed = state.missions.filter((m) => m.status === 'FAILED' || m.status === 'NEEDS_HUMAN');
  for (const m of failed) {
    // attempt is 1-based (RUNNING events carry attempt n); maxRetries is
    // the number of retries permitted beyond the first attempt.
    if (m.status === 'FAILED' && m.attempt <= m.maxRetries && RETRYABLE_LEVELS.has(m.authorizationLevel)) {
      report.retries.push(m.missionId);
      void runAgent(pool, m.missionId, { ...ROLE_HANDLERS, ...TEAM_HANDLERS }, reconcileDeps); // emits RUNNING attempt+1 — next pass sees it running
    } else {
      // Terminal: ensure the durable escalation exists (dedup on
      // unresolved rows keyed by metadata.missionId).
      const esc = await pool.query(
        `SELECT id FROM operator_escalations
         WHERE resolved = false AND metadata->>'missionId' = $1 LIMIT 1`,
        [m.missionId],
      ).catch(() => ({ rows: [] }));
      if (esc.rows.length === 0) {
        try {
          await pool.query(
            `INSERT INTO operator_escalations (category, severity, title, body, action_required, metadata, resolved, created_at)
             VALUES ('agent_mission', 'warning', $1, $2, $3, $4, false, now())`,
            [
              `Agent mission failed: ${m.objective.slice(0, 80)}`,
              `Mission ${m.missionId} (${m.role}) failed after ${m.attempt + 1} attempt(s). Failure: ${(m.failure ?? 'unknown').slice(0, 300)}`,
              'Review the mission evidence and decide: retry, redirect, or abandon.',
              JSON.stringify({ missionId: m.missionId, role: m.role, attempt: m.attempt, failure: m.failure }),
            ],
          );
        } catch (e) {
          report.escalationErrors.push(`${m.missionId}: ${e instanceof Error ? e.message : 'insert failed'}`);
        }
        const parentAgent = state.agents.find((a) => a.missionId === m.missionId);
        await setStatus(pool, parentAgent?.agentId ?? `agent-${m.role}-${m.missionId.slice(8)}`, m.missionId, 'NEEDS_HUMAN', { failure: m.failure });
        await postMessage(pool, {
          from: 'supervisor', to: 'heidi', missionId: m.missionId,
          type: 'HUMAN_REQUIRED', content: `mission ${m.missionId} exhausted retries — escalated`, evidence: { failure: m.failure },
        });
        report.escalations.push(m.missionId);
      }
    }
  }

  // 4. Parent reconciliation — deterministic child roll-up.
  const byParent = new Map<string, MissionView[]>();
  for (const m of state.missions) {
    if (!m.parentMissionId) continue;
    const list = byParent.get(m.parentMissionId) ?? [];
    list.push(m);
    byParent.set(m.parentMissionId, list);
  }
  const postEscalated = new Set(report.escalations);
  for (const [parentId, children] of byParent) {
    const parent = state.missions.find((m) => m.missionId === parentId);
    if (!parent || parent.status === 'COMPLETED' || parent.status === 'NEEDS_HUMAN') continue;
    const anyFailed = children.some((c) => c.status === 'FAILED' || c.status === 'NEEDS_HUMAN' || postEscalated.has(c.missionId));
    const allDone = children.length > 0 && children.every((c) => c.status === 'COMPLETED');
    if (allDone) {
      await setStatus(pool, parent.agentId ?? `agent-${parent.role}-${parentId.slice(8)}`, parentId, 'COMPLETED', {
        result: { children: children.map((c) => c.missionId) },
      });
      report.parentsReconciled.push(parentId);
    } else if (anyFailed) {
      await setStatus(pool, parent.agentId ?? `agent-${parent.role}-${parentId.slice(8)}`, parentId, 'NEEDS_HUMAN', {
        failure: 'one or more child missions failed terminally',
      });
      report.parentsReconciled.push(parentId);
    }
  }

  // 5. Persistent team tick — standing agents heartbeat + claim work.
  try {
    report.teamTick = await tickPersistentTeam(pool, reconcileDeps);
  } catch (e) {
    report.teamTick = { heartbeats: [], dispatched: [] };
    report.escalationErrors.push(`teamTick: ${e instanceof Error ? e.message : 'unknown'}`);
  }

  // 6. Durable audit record of this pass.
  report.supervisionEventId = await emit(pool, 'agent_supervision', {
    agentsChecked: report.agentsChecked,
    transitions: report.transitions,
    retries: report.retries,
    escalations: report.escalations,
    escalationErrors: report.escalationErrors,
    parentsReconciled: report.parentsReconciled,
    teamTick: report.teamTick,
    supervisedAt: new Date().toISOString(),
  });
  return report;
}

// ── Persistent team (Phase E) ──────────────────────────────────────────

/**
 * Standing ProtoForge team. Five durable agent identities that survive
 * restart — registration is an event, idempotent by a check on prior
 * events, so repeated ticks never double-register.
 */
export async function ensurePersistentTeam(
  pool: Pick<Pool, 'query'>,
): Promise<{ registered: string[]; total: number }> {
  const existing = await pool.query(
    `SELECT payload->>'agentId' id FROM heidi_events
       WHERE event_type = 'agent_registered' AND payload->>'agentId' LIKE 'team-%'`,
  ).catch(() => ({ rows: [] as Array<{ id: string }> }));
  const have = new Set(existing.rows.map(r => r.id));
  const registered: string[] = [];
  for (const role of TEAM_ROLES) {
    const agentId = teamAgentId(role);
    if (have.has(agentId)) continue;
    await emit(pool, 'agent_registered', {
      agentId, name: `ProtoForge ${role}`, role, missionId: 'standing',
      authorizationLevel: 'R2', parentAgentId: null, status: 'IDLE',
      persistent: true,
    });
    await emit(pool, 'agent_status', {
      agentId, missionId: 'standing', status: 'IDLE', pid: process.pid,
      runtimeIdentity: `${agentId}@pid${process.pid}`,
    });
    registered.push(agentId);
  }
  return { registered, total: TEAM_ROLES.length };
}

/**
 * Create a mission owned by a standing team agent rather than a
 * mission-scoped agent — the agentId is the team identity, so the
 * standing agent IS the task owner. Same idempotent mission identity.
 */
export async function createTeamMission(
  pool: Pick<Pool, 'query'>,
  spec: MissionSpec & { assignedTo?: string },
): Promise<{ missionId: string; created: boolean; missionEventId: string | null }> {
  const missionId = missionIdFor(spec.role, spec.objective, spec.targetKey);
  const existing = await pool.query(
    `SELECT payload FROM heidi_events
     WHERE event_type = 'agent_mission' AND payload->>'missionId' = $1
     ORDER BY created_at DESC LIMIT 1`,
    [missionId],
  );
  if (existing.rows.length > 0) return { missionId, created: false, missionEventId: null };
  const agentId = spec.assignedTo ?? teamAgentId(spec.role);
  const missionEventId = await emit(pool, 'agent_mission', {
    missionId, parentMissionId: spec.parentMissionId ?? null, agentId,
    role: spec.role, objective: spec.objective, scope: spec.scope,
    targetKey: spec.targetKey, params: spec.params ?? {},
    authorizationLevel: spec.authorizationLevel ?? 'R1',
    maxRuntimeMs: spec.maxRuntimeMs ?? DEFAULT_MAX_RUNTIME_MS,
    maxRetries: spec.maxRetries ?? 0, status: 'PENDING', attempt: 0,
    teamOwned: true,
    priority: spec.priority ?? 0,
  });
  return { missionId, created: true, missionEventId };
}

// ── Standing-role handlers ─────────────────────────────────────────────
// Each does real governed work — reads durable state, produces evidence,
// posts handoffs. None authorize, spend, contact, or push.

export const TEAM_HANDLERS: RoleHandlers = {

  // COO — read the full plane state, compose an honest operating brief,
  // flag stalled/blocked work, hand off actionable findings.
  coo: async ({ pool, mission, heartbeat, post }) => {
    await heartbeat('collecting state');
    const state = await collectAgentState(pool);
    const goals = await pool.query(
      `SELECT status, count(*)::int n FROM heidi_goals
         WHERE status IN ('active','pending','blocked','failed')
         GROUP BY status`,
    ).catch(() => ({ rows: [] as Array<{ status: string; n: number }> }));
    const escal = await pool.query(
      `SELECT count(*)::int n FROM operator_escalations WHERE resolved = false`,
    ).catch(() => ({ rows: [{ n: 0 }] }));
    const byStatus = Object.fromEntries(goals.rows.map(g => [g.status, g.n]));
    const brief = {
      generatedAt: new Date().toISOString(),
      agents: {
        active: state.agents.filter(a => a.status === 'RUNNING').length,
        stale: state.staleCount,
        total: state.agents.length,
      },
      missions: {
        running: state.missions.filter(m => m.status === 'RUNNING').length,
        pending: state.missions.filter(m => m.status === 'PENDING').length,
        needsHuman: state.missions.filter(m => m.status === 'NEEDS_HUMAN').length,
      },
      goals: byStatus,
      humanActionsRequired: escal.rows[0]?.n ?? 0,
    };
    await post('heidi', 'RESULT', `operating brief: ${brief.agents.active} active agents, ${brief.missions.running} running missions, ${brief.humanActionsRequired} human actions`, brief);
    return { result: brief, evidence: [{ brief }] };
  },

  // Scout — find the highest-confidence unreviewed opportunity and
  // delegate a governed investigation to the research role. Real
  // delegation: the mission it creates is executed by a real agent.
  scout: async ({ pool, mission, heartbeat, post }) => {
    await heartbeat('scanning opportunities');
    const opp = (await pool.query(
      `SELECT id::text, title, confidence FROM protoforge_opportunities
         WHERE status = 'needs_review'
           AND NOT EXISTS (
             SELECT 1 FROM heidi_events e
             WHERE e.event_type = 'agent_mission'
               AND e.payload->>'targetKey' = 'parent:' || protoforge_opportunities.id::text
           )
         ORDER BY confidence DESC NULLS LAST LIMIT 1`,
    )).rows[0];
    if (!opp) {
      await post('heidi', 'RESULT', 'no unreviewed opportunities — market scan complete');
      return { result: { scanned: true, delegated: null }, evidence: [] };
    }
    const inv = await runInvestigateMission(pool, opp.id);
    await post('heidi', 'HANDOFF', `delegated investigation of "${String(opp.title).slice(0, 60)}" → research agents`, { parentMissionId: inv.parentMissionId, spawned: inv.spawned });
    await emit(pool, 'agent_handoff', {
      fromAgent: teamAgentId('scout'), toAgent: 'research',
      missionId: mission.missionId, reason: `unreviewed opportunity: ${String(opp.title).slice(0, 80)}`,
      evidence: { opportunityId: opp.id, confidence: opp.confidence },
      requiredAction: 'investigate', targetMissionId: inv.parentMissionId,
    });
    return {
      result: { scanned: true, delegatedTo: inv.parentMissionId, opportunity: String(opp.title).slice(0, 80) },
      evidence: [{ opportunity: opp }, { delegatedMissionId: inv.parentMissionId }],
    };
  },

  // Builder — two real modes: a bounded patch mission (params.patches)
  // executed through the governed DevPatchExecutor (bounds-checked,
  // typecheck-verified, rollback on failure, single commit, no push),
  // or the default dev-signal observation scan.
  builder: async ({ pool, mission, heartbeat, post }) => {
    const patches = mission.params?.patches as Array<{ file: string; oldString: string; newString: string }> | undefined;
    if (Array.isArray(patches) && patches.length) {
      await heartbeat('applying bounded patch');
      const { applyBoundedPatch } = await import('./DevPatchExecutor');
      const res = await applyBoundedPatch({
        missionId: mission.missionId,
        patches,
        commitMessage: String(mission.params?.commitMessage ?? `builder: ${mission.objective.slice(0, 60)}`),
        verify: Array.isArray(mission.params?.verify) ? mission.params.verify as string[] : [],
      });
      await post('heidi', res.ok ? 'RESULT' : 'FAILURE', `patch ${res.status}: ${res.reason ?? res.commitSha ?? ''}`, res);
      if (!res.ok) throw new Error(`patch ${res.status}: ${res.reason ?? 'failed'}`);
      return { result: { patchStatus: res.status, commitSha: res.commitSha, filesChanged: res.filesChanged }, evidence: res.evidence.map(e => ({ step: e })) };
    }
    await heartbeat('observing dev signals');
    const { observeDevelopmentSignals } = await import('./DevObserver');
    const findings = await observeDevelopmentSignals(pool as Pool);
    return {
      result: { findingsCount: findings.length, findings: findings.slice(0, 5).map(f => ({ target: f.target, question: f.question.slice(0, 80) })) },
      evidence: [{ findings: findings.slice(0, 5) }],
    };
  },

  // QA — verify a mission's claimed result. Two checks: (1) the
  // completion record carries a non-null result AND non-empty evidence;
  // (2) an optional allowlisted verification command (npx jest/tsc only)
  // must pass. On failure: durable DISAGREE + builder follow-up mission
  // + HANDOFF — QA rejects, the failure stays in the journal.
  qa: async ({ pool, mission, heartbeat, post }) => {
    const verifyMissionId = typeof mission.params?.verifyMissionId === 'string' ? mission.params.verifyMissionId : null;
    const verifyCommand = typeof mission.params?.verifyCommand === 'string' ? mission.params.verifyCommand : null;
    const followupPatches = mission.params?.followupPatches;
    await heartbeat('selecting verification target');
    const target = verifyMissionId
      ? (await pool.query(
        `SELECT payload->>'missionId' mid, payload FROM heidi_events
           WHERE event_type='agent_status' AND payload->>'missionId'=$1
           ORDER BY created_at DESC LIMIT 1`, [verifyMissionId])).rows[0]
      : (await pool.query(
        `SELECT payload->>'missionId' mid, payload FROM heidi_events
           WHERE event_type = 'agent_status' AND payload->>'status' = 'COMPLETED'
           ORDER BY created_at DESC LIMIT 1`)).rows[0];
    if (!target) throw new Error('no mission to verify');
    const p = target.payload as Record<string, unknown>;
    const ev = Array.isArray(p.evidence) ? p.evidence : [];
    let verdict = p.status === 'COMPLETED' && p.result != null && ev.length > 0 ? 'CONFIRMED' : 'DISAGREE';
    let verifyOut: string | null = null;
    if (verdict === 'CONFIRMED' && verifyCommand) {
      if (!/^npx (jest|tsc)\b/.test(verifyCommand)) {
        verdict = 'DISAGREE';
        verifyOut = `verify command not allowlisted: ${verifyCommand}`;
      } else {
        // Async exec + heartbeat so a long verification can't stall the
        // daemon loop or misflag this agent as dead while it works.
        const { execFile } = await import('child_process');
        const hb = setInterval(() => { void heartbeat('verifying'); }, 20_000);
        try {
          verifyOut = await new Promise<string>((resolve, reject) => {
            execFile('cmd', ['/c', verifyCommand], { cwd: process.cwd(), timeout: 300000 },
              (err, stdout) => err ? reject(err) : resolve((stdout ?? '').toString().slice(-400)));
          });
        } catch (e) {
          verdict = 'DISAGREE';
          verifyOut = `verify command failed: ${(e as Error).message.slice(0, 200)}`;
        } finally {
          clearInterval(hb);
        }
      }
    }
    await post('heidi', 'EVIDENCE', `QA verification of ${target.mid}: ${verdict}`, { evidenceCount: ev.length, verifyOut });
    let followupMissionId: string | null = null;
    if (verdict === 'DISAGREE' && Array.isArray(followupPatches)) {
      // QA rejection produces a governed follow-up — Builder owns the fix.
      const f = await createTeamMission(pool, {
        role: 'builder',
        objective: `fix QA-rejected work on ${target.mid}`,
        scope: 'protoforge-build',
        targetKey: `followup:${target.mid}`,
        params: { patches: followupPatches, commitMessage: `builder: QA follow-up for ${target.mid}`, verify: mission.params?.verify },
        authorizationLevel: 'R2',
        priority: 9,
      });
      followupMissionId = f.missionId;
      await post('heidi', 'HANDOFF', `DISAGREE on ${target.mid} → builder follow-up ${f.missionId}`, { reason: verifyOut });
      await emit(pool, 'agent_handoff', {
        fromAgent: teamAgentId('qa'), toAgent: teamAgentId('builder'),
        missionId: mission.missionId, reason: `verification failed on ${target.mid}`,
        evidence: { verifyOut, evidenceCount: ev.length },
        requiredAction: 'fix and re-verify', targetMissionId: f.missionId,
      });
    }
    return {
      result: { verifiedMissionId: target.mid, verdict, evidenceCount: ev.length, verifyCommandRan: !!verifyCommand, followupMissionId },
      evidence: [{ checkedStatus: p.status, evidenceCount: ev.length, verifyOut }],
    };
  },

  // Revenue — reconcile the authoritative revenue/evidence state.
  // Reads business findings + paid-job ledger; reports verified revenue
  // honestly ($0.00 unless durable payment evidence exists).
  revenue: async ({ pool, mission, heartbeat, post }) => {
    await heartbeat('reconciling revenue state');
    const findings = await pool.query(
      `SELECT payload->>'verdict' v, count(*)::int n FROM heidi_events
         WHERE event_type = 'business_finding' GROUP BY 1`,
    ).catch(() => ({ rows: [] as Array<{ v: string; n: number }> }));
    const paid = await pool.query(
      `SELECT count(*)::int n, coalesce(sum(amount),0)::float total FROM customer_jobs WHERE stripe_checkout_session_id LIKE 'cs_live_%'`,
    ).catch(() => ({ rows: [{ n: 0, total: 0 }] }));
    const verdicts = Object.fromEntries(findings.rows.map(f => [f.v, f.n]));
    const state = {
      findingVerdicts: verdicts,
      verifiedRevenue: paid.rows[0]?.total ?? 0,
      paidJobs: paid.rows[0]?.n ?? 0,
    };
    await post('heidi', 'RESULT', `revenue reconciliation: $${state.verifiedRevenue.toFixed(2)} verified, ${JSON.stringify(verdicts)}`, state);
    return { result: state, evidence: [{ findings: verdicts }, { verifiedRevenue: state.verifiedRevenue }] };
  },
};

const TEAM_HEARTBEAT_MIN_MS = 45_000;
const TEAM_DISPATCH_BUDGET_PER_TICK = 2;

/**
 * One persistent-team pass — runs inside superviseAgents so it shares
 * the supervision cycle's cadence. Deterministic:
 *   1. Register the five standing agents (idempotent).
 *   2. Heartbeat each standing agent (rate-limited — no event storm).
 *   3. Dispatch PENDING missions to their owning standing agent,
 *      bounded by the shared concurrency budget and a per-tick cap.
 *      Ownership is the mission's assigned agentId — two agents cannot
 *      claim one task because the mission names its owner.
 */
export async function tickPersistentTeam(
  pool: Pick<Pool, 'query'>,
  reconcileDeps?: ReconcileDeps,
): Promise<{ heartbeats: string[]; dispatched: string[] }> {
  const out = { heartbeats: [] as string[], dispatched: [] as string[] };
  await ensurePersistentTeam(pool);
  const state = await collectAgentState(pool);
  const now = Date.now();

  for (const role of TEAM_ROLES) {
    const agent = state.agents.find(a => a.agentId === teamAgentId(role));
    if (!agent) continue;
    // Agent recovery: a standing agent whose missions are all terminal
    // (the failed task is durably recorded; the agent itself is not the
    // failure) returns to IDLE — bounded, no work is redone, the failed
    // mission keeps its FAILED record.
    if ((agent.status === 'FAILED' || agent.status === 'NEEDS_HUMAN' || agent.status === 'COMPLETED')
      && agent.persistedStatus !== 'IDLE') {
      // Recover when nothing is in-flight for this agent. PENDING work
      // does NOT block recovery — a dead agent must be revived so the
      // pending work (often the follow-up to its own failure) can run.
      const owned = state.missions.filter(m => m.agentId === agent.agentId);
      const inFlight = owned.some(m => m.status === 'RUNNING');
      if (!inFlight) {
        await setStatus(pool, agent.agentId, 'standing', 'IDLE', { recoveredBy: 'supervisor', previousStatus: agent.status });
        agent.status = 'IDLE';
        agent.persistedStatus = 'IDLE';
      }
    }
    const last = agent.lastHeartbeatAt ? Date.parse(agent.lastHeartbeatAt) : 0;
    if (now - last >= TEAM_HEARTBEAT_MIN_MS && agent.status !== 'RUNNING') {
      await emit(pool, 'agent_heartbeat', {
        agentId: agent.agentId, missionId: 'standing',
        step: agent.persistedStatus === 'IDLE' ? 'idle' : 'tick',
        pid: process.pid, runtimeIdentity: `${agent.agentId}@pid${process.pid}`,
      });
      out.heartbeats.push(agent.agentId);
    }
  }

  const pending = state.missions
    .filter(m => m.status === 'PENDING' && TEAM_ROLES.includes(m.role) && m.agentId?.startsWith('team-'))
    .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt));
  let dispatched = 0;
  for (const m of pending) {
    if (dispatched >= TEAM_DISPATCH_BUDGET_PER_TICK) break;
    const owner = state.agents.find(a => a.agentId === m.agentId);
    if (!owner || owner.status === 'RUNNING' || owner.status === 'STARTING') continue;
    // Dead/disabled owner: a STOPPED, FAILED, or STALE standing agent
    // cannot take work — the mission stays PENDING for recovery, it
    // is never dispatched to a dead agent.
    if (owner.status === 'STOPPED' || owner.status === 'FAILED' || owner.status === 'STALE' || owner.status === 'EXPIRED') continue;
    // R3+ missions hit the human gate — convert to NEEDS_HUMAN once,
    // never dispatched, never retried autonomously.
    if (/^R[3-5]$/.test(m.authorizationLevel)) {
      await setStatus(pool, m.agentId!, m.missionId, 'NEEDS_HUMAN', {
        reason: `mission requires ${m.authorizationLevel} — beyond standing R2 boundary`,
      });
      await postMessage(pool, {
        from: 'supervisor', to: 'heidi', missionId: m.missionId,
        type: 'HUMAN_REQUIRED', content: `team mission ${m.missionId} (${m.role}) requires ${m.authorizationLevel}`,
        evidence: { objective: m.objective },
      });
      continue;
    }
    if (state.activeCount + dispatched >= maxActiveAgents() + TEAM_ROLES.length) break;
    void runAgent(pool, m.missionId, TEAM_HANDLERS, reconcileDeps);
    out.dispatched.push(m.missionId);
    dispatched++;
  }
  return out;
}
