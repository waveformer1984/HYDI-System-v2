'use strict';

const { APPLICATION_STATUS, BENEFIT_CATEGORIES, PIPELINE_STATES } = require('../constants');
const { SOURCE_VERIFICATION_STATUS, INTAKE_KIND } = require('../source-verification');
const { dedupKey } = require('../store');

/**
 * Register opportunity from owner- or fixture-supplied official source record.
 * Does not crawl the web — caller must pass verified fields.
 */
function intakeOfficialSource(input) {
  if (!input?.official_source_url) {
    return { ok: false, error: 'missing_official_source_url' };
  }
  const required = ['provider', 'program_name', 'benefit_category', 'official_source_url'];
  for (const r of required) {
    if (!input[r]) return { ok: false, error: `missing_${r}` };
  }
  const record = {
    provider: input.provider,
    program_name: input.program_name,
    benefit_category: input.benefit_category,
    benefit_summary: input.benefit_summary || null,
    benefit_amount_published: input.benefit_amount_published || null,
    benefit_restrictions: input.benefit_restrictions || null,
    is_guaranteed_amount: Boolean(input.is_guaranteed_amount),
    application_status: input.application_status || APPLICATION_STATUS.UNKNOWN,
    deadline: input.deadline || null,
    deadline_timezone: input.deadline_timezone || null,
    official_source_url: input.official_source_url,
    source_verified_at: input.source_verified_at,
    source_excerpt: input.source_excerpt || null,
    eligibility_requirements: Array.isArray(input.eligibility_requirements) ? input.eligibility_requirements : [],
    is_commercial_partnership: Boolean(input.is_commercial_partnership),
    dedup_key: dedupKey(input.provider, input.program_name),
    pipeline_state: PIPELINE_STATES.NEEDS_VERIFICATION,
    intake_kind: input.intake_kind || INTAKE_KIND.OPERATOR_CURATED,
    source_verification_status:
      input.source_verification_status ||
      (input.intake_kind === INTAKE_KIND.EXAMPLE_FIXTURE
        ? SOURCE_VERIFICATION_STATUS.EXAMPLE_UNVERIFIED
        : SOURCE_VERIFICATION_STATUS.EXAMPLE_UNVERIFIED),
    research_classification: input.research_classification || 'UNVERIFIED_LEAD',
    benefits_verified: false,
  };
  if (record.benefit_category === BENEFIT_CATEGORIES.COMMERCIAL_PARTNERSHIP && !record.is_commercial_partnership) {
    record.is_commercial_partnership = false;
  }
  return { ok: true, record };
}

module.exports = { intakeOfficialSource };