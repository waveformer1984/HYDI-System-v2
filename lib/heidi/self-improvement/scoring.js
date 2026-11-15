'use strict';

const { analyzeDuplicates } = require('./duplicates');

/**
 * Documented weights — deterministic, no LLM.
 */
const WEIGHTS = Object.freeze({
  operational_impact: 0.22,
  user_impact: 0.15,
  severity: 0.18,
  recurrence_penalty: 0.12,
  confidence: 0.12,
  complexity_penalty: 0.08,
  regression_risk_penalty: 0.08,
  historical_success_bonus: 0.05,
});

function scoreGap(gap, context = {}) {
  const dup = context.duplicate_analysis;
  const priorFails = dup?.failed_attempts || 0;
  const historicalSuccess = context.history_success_rate?.[gap.id] ?? 0.5;

  const operational = Math.min(100, gap.urgency || 50);
  const user = gap.owner_outcome_axis === 'accuracy' ? 85 : 60;
  const severity = gap.urgency || 50;
  const confidence = (gap.confidence || 0.5) * 100;
  const complexity = gap.effort || 50;
  const regressionRisk = gap.risk || 30;
  const recurrence = Math.min(100, priorFails * 25);

  let priority =
    operational * WEIGHTS.operational_impact +
    user * WEIGHTS.user_impact +
    severity * WEIGHTS.severity +
    confidence * WEIGHTS.confidence +
    historicalSuccess * 100 * WEIGHTS.historical_success_bonus -
    recurrence * WEIGHTS.recurrence_penalty -
    complexity * WEIGHTS.complexity_penalty -
    regressionRisk * WEIGHTS.regression_risk_penalty;

  if (dup?.recommendation === 'skip_duplicate') priority -= 50;
  if (dup?.recommendation === 'defer_human') priority -= 20;

  priority = Math.round(priority * 10) / 10;

  return {
    priority_score: priority,
    weights: WEIGHTS,
    inputs: {
      operational_impact: operational,
      user_impact: user,
      severity,
      recurrence,
      confidence,
      complexity,
      regression_risk: regressionRisk,
      historical_success_rate: historicalSuccess,
    },
    expected_benefit: gap.proposed_outcome,
    risks: [gap.risk ? `implementation_risk_${gap.risk}` : null, dup?.recommendation].filter(Boolean),
    confidence_level: gap.confidence ?? 0.5,
    recommended_next_action:
      dup?.recommendation === 'skip_duplicate'
        ? 'skip — already improved'
        : dup?.recommendation === 'defer_human'
          ? 'ask_owner — repeated failures'
          : gap.execution_mode === 'operator_frank_only'
            ? 'operator_frank'
            : 'run_bounded_mission',
    evidence: gap.evidence,
  };
}

function rankWithHistory(gaps, history) {
  const failsByGap = {};
  const successByGap = {};
  for (const h of history) {
    const id = h.gap_id;
    if (!id) continue;
    failsByGap[id] = failsByGap[id] || 0;
    successByGap[id] = successByGap[id] || 0;
    if (h.outcome_class === 'IMPROVED') successByGap[id]++;
    else if (['REGRESSED', 'INCONCLUSIVE', 'UNVERIFIED'].includes(h.outcome_class)) failsByGap[id]++;
  }
  const history_success_rate = {};
  for (const id of new Set([...Object.keys(failsByGap), ...Object.keys(successByGap)])) {
    const s = successByGap[id] || 0;
    const f = failsByGap[id] || 0;
    history_success_rate[id] = s + f ? s / (s + f) : 0.5;
  }

  return gaps
    .map((g) => {
      const dup = analyzeDuplicates(g, history);
      const scored = scoreGap(g, { duplicate_analysis: dup, history_success_rate });
      return { ...g, rank_score: scored.priority_score, scoring: scored, duplicate_analysis: dup };
    })
    .sort((a, b) => b.rank_score - a.rank_score);
}

module.exports = { WEIGHTS, scoreGap, rankWithHistory };