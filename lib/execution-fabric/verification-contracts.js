'use strict';

const { buildVerification, verifySyncCapability } = require('./verification');

/**
 * Independent postcondition checks — must not trust executor success alone.
 * @returns {Promise<{ check_id: string, status: 'PASS'|'FAIL'|'BLOCKED'|'NOT_RUN', expected: string, observed: string, at: string, remediation?: string }>}
 */
async function runContractChecks(capabilityId, outcome, ctx = {}) {
  const at = new Date().toISOString();
  const checks = [];

  if (capabilityId === 'health.check') {
    const probes = outcome?.result?.probes || outcome?.probes;
    const ok = Array.isArray(probes) && probes.length > 0 && probes.every((p) => p.ok);
    checks.push({
      check_id: 'health.all_probes_ok',
      status: ok ? 'PASS' : 'FAIL',
      expected: 'all configured probes return ok',
      observed: ok ? `${probes.length} probes ok` : 'one or more probes failed',
      at,
      remediation: ok ? undefined : 'Inspect probe hints in task outcome',
    });
  }

  if (capabilityId === 'billing.verify_revocation' || capabilityId === 'billing.verify_execution' || capabilityId === 'ops.billing_verification') {
    const { evaluateBillingEvidence, integrationStatus } = require('./billing-verification-adapter');
    const integration = integrationStatus();
    const evidence = outcome?.result?.evidence || outcome?.evidence || null;
    const judged = evaluateBillingEvidence(evidence, { tenant_id: ctx.tenant_id || null });
    checks.push({
      check_id: 'billing.evidence',
      status: judged.verified ? 'PASS' : judged.status === 'BLOCKED' ? 'BLOCKED' : 'FAIL',
      expected: 'fresh provider evidence for the authorized tenant',
      observed: judged.disposition,
      at,
      remediation: integration.integrated ? judged.reason : 'PR #368 verified-execution is not on this branch',
    });
  }

  if (!checks.length) {
    return { checks: [], verification: verifySyncCapability(outcome) };
  }

  const pass = checks.every((c) => c.status === 'PASS');
  const verification = buildVerification({
    mandatory: true,
    dispatched: true,
    runnerOk: outcome?.ok === true,
    evidence: {
      contracts: checks,
      executor_ok: outcome?.ok ?? null,
      correlation_id: outcome?.correlation_id ?? null,
      ts: at,
    },
  });
  if (pass && outcome?.ok === true) {
    verification.status = 'VERIFIED';
    verification.verified = true;
  } else if (!pass) {
    verification.status = 'FAILED';
    verification.verified = false;
  }
  return { checks, verification };
}

module.exports = { runContractChecks };
