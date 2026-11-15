'use strict';

const SOURCE_VERIFICATION_STATUS = Object.freeze({
  EXAMPLE_UNVERIFIED: 'example_unverified',
  OPERATOR_VERIFIED: 'operator_verified',
  STALE: 'stale',
});

const INTAKE_KIND = Object.freeze({
  EXAMPLE_FIXTURE: 'example_fixture',
  OPERATOR_CURATED: 'operator_curated',
  OPERATOR_DOCUMENT: 'operator_document',
});

function isOperatorVerifiedSource(opp) {
  return opp?.source_verification_status === SOURCE_VERIFICATION_STATUS.OPERATOR_VERIFIED;
}

/**
 * Application-ready = owner-approved profile + operator-verified source + eligible/unknown with draft state.
 * High priority alone must never imply ready to apply.
 */
function computeApplicationReady(opp, profile) {
  if (!profile?.approved_by_owner) return false;
  if (!isOperatorVerifiedSource(opp)) return false;
  if (!opp.published_benefits_verified) return false;
  if (opp.eligibility_result === 'ineligible') return false;
  return opp.pipeline_state === 'awaiting_approval';
}

function publicSourceFields(opp) {
  return {
    intake_kind: opp.intake_kind || INTAKE_KIND.OPERATOR_CURATED,
    source_verification_status: opp.source_verification_status || SOURCE_VERIFICATION_STATUS.EXAMPLE_UNVERIFIED,
    source_claimed_verified_at: opp.source_verified_at || null,
    source_operator_verified_at: opp.source_operator_verified_at || null,
    published_benefits_verified: Boolean(opp.published_benefits_verified),
    benefits_verified: Boolean(opp.published_benefits_verified),
    application_open_verified: opp.application_open_verified ?? null,
    application_ready: computeApplicationReady(opp, null),
  };
}

module.exports = {
  SOURCE_VERIFICATION_STATUS,
  INTAKE_KIND,
  isOperatorVerifiedSource,
  computeApplicationReady,
  publicSourceFields,
};