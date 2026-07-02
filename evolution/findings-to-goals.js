'use strict';
/**
 * Findings -> Goal Proposals — the "recommend" stage of the self-improvement loop.
 *
 * Converts self-assessment findings (from evolution/self-assessment.js) into concrete
 * improvement proposals. By default it ONLY proposes (human-in-the-loop); it creates
 * goals in HeidiGoalEngine only when the operator explicitly approves via { approve: true }.
 *
 * Usage:
 *   const { assessFromSupabase } = require('./evolution/self-assessment');
 *   const { proposeGoals } = require('./evolution/findings-to-goals');
 *   const report = await assessFromSupabase(supabase, { windowHours: 24 });
 *   const { proposals } = await proposeGoals(goalEngine, report);     // preview only
 *   // ...operator reviews proposals...
 *   const { created } = await proposeGoals(goalEngine, report, { approve: true }); // commit
 */

const SEVERITY_TO_PRIORITY = { high: 'high', moderate: 'normal' }; // info/ok/idle => not actionable

function objectiveFor(f, assessment) {
  switch (f.code) {
    case 'error_rate':
      return `Investigate and reduce overall pipeline error rate (currently ${(assessment.error_rate * 100).toFixed(1)}% over ${assessment.total_events} events).`;
    case 'division_errors':
      return `Reduce error rate in the "${f.division}" division.`;
    case 'latency':
      return `Investigate high p95 latency in the "${f.division}" division.`;
    case 'block_rate':
      return 'Review ProtoForge policy: BLOCK verdicts are unusually high.';
    default:
      return f.message || `Address: ${f.code}`;
  }
}

/**
 * Pure: map an assessment's findings to actionable goal proposals. No side effects.
 * Returns [{ objective, priority, severity, source:{ code, division } }].
 */
function findingsToProposals(assessment) {
  const findings = (assessment && assessment.findings) || [];
  const proposals = [];
  for (const f of findings) {
    const priority = SEVERITY_TO_PRIORITY[f.severity];
    if (!priority) continue; // info / ok / idle are not actionable
    proposals.push({
      objective: objectiveFor(f, assessment),
      priority,
      severity: f.severity,
      source: { code: f.code, division: f.division || null },
    });
  }
  return proposals;
}

const keyOf = (s) => `${s.code}:${s.division || ''}`;

/**
 * Integration: propose goals from an assessment. Human-in-the-loop by default —
 * returns proposals WITHOUT creating goals unless { approve: true }. When approving,
 * dedups against existing active goals tagged with the same source.
 * @returns {Promise<{applied:boolean, created:Array, proposals:Array}>}
 */
async function proposeGoals(goalEngine, assessment, opts = {}) {
  const proposals = findingsToProposals(assessment);
  if (!opts.approve) return { applied: false, created: [], proposals };

  const existing = new Set(
    (goalEngine.allGoals ? goalEngine.allGoals() : [])
      .filter((g) => g.status === 'active' && g._source)
      .map((g) => keyOf(g._source))
  );
  const created = [];
  for (const p of proposals) {
    if (existing.has(keyOf(p.source))) continue;
    const goal = await goalEngine.addGoal(p.objective, p.priority);
    goal._source = p.source; // tag so future runs dedup instead of duplicating
    created.push(goal);
    existing.add(keyOf(p.source));
  }
  return { applied: true, created, proposals };
}

module.exports = { findingsToProposals, proposeGoals };
