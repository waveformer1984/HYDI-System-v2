/**
 * ActionController — the autonomous-execution fold. The daemon already
 * selects, executes, verifies, and continues without human prompting;
 * this module makes that state explainable from durable rows alone:
 *
 *   "What is HYDI doing, why, and what happens next?"
 *
 * It also produces the explicit NO_ACTION_REQUIRED decision — autonomy
 * includes the authority to decide nothing needs doing.
 */
import { Pool } from 'pg';

export interface AutonomousState {
  mode: 'EXECUTING' | 'IDLE_NO_ELIGIBLE_WORK' | 'BLOCKED_ON_HUMAN';
  currentGoal: { id: string; title: string; capability: string | null; priority: number } | null;
  queueDepth: number;
  humanBlockers: number;
  openPlans: number;
  replans: number;
  nextAction: string;
  reason: string;
  resources: { ollamaAvailable: boolean | null; models: string[] };
}

export async function autonomousState(pool: Pool): Promise<AutonomousState> {
  const q = async (sql: string, params?: unknown[]) =>
    (await pool.query(sql, params).catch(() => ({ rows: [] }))).rows as Array<Record<string, unknown>>;

  const open = await q(
    `SELECT id, title, priority, context, created_at FROM heidi_goals
       WHERE status IN ('active','pending','in_progress') ORDER BY priority DESC, created_at ASC LIMIT 50`,
  );
  const blockers = await q(`SELECT count(*)::int c FROM human_intervention_requests WHERE status='pending'`);
  const plans = await q(`SELECT count(*)::int c FROM heidi_events WHERE event_type='plan' AND created_at > now() - interval '24 hours'`);
  const replans = await q(`SELECT count(*)::int c FROM heidi_events WHERE event_type='replan'`);
  const catalog = await q(`SELECT payload FROM heidi_events WHERE event_type='model_catalog' ORDER BY created_at DESC LIMIT 1`);

  const resources = {
    ollamaAvailable: catalog[0] ? true : null,
    models: ((catalog[0]?.payload as { models?: Array<{ name: string }> })?.models ?? []).map(m => m.name),
  };

  const current = open[0];
  const humanBlockers = Number(blockers[0]?.c ?? 0);

  if (!current) {
    return {
      mode: humanBlockers > 0 ? 'BLOCKED_ON_HUMAN' : 'IDLE_NO_ELIGIBLE_WORK',
      currentGoal: null,
      queueDepth: 0, humanBlockers,
      openPlans: Number(plans[0]?.c ?? 0), replans: Number(replans[0]?.c ?? 0),
      nextAction: humanBlockers > 0
        ? 'WAIT — pending human decisions block progress'
        : 'NO_ACTION_REQUIRED — queue empty, observation continues',
      reason: humanBlockers > 0
        ? `${humanBlockers} pending human decision(s)`
        : 'No eligible goals; healthy idle is the correct state',
      resources,
    };
  }

  const cap = (current.context as Record<string, unknown> | null)?.capabilityId as string ?? null;
  return {
    mode: 'EXECUTING',
    currentGoal: { id: String(current.id).slice(0, 8), title: String(current.title), capability: cap, priority: Number(current.priority) },
    queueDepth: open.length, humanBlockers,
    openPlans: Number(plans[0]?.c ?? 0), replans: Number(replans[0]?.c ?? 0),
    nextAction: cap ? `execute ${cap}` : 'advance goal',
    reason: `highest-priority eligible goal (p${current.priority}) selected over ${open.length - 1} alternatives`,
    resources,
  };
}

/** Action journal — reconstruct "why did Heidi do that" for any goal. */
export async function actionJournal(pool: Pool, goalId: string): Promise<Array<Record<string, unknown>>> {
  const { rows } = await pool.query(
    `SELECT g.id, g.title, g.status, g.result, g.created_at, g.updated_at,
            g.context->>'capabilityId' AS cap, g.context->>'producedBy' AS src,
            g.context->>'replanOf' AS replan_of, g.context->>'replanReason' AS replan_reason
       FROM heidi_goals g
       WHERE g.id=$1 OR g.parent_id=$1 OR g.context->>'replanOf'=$1
       ORDER BY g.created_at`,
    [goalId],
  );
  return rows.map(r => ({
    goalId: String(r.id).slice(0, 8),
    title: r.title, capability: r.cap, status: r.status,
    producedBy: r.src, replanOf: r.replan_of, replanReason: r.replan_reason,
    result: r.result, at: r.created_at,
  }));
}
