'use strict';

const { rankOpportunities } = require('../partnerships-funding/prioritize');
const { OPPORTUNITY_CATEGORY } = require('./opportunity-schema');

const RANKING_BUCKETS = Object.freeze({
  IMMEDIATE_FREE: 'immediate_free',
  COMPUTE_INFRA: 'compute_infrastructure',
  AI_RESEARCH: 'ai_research_developer',
  GRANTS_FUNDING: 'grants_funding',
  COMMERCIAL: 'commercial_revenue',
  PARTNERSHIP: 'strategic_partnership',
});

function bucketForOpportunity(opp) {
  const cat = opp.opportunity_category || opp.benefit_category;
  if (cat === OPPORTUNITY_CATEGORY.AI_COMPUTE || cat === 'credits') return RANKING_BUCKETS.AI_RESEARCH;
  if (cat === OPPORTUNITY_CATEGORY.INFRASTRUCTURE || cat === 'platform_credits') return RANKING_BUCKETS.COMPUTE_INFRA;
  if (cat === OPPORTUNITY_CATEGORY.BUSINESS_FUNDING || cat === 'cash_grant') return RANKING_BUCKETS.GRANTS_FUNDING;
  if (cat === OPPORTUNITY_CATEGORY.COMMERCIAL || cat === 'commercial_partnership') return RANKING_BUCKETS.COMMERCIAL;
  if (opp.benefit_category === 'technical_support') return RANKING_BUCKETS.IMMEDIATE_FREE;
  return RANKING_BUCKETS.PARTNERSHIP;
}

function urgencyScore(opp, now = Date.now()) {
  if (!opp.deadline) return 0;
  const t = Date.parse(opp.deadline);
  if (!Number.isFinite(t)) return 0;
  const days = (t - now) / 86400000;
  if (days < 0) return -40;
  if (days < 7) return 30;
  if (days < 30) return 15;
  return 5;
}

function rankWithExplainedDimensions(opportunities, profile) {
  const base = rankOpportunities(opportunities, profile);
  return base.map((o) => {
    const complexity = (o.eligibility_requirements?.length || 0) * 3;
    const urgency = urgencyScore(o);
    const verification_confidence = o.published_benefits_verified ? 25 : 0;
    const success_probability = o.eligibility_result === 'eligible' ? 20 : o.eligibility_result === 'unknown' ? 8 : 0;
    const score =
      o.priority_score + urgency + verification_confidence - complexity;
    const reasons = [
      ...o.priority_reasons,
      `urgency_adjustment:${urgency}`,
      `complexity_penalty:${complexity}`,
      `verification_confidence:${verification_confidence}`,
      `eligibility_success_signal:${success_probability}`,
    ];
    if (!o.published_benefits_verified) reasons.push('success_probability_not_inferred_without_verification');
    return {
      ...o,
      intelligence_score: score,
      intelligence_reasons: reasons,
      ranking_bucket: bucketForOpportunity(o),
    };
  });
}

function multiBucketRankings(opportunities, profile) {
  const ranked = rankWithExplainedDimensions(opportunities, profile);
  const buckets = {};
  for (const b of Object.values(RANKING_BUCKETS)) buckets[b] = [];
  for (const o of ranked) {
    buckets[o.ranking_bucket].push(o);
  }
  for (const b of Object.keys(buckets)) {
    buckets[b].sort((a, c) => c.intelligence_score - a.intelligence_score);
  }
  return { ranked, buckets };
}

module.exports = { RANKING_BUCKETS, multiBucketRankings, rankWithExplainedDimensions, bucketForOpportunity };