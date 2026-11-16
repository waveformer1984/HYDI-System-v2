'use strict';

const PROOF_LABELS = Object.freeze({
  CLOUD_VERIFIED: 'CLOUD_VERIFIED',
  GITHUB_VERIFIED: 'GITHUB_VERIFIED',
  FRANK_VERIFIED: 'FRANK_VERIFIED',
  LOCAL_VERIFIED: 'LOCAL_VERIFIED',
  SIMULATED: 'SIMULATED',
  NOT_VERIFIED: 'NOT_VERIFIED',
});

const OUTCOME_CLASS = Object.freeze({
  IMPROVED: 'IMPROVED',
  UNCHANGED: 'UNCHANGED',
  REGRESSED: 'REGRESSED',
  INCONCLUSIVE: 'INCONCLUSIVE',
  UNVERIFIED: 'UNVERIFIED',
});

const LIFECYCLE = Object.freeze([
  'PROPOSED',
  'APPROVED',
  'EXECUTING',
  'TESTED',
  'VERIFIED',
  'MERGED',
  'DEPLOYED',
]);

/**
 * @param {object} ctx
 */
function resolveProofLabel(ctx = {}) {
  if (ctx.frank && ctx.verified) return PROOF_LABELS.FRANK_VERIFIED;
  if (ctx.githubCi && ctx.verified) return PROOF_LABELS.GITHUB_VERIFIED;
  if (ctx.simulated) return PROOF_LABELS.SIMULATED;
  if (ctx.cloud && ctx.verified) return PROOF_LABELS.CLOUD_VERIFIED;
  if (ctx.local && ctx.verified) return PROOF_LABELS.LOCAL_VERIFIED;
  return PROOF_LABELS.NOT_VERIFIED;
}

/**
 * Derive lifecycle stage from evidence — never skip states.
 */
function deriveLifecycleStage(record) {
  if (record.deployed_at) return 'DEPLOYED';
  if (record.merged_at || record.related_prs?.length) return 'MERGED';
  if (record.verification?.completed) return 'VERIFIED';
  if (record.tests?.passed) return 'TESTED';
  if (record.state === 'running' || record.progress?.length) return 'EXECUTING';
  if (record.approval_status === 'approved') return 'APPROVED';
  return 'PROPOSED';
}

module.exports = {
  PROOF_LABELS,
  OUTCOME_CLASS,
  LIFECYCLE,
  resolveProofLabel,
  deriveLifecycleStage,
};