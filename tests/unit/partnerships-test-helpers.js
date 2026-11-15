'use strict';

const operatorCtx = { actor: 'human:operator', method: 'jest_harness', proof: 'test_harness' };

function approvedTestProfile(overrides = {}) {
  return {
    approved_by_owner: true,
    owner_approval_record: {
      approved_by: 'human:owner',
      approved_at: '2026-11-15T00:00:00.000Z',
      method: 'offline_review',
    },
    legal: { entity_name: 'UNKNOWN', business_email: 'secret@example.com' },
    classification: { structure: 'open_source' },
    funding: { vc_backed: 'UNKNOWN', vc_partner_name: 'UNKNOWN' },
    product: { one_line_description: 'HYDI orchestration platform', api_use_case: 'UNKNOWN' },
    goals: { requested_support: ['api_credits', 'technical_support'] },
    sharing: { may_share_metrics_externally: false },
    ...overrides,
  };
}

function verifyOpportunitySource(coord, opportunityId) {
  return coord.recordOperatorSourceVerification(
    opportunityId,
    {
      source_checked_at: '2026-11-15T12:00:00.000Z',
      published_benefits_verified: true,
      official_source_url: 'https://openai.com/business/why-openai/startups/',
      benefit_terms_excerpt: 'Harness: VC referral required for API credits (not live-verified).',
      application_open_verified: null,
      note: 'test harness',
    },
    operatorCtx,
  );
}

module.exports = { operatorCtx, approvedTestProfile, verifyOpportunitySource };