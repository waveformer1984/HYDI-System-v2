'use strict';

/**
 * Narrow billing verification contract.
 * Detects `lib/billing/verified-execution.js` (landed with PR #368) at
 * runtime: present → 'adapter_ready', absent → 'blocked_pending_pr_368'.
 * Either way billing verification is never claimed without fresh, tenant-
 * matched provider evidence, and this module never creates charges.
 */

const MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;

function verifiedExecutionModule() {
  try {
    return require('../billing/verified-execution');
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? err.code : null;
    if (code === 'MODULE_NOT_FOUND') return null;
    throw err;
  }
}

function integrationStatus() {
  const mod = verifiedExecutionModule();
  const integrated = Boolean(mod && typeof mod.runVerifiedBillingExecution === 'function');
  return {
    integrated,
    real_money_enabled: false,
    disposition: integrated ? 'adapter_ready' : 'blocked_pending_pr_368',
    verified: false,
    pr: integrated ? null : 368,
    note: 'Provider-backed verification is not claimed unless a live sandbox report with matching tenant evidence is supplied and evaluated.',
  };
}

/**
 * Fail-closed evaluation of a billing evidence bundle.
 * Indeterminate / pending outcomes require reconciliation and are not retryable as a new charge.
 * @param {object|null|undefined} evidence
 * @param {{ tenant_id?: string|null, now?: number }} [ctx]
 */
function evaluateBillingEvidence(evidence, ctx = {}) {
  const now = ctx.now || Date.now();
  if (!evidence || typeof evidence !== 'object') {
    return {
      verified: false,
      status: 'FAIL',
      disposition: 'missing_evidence',
      retryable_charge: false,
      reason: 'missing_evidence',
    };
  }
  const evidenceTenant = evidence.tenant_id || null;
  if (ctx.tenant_id && evidenceTenant && evidenceTenant !== ctx.tenant_id) {
    return {
      verified: false,
      status: 'FAIL',
      disposition: 'tenant_mismatch',
      retryable_charge: false,
      reason: 'tenant_mismatch',
    };
  }
  if (ctx.tenant_id && !evidenceTenant) {
    return {
      verified: false,
      status: 'FAIL',
      disposition: 'tenant_mismatch',
      retryable_charge: false,
      reason: 'evidence_missing_tenant',
    };
  }
  const observedAt = evidence.observed_at ? Date.parse(evidence.observed_at) : NaN;
  if (!evidence.observed_at || Number.isNaN(observedAt) || now - observedAt > MAX_EVIDENCE_AGE_MS) {
    return {
      verified: false,
      status: 'FAIL',
      disposition: 'stale_or_undated_evidence',
      retryable_charge: false,
      reason: 'stale_or_undated_evidence',
    };
  }
  const provider = evidence.provider_status || evidence.status;
  if (provider === 'pending' || provider === 'indeterminate' || provider === 'processing') {
    return {
      verified: false,
      status: 'BLOCKED',
      disposition: 'needs_reconciliation',
      retryable_charge: false,
      reason: 'indeterminate_provider_outcome',
    };
  }
  if (provider === 'reversed' || provider === 'failed' || provider === 'canceled') {
    return {
      verified: false,
      status: 'FAIL',
      disposition: provider,
      retryable_charge: false,
      reason: `provider_${provider}`,
    };
  }
  if (provider === 'succeeded' && evidence.idempotency_key && evidence.provider_object_id) {
    return {
      verified: true,
      status: 'PASS',
      disposition: 'verified',
      retryable_charge: false,
      reason: null,
      idempotency_key: evidence.idempotency_key,
    };
  }
  return {
    verified: false,
    status: 'FAIL',
    disposition: 'insufficient_evidence',
    retryable_charge: false,
    reason: 'insufficient_evidence',
  };
}

module.exports = {
  MAX_EVIDENCE_AGE_MS,
  integrationStatus,
  evaluateBillingEvidence,
  verifiedExecutionModule,
};
