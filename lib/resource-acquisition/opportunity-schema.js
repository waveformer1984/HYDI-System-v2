'use strict';

/**
 * Unified opportunity registry fields (extends partnerships-funding records).
 * Values unknown until operator-verified — never fabricate dollar amounts.
 */

const OPPORTUNITY_CATEGORY = Object.freeze({
  AI_COMPUTE: 'ai_compute',
  BUSINESS_FUNDING: 'business_funding',
  INFRASTRUCTURE: 'infrastructure',
  COMMERCIAL: 'commercial',
});

const RECURRENCE = Object.freeze({
  ONE_TIME: 'one_time',
  RECURRING: 'recurring',
  UNKNOWN: 'unknown',
});

const REGISTRY_LIFECYCLE = Object.freeze({
  DISCOVERED: 'discovered',
  VALIDATING: 'validating',
  QUALIFIED: 'qualified',
  PRIORITIZED: 'prioritized',
  PREPARING: 'preparing',
  AWAITING_APPROVAL: 'awaiting_approval',
  SUBMITTED: 'submitted',
  UNDER_REVIEW: 'under_review',
  AWARDED: 'awarded',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
  INELIGIBLE: 'ineligible',
  NEEDS_INFORMATION: 'needs_information',
  WITHDRAWN: 'withdrawn',
  DUPLICATE: 'duplicate',
});

/** Map legacy pipeline_state → registry lifecycle label for dashboard */
const PIPELINE_TO_REGISTRY = Object.freeze({
  discovered: REGISTRY_LIFECYCLE.DISCOVERED,
  needs_verification: REGISTRY_LIFECYCLE.VALIDATING,
  needs_owner_information: REGISTRY_LIFECYCLE.NEEDS_INFORMATION,
  qualified: REGISTRY_LIFECYCLE.QUALIFIED,
  drafting: REGISTRY_LIFECYCLE.PREPARING,
  awaiting_approval: REGISTRY_LIFECYCLE.AWAITING_APPROVAL,
  submitted: REGISTRY_LIFECYCLE.SUBMITTED,
  follow_up: REGISTRY_LIFECYCLE.UNDER_REVIEW,
  awarded: REGISTRY_LIFECYCLE.AWARDED,
  declined: REGISTRY_LIFECYCLE.REJECTED,
  closed: REGISTRY_LIFECYCLE.WITHDRAWN,
});

function enrichOpportunityRecord(opp) {
  return {
    ...opp,
    registry_lifecycle: PIPELINE_TO_REGISTRY[opp.pipeline_state] || REGISTRY_LIFECYCLE.DISCOVERED,
    opportunity_category: opp.opportunity_category || opp.benefit_category,
    confidence_score: opp.confidence_score ?? (opp.source_verification_status === 'operator_verified' ? 0.7 : 0.2),
    value_estimates: {
      financial_usd: opp.estimated_financial_value ?? null,
      compute: opp.estimated_compute_value ?? null,
      operational: opp.estimated_operational_value ?? null,
      verified: Boolean(opp.benefits_verified),
    },
    discovery_timestamp: opp.created_at,
    last_verification_timestamp: opp.source_operator_verified_at || opp.source_verified_at || null,
  };
}

function validateOpportunityIntake(input) {
  const errors = [];
  if (!input?.official_source_url) errors.push('official_source_url');
  if (!input?.provider) errors.push('provider');
  if (!input?.program_name) errors.push('program_name');
  if (!input?.opportunity_category && !input?.benefit_category) errors.push('opportunity_category');
  return { ok: errors.length === 0, errors };
}

module.exports = {
  OPPORTUNITY_CATEGORY,
  RECURRENCE,
  REGISTRY_LIFECYCLE,
  PIPELINE_TO_REGISTRY,
  enrichOpportunityRecord,
  validateOpportunityIntake,
};