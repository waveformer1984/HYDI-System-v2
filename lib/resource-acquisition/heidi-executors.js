'use strict';

const { createResourceActionRunner } = require('./actions');
const { loadApprovedOrgProfileFromEnv } = require('../partnerships-funding/profile-loader');
const { validatePrivateProfilePath } = require('../partnerships-funding/profile-validator');
const { runVerificationPass } = require('./verify/run-pass');

let _runner;

function getRunner() {
  if (!_runner) {
    _runner = createResourceActionRunner({
      allowTestHarness: process.env.NODE_ENV === 'test' || process.env.HYDI_RESOURCE_TEST_HARNESS === '1',
    });
  }
  return _runner;
}

function capabilityResult(capabilityId, runnerResult) {
  const output = runnerResult.output;
  const success = runnerResult.ok !== false && output?.ok !== false && output?.error == null;
  return {
    capabilityId,
    executed: true,
    outcome: success ? 'success' : 'failure',
    result: output,
    error: success ? null : output?.error || runnerResult.error || 'resource_action_failed',
    evidence: [{ capabilityId, classification: output?.classification || runnerResult.classification || null }],
    verified: false,
    verificationDetails: 'Resource actions require operator-verified opportunities for external steps',
  };
}

/**
 * Invoked from CognitiveCore CapabilityRegistry executors.
 */
async function invokeResourceCapability(capabilityId, params = {}, operatorContext = null) {
  const runner = getRunner();

  if (capabilityId === 'resource.validate_profile') {
    const file = params.path || process.env.HYDI_ORG_PROFILE_PATH;
    const v = validatePrivateProfilePath(file);
    if (!v.ok) return capabilityResult(capabilityId, { ok: false, output: v });
    runner.engine.setOrgProfile(v.profile);
    return capabilityResult(capabilityId, { ok: true, output: { ok: true, log_safe: v.log_safe } });
  }

  if (capabilityId === 'resource.validate' && params?.automatedPass) {
    const summary = await runVerificationPass(runner.engine.coordinator, { limit: params.limit || 48 });
    return capabilityResult(capabilityId, { ok: true, output: summary });
  }

  const loaded = loadApprovedOrgProfileFromEnv();
  if (loaded.ok && params?.useApprovedProfile !== false) {
    runner.engine.setOrgProfile(loaded.profile);
  }

  const action = capabilityId;
  const out = await runner.run(action, params || {}, operatorContext || params?.operatorContext || null);
  return capabilityResult(capabilityId, out);
}

module.exports = { invokeResourceCapability, getRunner, capabilityResult };