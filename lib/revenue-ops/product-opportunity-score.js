'use strict';

/**
 * Mission HYDI-REVENUE-001 weighted product scoring (hypothesis vs fact flagged per row).
 */

const WEIGHTS = Object.freeze({
  timeToFirstPayment: 0.25,
  verifiedDemand: 0.25,
  profitPotential: 0.2,
  startupCost: 0.15,
  deliveryAutomation: 0.1,
  recurringRevenue: 0.05,
});

function weightedScore(criteria) {
  let total = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    const v = Number(criteria[key]);
    if (!Number.isFinite(v) || v < 0 || v > 100) return { total: null, error: `invalid_${key}` };
    total += v * weight;
  }
  return { total: Math.round(total * 10) / 10, weights: WEIGHTS };
}

function rankOpportunities(opportunities) {
  return [...opportunities]
    .map((o) => ({ ...o, score: weightedScore(o.criteria) }))
    .sort((a, b) => (b.score.total || 0) - (a.score.total || 0));
}

module.exports = { WEIGHTS, weightedScore, rankOpportunities };