'use strict';

const crypto = require('crypto');

/**
 * Operator write gate for submission/award/source-verification.
 * Reference strings alone are not authorization — explicit operator context + optional secret required.
 */
function assertOperatorAuthorization(operatorContext = {}, opts = {}) {
  const actor = operatorContext.actor;
  if (actor !== 'human:owner' && actor !== 'human:operator') {
    return {
      ok: false,
      error: 'operator_authorization_required',
      message: 'Submission, award, and source verification require human:owner or human:operator actor.',
    };
  }
  const method = operatorContext.method;
  if (!method || typeof method !== 'string') {
    return { ok: false, error: 'operator_method_required', message: 'operatorContext.method is required (e.g. cli, mobile_control, mission_approve).' };
  }

  if (opts.allowTestHarness && operatorContext.proof === 'test_harness') {
    return { ok: true, actor, method };
  }

  const secret = process.env.HYDI_PARTNERSHIPS_OPERATOR_SECRET || process.env.HYDI_SERVICE_SECRET;
  const token = operatorContext.token;
  if (!secret || !token) {
    return {
      ok: false,
      error: 'operator_token_required',
      message: 'Set HYDI_PARTNERSHIPS_OPERATOR_SECRET and pass matching operatorContext.token for write operations.',
    };
  }
  try {
    const a = Buffer.from(String(token));
    const b = Buffer.from(String(secret));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, error: 'operator_token_invalid' };
    }
  } catch {
    return { ok: false, error: 'operator_token_invalid' };
  }
  return { ok: true, actor, method };
}

function validateEvidenceBundle(evidence, { requireSubmission = false, requireAward = false } = {}) {
  if (!evidence || typeof evidence !== 'object') {
    return { ok: false, error: 'evidence_required' };
  }
  if (requireSubmission && !evidence.submission_reference) {
    return { ok: false, error: 'submission_evidence_required' };
  }
  if (requireAward && !evidence.award_reference) {
    return { ok: false, error: 'award_evidence_required' };
  }
  return { ok: true };
}

module.exports = { assertOperatorAuthorization, validateEvidenceBundle };