/**
 * CooState — the COO state model. One authoritative snapshot across every
 * domain Heidi manages, built from live evidence only:
 *
 *   deployment   — DeploymentReconciliation report (identity contract)
 *   health       — system_dashboard current_status (semantic, separate)
 *   work         — heidi_goals by status + escalation/intervention queues
 *   protoforge   — latest mission run + opportunity queue shape
 *   revenue      — open opportunity count (read-only; no financial truth
 *                  claim — nothing here asserts reconciled revenue)
 *   memory       — recent non-cycle event counts
 *
 * nextAction is DETERMINISTIC and explainable: a fixed priority rule set
 * evaluated over collected state. It never manufactures work — when
 * nothing authorized requires action the answer is NO_ACTION_REQUIRED.
 *
 * This module is read-only. It never repairs, restarts, or approves.
 */

import type { Pool } from 'pg';
import { collectReconciliation, type ReconcileDeps, type ReconciliationReport } from './DeploymentReconciliation';
import { collectHumanActionQueue, type HumanActionQueue, type HumanAction } from './HumanActionQueue';
import { collectAgentState, type MissionStatus } from './AgentControlPlane';
import { collectOffers } from './CommercialBridge';

export interface CooNextAction {
  kind: 'capability' | 'human' | 'none';
  capabilityId?: string;
  reason: string;
}

export interface CooState {
  generatedAt: string;
  deployment: {
    verdict: ReconciliationReport['verdict'];
    identity: ReconciliationReport['deploymentIdentity'];
    expectedCommit: string | null;
    actualCommit: string | null;
    pm2Pid: number | null;
    daemonPid: number | null;
    failures: string[];
  };
  applicationHealth: ReconciliationReport['applicationHealth'];
  work: {
    goalsOpen: number;
    goalsInProgress: number;
    escalationsOpen: number;
    escalationsNew24h: number;
    interventionsPending: number;
    authEscalations24h: number;
  };
  /** Normalized cross-channel human-action read model. */
  humanActions: {
    open: number;
    backlogRowCount: number;
    items: HumanAction[];
  };
  protoforge: {
    lastRunAt: string | null;
    lastRunStatus: string | null;
    opportunitiesTotal: number;
    pendingReview: number;
    approved: number;
  };
  revenue: {
    opportunitiesOpen: number;
    /** Commercial offers folded from heidi_events — the truthful revenue
        boundary. Optional: absent in snapshots predating this field. */
    offers?: {
      total: number;
      byStage: Record<string, number>;
      /** Offers parked at a human boundary (AUTHORIZATION_REQUIRED or
          OFFER_BLOCKED), each with its durable stage reason. */
      boundary: Array<{ offerId: string; stage: string; reason: string | null }>;
      /** Sellable offers — CHECKOUT_READY with price identity. Test
          fixtures are excluded: they are evidence, not inventory. */
      ready: Array<{ offerId: string; product: string; priceCents: number; currency: string }>;
      /** Durable offers minted by test/qualification fixtures — kept out
          of every sellable surface. Optional: absent in older snapshots. */
      testOffers?: number;
    };
  };
  /** Multi-agent control plane (event-sourced, survives restart). */
  agents: {
    active: number;
    stale: number;
    missionsByStatus: Partial<Record<MissionStatus, number>>;
    recent: Array<{ missionId: string; role: string; status: MissionStatus; objective: string }>;
  };
  events24h: Record<string, number>;
  nextAction: CooNextAction;
  briefing: string;
}

export interface CooDeps extends ReconcileDeps {
  pool: Pick<Pool, 'query'>;
  reconcile?: () => Promise<ReconciliationReport>;
  now?: () => number;
}

async function one(pool: Pick<Pool, 'query'>, sql: string, params: unknown[] = []): Promise<number> {
  const r = await pool.query(sql, params);
  return parseInt(r.rows[0]?.n ?? '0', 10) || 0;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

/**
 * Deterministic next-action selection. Ordered rules; first match wins.
 * Every selection carries a machine-checkable reason.
 */
export function selectNextAction(s: Omit<CooState, 'nextAction' | 'briefing'>): CooNextAction {
  // The normalized human-action queue is authoritative for human gates:
  // interventions, pending authorization decisions, and fresh escalations
  // are real pending actions; backlog aggregates never select work.
  const firstOpen = s.humanActions.items.find((i) => i.status === 'OPEN' && !i.backlog);
  // Agent-safety failure outranks the human queue but not drift.
  if (s.agents.stale > 0 || (s.agents.missionsByStatus.FAILED ?? 0) > 0) {
    return {
      kind: 'human',
      reason: `${s.agents.stale} stale agent(s), ${s.agents.missionsByStatus.FAILED ?? 0} failed mission(s) — supervision anomaly requires review`,
    };
  }
  // 1. Deployment drift outranks everything — runtime truth first.
  if (s.deployment.verdict === 'DEPLOYMENT_DRIFT') {
    return {
      kind: 'capability',
      capabilityId: 'ops.recover_daemon_r0',
      reason: `deployment drift detected (${s.deployment.failures.join(', ') || 'unclassified'}); R0 recovery will re-check eligibility and refuse if not daemon_unavailable`,
    };
  }
  if (s.deployment.verdict === 'UNKNOWN') {
    return {
      kind: 'capability',
      capabilityId: 'ops.reconcile_deployment',
      reason: 'deployment identity unobservable — re-reconcile before any other work',
    };
  }
  // 2. The human-action queue: any non-backlog OPEN item is a pending
  //    human decision — report it, never execute it.
  if (firstOpen) {
    const total = s.humanActions.open;
    return {
      kind: 'human',
      reason: `${total} pending human action(s) — first: [${firstOpen.source}] ${firstOpen.reason} → ${firstOpen.requestedAction}`,
    };
  }
  // 3. Routine diagnostics keep the picture fresh.
  return { kind: 'none', reason: 'no authorized work required' };
}

export async function collectCooState(deps: CooDeps): Promise<CooState> {
  const now = deps.now ?? (() => Date.now());
  const reconcile = deps.reconcile ?? (() => collectReconciliation(deps));
  const [recon, queue, agentPlane] = await Promise.all([
    reconcile(), collectHumanActionQueue(deps.pool), collectAgentState(deps.pool),
  ]);

  const [goalsOpen, goalsInProgress, goalsWaitingHuman, autopilotStage, escalationsOpen, escalationsNew24h, interventionsPending, authEscalations24h] =
    await Promise.all([
      safe(() => one(deps.pool, `SELECT count(*) n FROM heidi_goals WHERE status IN ('pending','active','blocked','escalated')`), 0),
      safe(() => one(deps.pool, `SELECT count(*) n FROM heidi_goals WHERE status = 'in_progress'`), 0),
      // WAITING_ON_HUMAN goals — escalated with a durable human-action
      // link. Distinct from generic 'blocked': these resume on verified
      // human prerequisites, not on software repair.
      safe(() => one(deps.pool, `SELECT count(*) n FROM heidi_goals WHERE status = 'escalated' AND context->>'waitingOnHuman' = 'true'`), 0),
      // Revenue autopilot — the durable objective's current stage +
      // parked-on-human marker, read from its goal context.
      safe(async () => {
        const r = await deps.pool.query(
          `SELECT status, context->'autopilot'->>'stage' AS stage,
                  context->'autopilot'->>'offerName' AS offer,
                  context->'autopilot'->>'priceCents' AS price_cents,
                  context->>'waitingOnHuman' AS waiting
           FROM heidi_goals WHERE context->>'autopilotObjective' = 'true' ORDER BY created_at DESC LIMIT 1`,
        );
        const row = r.rows[0];
        return row ? { stage: row.stage ?? null, offer: row.offer ?? null, priceCents: row.price_cents ?? null, waiting: row.waiting === 'true', status: row.status } : null;
      }, null),
      safe(() => one(deps.pool, `SELECT count(*) n FROM operator_escalations WHERE resolved = false`), 0),
      safe(() => one(deps.pool, `SELECT count(*) n FROM operator_escalations WHERE resolved = false AND created_at > now() - interval '24 hours'`), 0),
      safe(() => one(deps.pool, `SELECT count(*) n FROM human_intervention_requests WHERE status = 'pending'`), 0),
      safe(() => one(deps.pool, `SELECT count(*) n FROM heidi_events WHERE event_type = 'authorization_escalation' AND created_at > now() - interval '24 hours'`), 0),
    ]);

  const proto = await safe(async () => {
    const run = await deps.pool.query(
      `SELECT run_at, status FROM protoforge_mission_runs ORDER BY run_at DESC LIMIT 1`,
    );
    const opps = await deps.pool.query(
      `SELECT count(*) FILTER (WHERE status = 'needs_review') AS pending,
              count(*) FILTER (WHERE approval_status = 'approved') AS approved,
              count(*) AS total
       FROM protoforge_opportunities`,
    );
    const o = opps.rows[0] ?? {};
    return {
      lastRunAt: run.rows[0]?.run_at ? new Date(run.rows[0].run_at).toISOString() : null,
      lastRunStatus: run.rows[0]?.status ?? null,
      opportunitiesTotal: parseInt(o.total ?? '0', 10) || 0,
      pendingReview: parseInt(o.pending ?? '0', 10) || 0,
      approved: parseInt(o.approved ?? '0', 10) || 0,
    };
  }, { lastRunAt: null, lastRunStatus: null, opportunitiesTotal: 0, pendingReview: 0, approved: 0 });

  const revenueOpps = await safe(
    () => one(deps.pool, `SELECT count(*) n FROM revenue_opportunities WHERE status IN ('open','proposal_sent')`),
    0,
  );

  const offers = await safe(() => collectOffers(deps.pool), []);
  const real = offers.filter((o) => !o.isTest);
  const offersSummary = {
    total: real.length,
    byStage: real.reduce<Record<string, number>>((acc, o) => {
      acc[o.stage] = (acc[o.stage] ?? 0) + 1;
      return acc;
    }, {}),
    boundary: real
      .filter((o) => o.stage === 'AUTHORIZATION_REQUIRED' || o.stage === 'OFFER_BLOCKED')
      .slice(0, 5)
      .map((o) => ({ offerId: o.offerId, stage: o.stage, reason: o.stageReason })),
    ready: real
      .filter((o) => o.stage === 'CHECKOUT_READY')
      .slice(0, 5)
      .map((o) => ({ offerId: o.offerId, product: o.product, priceCents: o.priceCents, currency: o.currency })),
    testOffers: offers.filter((o) => o.isTest).length,
  };

  const events24h = await safe(async () => {
    const r = await deps.pool.query(
      `SELECT event_type, count(*) n FROM heidi_events
       WHERE created_at > now() - interval '24 hours'
       GROUP BY event_type ORDER BY n DESC LIMIT 12`,
    );
    const out: Record<string, number> = {};
    for (const row of r.rows) out[row.event_type] = parseInt(row.n, 10) || 0;
    return out;
  }, {});

  const core: Omit<CooState, 'nextAction' | 'briefing'> = {
    generatedAt: new Date(now()).toISOString(),
    deployment: {
      verdict: recon.verdict,
      identity: recon.deploymentIdentity,
      expectedCommit: recon.expected.commit,
      actualCommit: recon.actual.lockCommit ?? recon.actual.cycleCommit,
      pm2Pid: recon.expected.pm2Pid,
      daemonPid: recon.actual.lockPid,
      failures: recon.failures,
    },
    applicationHealth: recon.applicationHealth,
    work: { goalsOpen, goalsInProgress, escalationsOpen, escalationsNew24h, interventionsPending, authEscalations24h },
    humanActions: {
      open: queue.open,
      backlogRowCount: queue.backlogRowCount,
      items: queue.items.slice(0, 10),
    },
    protoforge: proto,
    revenue: { opportunitiesOpen: revenueOpps, offers: offersSummary },
    agents: {
      active: agentPlane.activeCount,
      stale: agentPlane.staleCount,
      missionsByStatus: agentPlane.missions.reduce<Partial<Record<MissionStatus, number>>>((acc, m) => {
        acc[m.status] = (acc[m.status] ?? 0) + 1;
        return acc;
      }, {}),
      recent: agentPlane.missions.slice(-5).map((m) => ({
        missionId: m.missionId, role: m.role, status: m.status,
        objective: m.objective.slice(0, 80),
      })),
    },
    events24h,
  };

  const nextAction = selectNextAction(core);

  const briefing = [
    'HYDI COO BRIEF',
    `  Deployment:  ${recon.verdict} (identity ${recon.deploymentIdentity}, commit ${core.deployment.actualCommit ?? 'unknown'})`,
    `  Health:      ${recon.applicationHealth}`,
    `  Work:        ${goalsOpen} open goals, ${goalsInProgress} in progress, ${interventionsPending} interventions pending`,
    `  Escalations: ${escalationsOpen} open (${escalationsNew24h} new/24h) — historical backlog human-owned`,
    `  Human queue: ${queue.open} pending action(s), ${queue.backlogRowCount} backlog row(s) — ${queue.items.filter((i) => i.source === 'human_action' && i.status === 'OPEN').length} verifier-gated prerequisite(s)${goalsWaitingHuman > 0 ? ` · ${goalsWaitingHuman} mission(s) WAITING_ON_HUMAN` : ''}`,
    `  Agents:      ${agentPlane.activeCount} active, ${agentPlane.staleCount} stale, ${agentPlane.missions.length} mission(s) total`,
    `  ProtoForge:  last run ${proto.lastRunStatus ?? 'none'} at ${proto.lastRunAt ?? 'never'}; ${proto.opportunitiesTotal} opportunities (${proto.pendingReview} pending review, ${proto.approved} approved)`,
    `  Revenue:     ${revenueOpps} open opportunities; ${offersSummary.total} offer(s)${offersSummary.boundary.length > 0 ? ` — boundary: ${offersSummary.boundary.map((b) => `${b.offerId} ${b.stage} (${b.reason ?? 'no reason'})`).join(' | ')}` : ''} (read-only; no reconciled-revenue claim)`,
    `  Autopilot:   ${autopilotStage ? `${autopilotStage.stage ?? '—'}${autopilotStage.offer ? ` — ${autopilotStage.offer} @ ${autopilotStage.priceCents}¢` : ''}${autopilotStage.waiting ? ' — WAITING ON HUMAN' : ''}` : 'no objective yet'}`,
    `  Next:        ${nextAction.kind === 'capability' ? nextAction.capabilityId : nextAction.kind === 'human' ? 'HUMAN ACTION REQUIRED' : 'NO_ACTION_REQUIRED'} — ${nextAction.reason}`,
  ].join('\n');

  return { ...core, nextAction, briefing };
}
