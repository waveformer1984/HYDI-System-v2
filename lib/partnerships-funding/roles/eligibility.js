'use strict';

const { ELIGIBILITY_RESULT, PIPELINE_STATES } = require('../constants');
const { profileFact, isUnknown } = require('../org-profile');

/**
 * Compare published requirements against owner-approved profile facts only.
 */
function analyzeEligibility(opportunity, profile) {
  const missing = [];
  const matched = [];
  const failed = [];
  const reqs = opportunity.eligibility_requirements || [];

  for (const req of reqs) {
    const fact = profileFact(profile, req.profile_field || '');
    if (fact.unknown) {
      missing.push({ requirement: req.label || req.id, profile_field: req.profile_field, reason: 'owner_fact_unknown' });
      continue;
    }
    let pass = false;
    if (req.expect === 'truthy') pass = fact.value === true;
    else if (req.expect === 'not_unknown_string') pass = !isUnknown(fact.value);
  else if (req.expect === 'non_empty') pass = typeof fact.value === 'string' && fact.value.trim().length > 0 && !isUnknown(fact.value);
  else pass = Boolean(fact.value);
    if (pass) matched.push(req.label || req.id);
    else failed.push({ requirement: req.label || req.id, observed: fact.value, reason: req.fail_reason || 'does_not_match' });
  }

  let result = ELIGIBILITY_RESULT.UNKNOWN;
  if (failed.length) result = ELIGIBILITY_RESULT.INELIGIBLE;
  else if (missing.length) result = ELIGIBILITY_RESULT.UNKNOWN;
  else if (matched.length === reqs.length && reqs.length) result = ELIGIBILITY_RESULT.ELIGIBLE;

  const nextState =
    result === ELIGIBILITY_RESULT.UNKNOWN
      ? PIPELINE_STATES.NEEDS_OWNER_INFORMATION
      : result === ELIGIBILITY_RESULT.ELIGIBLE
        ? PIPELINE_STATES.QUALIFIED
        : PIPELINE_STATES.CLOSED;

  return {
    ok: true,
    eligibility_result: result,
    matched,
    failed,
    missing_facts: missing,
    recommended_pipeline_state: nextState,
    notes: isUnknown(profile?.legal?.entity_name) ? 'Legal entity not confirmed — do not submit externally' : null,
  };
}

module.exports = { analyzeEligibility };