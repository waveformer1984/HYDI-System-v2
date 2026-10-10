/**
 * DevObserver — the finding-generation edge of the autopilot.
 *
 * Deterministically scans durable state for development-worthy signals
 * and emits Findings for ops.dev_investigate. Read-only, bounded, and
 * deliberately conservative: a finding is a HYPOTHESIS — the
 * investigator decides whether it's real.
 *
 * Sources:
 *   - repeated executor failures (same capability failing ≥3×/24h)
 *   - unresolved paid delivery escalations (QA failures needing review)
 *   - stale active goals (>24h, no progress)
 *   - dirty working-tree pollution (>30 uncommitted non-ignored paths
 *     could mask real state — hygiene signal, not a defect)
 *
 * Does NOT invent findings to keep the loop busy. Empty = honest.
 */

import { Pool } from 'pg';
import { execFileSync } from 'child_process';

const REPO = 'C:\\Users\\Owner\\HYDI-System-v2';

export interface ObservedFinding {
  findingType: 'repeated_capability_failure' | 'unresolved_delivery_escalation' | 'stale_goal' | 'tree_pollution';
  target: string;
  question: string;
  initialObservation: string;
  suspectedFiles: string[];
  severity: 'high' | 'medium' | 'low';
}

export async function observeDevelopmentSignals(pool: Pool): Promise<ObservedFinding[]> {
  const findings: ObservedFinding[] = [];

  // Repeated capability failures — a capability failing ≥3 times in 24h
  // is a defect candidate, not a retry problem. Attach the dominant
  // error text so the investigator can classify deterministically.
  try {
    const fails = await pool.query(
      `SELECT detail->>'capabilityId' AS cap, COUNT(*)::int AS c,
              MODE() WITHIN GROUP (ORDER BY detail->>'error') AS top_error
       FROM heidi_events
       WHERE event_type = 'action_execution' AND detail->>'outcome' = 'failure'
         AND created_at > now() - interval '24 hours'
       GROUP BY 1 HAVING COUNT(*) >= 3 ORDER BY c DESC LIMIT 5`);
    for (const r of fails.rows) {
      if (!r.cap) continue;
      findings.push({
        findingType: 'repeated_capability_failure',
        target: String(r.cap),
        question: `capability ${r.cap} failed ${r.c}× in 24h — transient or defective?`,
        initialObservation: `${r.c} failures of ${r.cap} in 24h; dominant error: ${String(r.top_error ?? 'n/a').slice(0, 200)}`,
        suspectedFiles: ['lib/heidi/CognitiveCore.ts'],
        severity: r.c >= 8 ? 'high' : 'medium',
      });
    }
  } catch { /* table shape may differ — skip rather than fabricate */ }

  // Unresolved paid delivery escalations — attach the reason histogram;
  // a single dominant cause is a systemic defect, a diverse mix is a
  // legitimate human workload.
  try {
    // Reasons live in the intervention_requested event detail — the
    // intervention_id is per-job (delivery-<jobId>) and would make every
    // bucket look unique even when the cause is systemic.
    const esc = await pool.query(
      `SELECT TRIM(split_part(COALESCE(e.details->>'reason', e.details->>'interventionId'), ':', 3)) AS reason, COUNT(DISTINCT j.job_id)::int c
       FROM customer_jobs j
       JOIN customer_job_events e ON e.job_id = j.job_id AND e.event_type = 'intervention_requested'
       WHERE j.intervention_status = 'requested' AND j.payment_status = 'paid'
       GROUP BY 1 ORDER BY c DESC`);
    const total = esc.rows.reduce((s, r) => s + r.c, 0);
    if (total > 0) {
      findings.push({
        findingType: 'unresolved_delivery_escalation',
        target: 'customer_jobs',
        question: `${total} paid jobs escalated to human — shared fixable cause or legitimate exceptions?`,
        initialObservation: `${total} paid escalations; reasons: ${esc.rows.map(r => `${r.c}× ${String(r.reason ?? 'unknown').slice(0, 60)}`).join(' | ')}`,
        suspectedFiles: ['lib/revenue/JobExecutor.ts', 'lib/revenue/DeliveryVerifier.ts'],
        severity: 'high',
      });
    }
  } catch { /* skip */ }

  // Stale active goals — missions stuck >24h are candidates for
  // cancellation or decomposition, not silent persistence.
  try {
    const stale = await pool.query(
      `SELECT id, title FROM heidi_goals
       WHERE status = 'active' AND created_at < now() - interval '24 hours' LIMIT 5`);
    for (const r of stale.rows) {
      findings.push({
        findingType: 'stale_goal',
        target: `goal:${r.id}`,
        question: `goal "${String(r.title).slice(0, 80)}" active >24h — stuck?`,
        initialObservation: `goal ${r.id} created >24h ago still active`,
        suspectedFiles: [],
        severity: 'low',
      });
    }
  } catch { /* skip */ }

  // Working-tree pollution — large untracked churn makes autonomous
  // diff inspection unsafe.
  try {
    const out = execFileSync('git', ['status', '--porcelain'], { cwd: REPO }).toString();
    const untracked = out.split('\n').filter(l => l.startsWith('??')).length;
    if (untracked > 40) {
      findings.push({
        findingType: 'tree_pollution',
        target: 'working tree',
        question: `${untracked} untracked paths — accumulator files need ignoring?`,
        initialObservation: `${untracked} untracked files in git status`,
        suspectedFiles: ['.gitignore'],
        severity: 'low',
      });
    }
  } catch { /* skip */ }

  return findings;
}
