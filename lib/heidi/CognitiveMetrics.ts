/**
 * CognitiveMetrics — the AGI-evolution telemetry fold. Every number is
 * computed from durable rows; no targets are invented — this establishes
 * a baseline, not a scorecard.
 */
import { Pool } from 'pg';

export interface CognitiveTelemetry {
  cycles: number;
  verifiedRate: number | null;          // verified executions / executed
  falseSuccessRate: number | null;      // outcome=success but verified=false
  refusalRate: number | null;           // refused / total capability executions
  goalCompletionRate: number | null;    // completed / terminal goals
  humanEscalationRate: number | null;   // open human requests / resolved+open
  replans: number;
  lessonsStored: number;
  unknownFindings: number;              // INSUFFICIENT verdicts — honesty baseline
  plansCreated: number;
  goalModels: number;
  avgStepsPerPlan: number | null;
}

export async function cognitiveTelemetry(pool: Pool): Promise<CognitiveTelemetry> {
  const q = async (sql: string, params?: unknown[]) =>
    (await pool.query(sql, params).catch(() => ({ rows: [] }))).rows as Array<Record<string, unknown>>;

  const cycles = (await q(`SELECT payload FROM heidi_events WHERE event_type='cognitive_cycle' ORDER BY created_at DESC LIMIT 200`))
    .map(r => r.payload as Record<string, unknown>);
  const executed = cycles.filter(c => c.executed === true);
  const verified = executed.filter(c => c.verified === true).length;
  const falseSuccess = executed.filter(c => c.outcome === 'success' && c.verified === false).length;
  const refused = cycles.filter(c => c.outcome === 'refused').length;

  const goals = await q(`SELECT status, count(*)::int c FROM heidi_goals WHERE status IN ('completed','failed','blocked','cancelled') GROUP BY 1`);
  const completed = Number(goals.find(g => g.status === 'completed')?.c ?? 0);
  const terminal = goals.reduce((s, g) => s + Number(g.c), 0);

  const human = await q(`SELECT status, count(*)::int c FROM human_intervention_requests GROUP BY 1`);
  const pendingHuman = human.filter(h => h.status === 'pending').reduce((s, h) => s + Number(h.c), 0);
  const totalHuman = human.reduce((s, h) => s + Number(h.c), 0);

  const replans = (await q(`SELECT count(*)::int c FROM heidi_events WHERE event_type='replan' OR payload->>'replanned'='true'`))[0]?.c ?? 0;
  const lessons = (await q(`SELECT count(*)::int c FROM heidi_events WHERE event_type IN ('lesson','experience','memory_write')`))[0]?.c ?? 0;
  const unknowns = (await q(`SELECT count(*)::int c FROM heidi_events WHERE event_type='business_finding' AND payload->>'verdict'='INSUFFICIENT'`))[0]?.c ?? 0;
  const plans = (await q(`SELECT payload FROM heidi_events WHERE event_type='plan'`)).map(r => r.payload as { steps?: unknown[] });
  const goalModels = (await q(`SELECT count(*)::int c FROM heidi_events WHERE event_type='goal_model'`))[0]?.c ?? 0;

  return {
    cycles: cycles.length,
    verifiedRate: executed.length ? verified / executed.length : null,
    falseSuccessRate: executed.length ? falseSuccess / executed.length : null,
    refusalRate: cycles.length ? refused / cycles.length : null,
    goalCompletionRate: terminal ? completed / terminal : null,
    humanEscalationRate: totalHuman ? pendingHuman / totalHuman : null,
    replans: Number(replans), lessonsStored: Number(lessons),
    unknownFindings: Number(unknowns),
    plansCreated: plans.length,
    goalModels: Number(goalModels),
    avgStepsPerPlan: plans.length ? plans.reduce((s, p) => s + (p.steps?.length ?? 0), 0) / plans.length : null,
  };
}
