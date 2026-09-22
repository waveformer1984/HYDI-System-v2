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

export type AgentRole = 'research' | 'verifier' | 'analyst' | 'operations';

export type AgentStatus =
  | 'REGISTERED' | 'STARTING' | 'RUNNING' | 'WAITING' | 'BLOCKED'
  | 'NEEDS_HUMAN' | 'COMPLETING' | 'COMPLETED' | 'FAILED' | 'STOPPED'
  | 'STALE' | 'EXPIRED';

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
  m: { from: string; to: string; missionId: string | null; type: AgentMessageType; content: string; evidence?: unknown },
): Promise<void> {
  await emit(pool, 'agent_message', {
    messageId: `msg-${createHash('sha256').update(`${m.from}${m.to}${m.content}${Date.now()}`).digest('hex').slice(0, 12)}`,
    ...m, evidence: m.evidence ?? null,
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
  handlers: Record<AgentRole, RoleHandler>,
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

  await setStatus(pool, agentId, missionId, 'RUNNING', { attempt: mission.attempt + 1 });
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

export const ROLE_HANDLERS: Record<AgentRole, RoleHandler> = {

  // Research: read the ProtoForge opportunity row, gather live HN Algolia
  // sources for the title terms, return evidence. Real outbound fetch —
  // same source class as the existing scout.
  research: async ({ pool, mission, heartbeat, post }) => {
    const oppId = String(mission.targetKey ?? '').replace(/:[AB]$/, '');
    const opp = (await pool.query(
      `SELECT id, title, why_it_matters, confidence, evidence, source_type FROM protoforge_opportunities WHERE id = $1`,
      [oppId],
    )).rows[0];
    if (!opp) throw new Error(`opportunity ${oppId} not found`);
    await heartbeat('opportunity loaded');
    const baseTerms = String(opp.title).split(/\s+/).filter((w) => w.length > 3);
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
      sources = (data.hits ?? []).map((h) => ({ title: h.title, url: h.url ?? null, points: h.points ?? 0 }));
    } catch (e) {
      sources = [{ error: e instanceof Error ? e.message : 'fetch failed' }];
    }
    await post('heidi', 'EVIDENCE', `${sources.length} sources gathered for "${String(opp.title).slice(0, 60)}"`, sources);
    return {
      result: { opportunityTitle: opp.title, confidence: opp.confidence, sourceCount: sources.length },
      evidence: [{ opportunity: opp }, { sources }],
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
  const parent = await createMission(pool, {
    role: 'analyst',
    objective: `investigate ProtoForge opportunity ${opportunityId}`,
    scope: 'protoforge-opportunity',
    targetKey: `parent:${opportunityId}`,
    authorizationLevel: 'R2',
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
    objective: `research opportunity ${opportunityId} (variant ${variant})`,
    scope: 'protoforge-opportunity',
    targetKey: `${opportunityId}:${variant.toUpperCase()}`,
    parentMissionId: parent.missionId,
    params: { variant },
    authorizationLevel: 'R1',
    maxRuntimeMs: 3 * 60 * 1000,
  });
  const a = await mk('a');
  const b = await mk('b');
  const analyst = await createMission(pool, {
    role: 'analyst',
    objective: `synthesize investigation of ${opportunityId}`,
    scope: 'protoforge-opportunity',
    targetKey: `${opportunityId}:analyst`,
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

// ── Supervisor pass (Phase B) ───────────────────────────────────────────

export interface SupervisionReport {
  supervisionEventId: string | null;
  agentsChecked: number;
  transitions: Array<{ agentId: string; to: AgentStatus }>;
  retries: string[];
  escalations: string[];
  parentsReconciled: string[];
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
  const report: SupervisionReport = {
    supervisionEventId: null, agentsChecked: state.agents.length,
    transitions: [], retries: [], escalations: [], parentsReconciled: [],
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

  // 2/3. Failed missions: bounded retry for R0/R1, else escalate.
  const failed = state.missions.filter((m) => m.status === 'FAILED');
  for (const m of failed) {
    // attempt is 1-based (RUNNING events carry attempt n); maxRetries is
    // the number of retries permitted beyond the first attempt.
    if (m.attempt <= m.maxRetries && RETRYABLE_LEVELS.has(m.authorizationLevel)) {
      report.retries.push(m.missionId);
      void runAgent(pool, m.missionId, ROLE_HANDLERS, reconcileDeps); // emits RUNNING attempt+1 — next pass sees it running
    } else {
      // Terminal: escalate once (dedup on unresolved escalation rows).
      const esc = await pool.query(
        `SELECT id FROM operator_escalations
         WHERE resolved = false AND metadata->>'missionId' = $1 LIMIT 1`,
        [m.missionId],
      ).catch(() => ({ rows: [] }));
      if (esc.rows.length === 0 && m.status !== 'NEEDS_HUMAN') {
        await pool.query(
          `INSERT INTO operator_escalations (category, severity, title, body, action_required, metadata, resolved, created_at)
           VALUES ('agent_mission', 'medium', $1, $2, $3, $4, false, now())`,
          [
            `Agent mission failed: ${m.objective.slice(0, 80)}`,
            `Mission ${m.missionId} (${m.role}) failed after ${m.attempt + 1} attempt(s). Failure: ${(m.failure ?? 'unknown').slice(0, 300)}`,
            'Review the mission evidence and decide: retry, redirect, or abandon.',
            JSON.stringify({ missionId: m.missionId, role: m.role, attempt: m.attempt, failure: m.failure }),
          ],
        ).catch(() => undefined);
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

  // 5. Durable audit record of this pass.
  report.supervisionEventId = await emit(pool, 'agent_supervision', {
    agentsChecked: report.agentsChecked,
    transitions: report.transitions,
    retries: report.retries,
    escalations: report.escalations,
    parentsReconciled: report.parentsReconciled,
    supervisedAt: new Date().toISOString(),
  });
  return report;
}
