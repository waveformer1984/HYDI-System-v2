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
  // is a defect candidate, not a retry problem.
  try {
    const fails = await pool.query(
      `SELECT detail->>'capabilityId' AS cap, COUNT(*)::int AS c
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
        initialObservation: `${r.c} failures of ${r.cap} in the last 24h`,
        suspectedFiles: ['lib/heidi/CognitiveCore.ts'],
        severity: r.c >= 8 ? 'high' : 'medium',
      });
    }
  } catch { /* table shape may differ — skip rather than fabricate */ }

  // Unresolved paid delivery escalations — real money waiting on a human.
  try {
    const esc = await pool.query(
      `SELECT COUNT(*)::int c FROM customer_jobs
       WHERE intervention_status = 'requested' AND payment_status = 'paid'`);
    const c = esc.rows[0]?.c ?? 0;
    if (c > 0) {
      findings.push({
        findingType: 'unresolved_delivery_escalation',
        target: 'customer_jobs',
        question: `${c} paid jobs escalated to human — do the failures share a fixable cause?`,
        initialObservation: `${c} paid jobs with intervention_status='requested'`,
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
