'use strict';

const { matchCapabilities } = require('./capabilities');
const { estimateEconomics } = require('./economics');

function skillMatchScore(lead, capabilityHits) {
  if (!capabilityHits.length) return { matchScore: 0, feasibility: 0, primary: null, matched: [] };
  const best = capabilityHits[0];
  const matchScore = Math.min(100, 20 + best.matched.length * 15);
  const feasibility = best.executionReady ? Math.min(1, 0.4 + best.matched.length * 0.12) : 0.25;
  return {
    matchScore,
    feasibility,
    primary: best,
    matched: capabilityHits,
  };
}

/**
 * Full opportunity assessment for a normalized lead.
 */
function assessOpportunity(lead, config = {}) {
  const capabilityHits = matchCapabilities(lead);
  const { matchScore, feasibility, primary, matched } = skillMatchScore(lead, capabilityHits);
  const economics = estimateEconomics(lead, config, { matchScore, feasibility });
  const leadScore = Number(lead.score) || 0;
  const combined = Math.round((leadScore * 0.4) + (economics.opportunityScore * 0.6));

  let rejectReason = null;
  if (leadScore === 0) rejectReason = 'excluded_by_scout';
  else if (matchScore < 20) rejectReason = 'no_verified_capability_match';
  else if (!economics.economicallyViable) rejectReason = 'below_min_net_profit';
  else if (economics.riskScore > (Number(config.maxRiskScore) || 75)) rejectReason = 'risk_too_high';

  return {
    matchScore,
    skillMatch: matched,
    recommendedService: primary ? primary.category : null,
    feasibility,
    economics,
    opportunityScore: combined,
    rejectReason,
    qualified: !rejectReason && combined >= (Number(config.minOpportunityScore) || 40),
  };
}

module.exports = { assessOpportunity, skillMatchScore };