'use strict';

const { APPLICATION_STATUS, BENEFIT_CATEGORIES, PIPELINE_STATES } = require('../constants');
const { dedupKey } = require('../store');

/**
 * Register opportunity from owner- or fixture-supplied official source record.
 * Does not crawl the web — caller must pass verified fields.
 */
function intakeOfficialSource(input) {
  if (!input?.official_source_url) {
    return { ok: false, error: 'missing_official_source_url' };
  }
  const required = ['provider', 'program_name', 'benefit_category', 'source_verified_at'];
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
    pipeline_state: input.source_verified_at ? PIPELINE_STATES.NEEDS_VERIFICATION : PIPELINE_STATES.DISCOVERED,
    research_classification: input.research_classification || 'VERIFIED_SIMULATED',
  };
  if (record.benefit_category === BENEFIT_CATEGORIES.COMMERCIAL_PARTNERSHIP && !record.is_commercial_partnership) {
    record.is_commercial_partnership = false;
  }
  return { ok: true, record };
}

module.exports = { intakeOfficialSource };