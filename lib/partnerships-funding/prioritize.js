'use strict';

const { ELIGIBILITY_RESULT, BENEFIT_CATEGORIES, APPLICATION_STATUS } = require('./constants');

/**
 * Rank opportunities by fit with owner goals — deterministic, no LLM spend.
 */
function scoreOpportunity(opp, profile = null) {
  const reasons = [];
  let score = 0;

  const goals = profile?.goals?.requested_support || [];

  if (opp.eligibility_result === ELIGIBILITY_RESULT.ELIGIBLE) {
    score += 40;
    reasons.push('eligible_per_profile');
  } else if (opp.eligibility_result === ELIGIBILITY_RESULT.UNKNOWN) {
    score += 12;
    reasons.push('eligibility_unknown_may_improve_with_owner_facts');
  } else if (opp.eligibility_result === ELIGIBILITY_RESULT.INELIGIBLE) {
    score -= 30;
    reasons.push('ineligible_with_current_profile');
  }

  if (opp.benefit_category === BENEFIT_CATEGORIES.CREDITS && goals.includes('api_credits')) {
    score += 28;
    reasons.push('matches_api_credits_goal');
  }
  if (opp.benefit_category === BENEFIT_CATEGORIES.PLATFORM_CREDITS && goals.includes('infrastructure')) {
    score += 24;
    reasons.push('matches_infrastructure_goal');
  }
  if (opp.benefit_category === BENEFIT_CATEGORIES.TECHNICAL_SUPPORT) {
    score += 10;
    reasons.push('technical_support_value');
  }

  if (opp.application_status === APPLICATION_STATUS.ROLLING || opp.application_status === APPLICATION_STATUS.OPEN) {
    score += 8;
    reasons.push('application_window_open_or_rolling');
  }

  if (!opp.is_guaranteed_amount && opp.benefit_amount_published) {
    reasons.push('benefit_is_up_to_not_guaranteed');
  }

  if (opp.pipeline_state === 'awaiting_approval') score += 5;

  const zeroCostFriendly =
    opp.benefit_category === BENEFIT_CATEGORIES.TECHNICAL_SUPPORT ||
    (opp.benefit_summary && /build hours|community|education/i.test(opp.benefit_summary));
  if (zeroCostFriendly) {
    score += 20;
    reasons.push('zero_cost_learning_or_community');
  }

  return {
    priority_score: score,
    priority_reasons: reasons,
    classification: 'VERIFIED_SIMULATED',
  };
}

function rankOpportunities(opportunities, profile = null) {
  return opportunities
    .map((o) => {
      const rank = scoreOpportunity(o, profile);
      return { ...o, ...rank };
    })
    .sort((a, b) => b.priority_score - a.priority_score);
}

module.exports = { scoreOpportunity, rankOpportunities };