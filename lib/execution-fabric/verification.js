'use strict';

/** @typedef {'VERIFIED'|'FAILED'|'INCONCLUSIVE'|'NOT_REQUIRED'} VerificationStatus */

/**
 * @param {object} opts
 * @param {boolean} opts.mandatory
 * @param {boolean} [opts.dispatched]
 * @param {boolean} [opts.runnerOk]
 * @param {object} [opts.evidence]
 */
function buildVerification({ mandatory, dispatched = true, runnerOk, evidence = {} }) {
  if (!mandatory) {
    return { status: 'NOT_REQUIRED', verified: true, evidence: { note: 'verification_not_required' } };
  }
  if (!dispatched) {
    return { status: 'INCONCLUSIVE', verified: false, evidence: { ...evidence, reason: 'not_dispatched' } };
  }
  if (runnerOk === true) {
    return { status: 'VERIFIED', verified: true, evidence };
  }
  if (runnerOk === false) {
    return { status: 'FAILED', verified: false, evidence };
  }
  return { status: 'INCONCLUSIVE', verified: false, evidence: { ...evidence, reason: 'missing_runner_outcome' } };
}

function verifySyncCapability(outcome) {
  return buildVerification({
    mandatory: true,
    dispatched: true,
    runnerOk: outcome && outcome.ok === true,
    evidence: {
      outcome_ok: outcome?.ok ?? null,
      error: outcome?.error ?? null,
      correlation_id: outcome?.correlation_id ?? null,
      ts: new Date().toISOString(),
    },
  });
}

function verifyJobCapability(job) {
  if (!job) {
    return buildVerification({ mandatory: true, dispatched: false, evidence: { ts: new Date().toISOString() } });
  }
  const ok = job.state === 'succeeded';
  return buildVerification({
    mandatory: true,
    dispatched: true,
    runnerOk: ok,
    evidence: {
      job_state: job.state,
      exit_code: job.exit_code ?? null,
      error: job.error ?? null,
      ts: new Date().toISOString(),
    },
  });
}

module.exports = { buildVerification, verifySyncCapability, verifyJobCapability };
