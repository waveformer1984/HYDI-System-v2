'use strict';

const { randomUUID } = require('crypto');
const { BillingError } = require('./errors');
const { verifyCustomerToken, parseCustomerTokenClaims } = require('./customer-auth');

async function getTenantLegacyPolicy(store, tenantId) {
  const row = await store.findOne('billing_tenant_legacy_policy', { tenant_id: tenantId });
  return row || { tenant_id: tenantId, min_valid_iat: 0 };
}

async function isLegacyTokenRevoked(store, { tenantId, tokenNonce, iat }) {
  if (!tenantId) return true;
  const policy = await getTenantLegacyPolicy(store, tenantId);
  if (typeof iat === 'number' && iat < Number(policy.min_valid_iat || 0)) return true;
  if (!tokenNonce) return false;
  const hit = await store.findOne('billing_legacy_token_revocations', { tenant_id: tenantId, token_nonce: tokenNonce });
  return Boolean(hit);
}

async function assertLegacyTokenAuthorized(store, verified) {
  if (!verified.valid) return verified;
  const revoked = await isLegacyTokenRevoked(store, {
    tenantId: verified.tenantId,
    tokenNonce: verified.tokenNonce,
    iat: verified.iat,
  });
  if (revoked) return { valid: false, reason: 'token revoked' };
  return verified;
}

async function revokeLegacyTokenNonce(store, { tenantId, tokenNonce, actor, reason }) {
  if (!tokenNonce) throw new BillingError('invalid_request', 'token_nonce required', 400);
  const row = await store.insert(
    'billing_legacy_token_revocations',
    { tenant_id: tenantId, token_nonce: tokenNonce, revoked_by: actor?.id || null, reason: reason || null },
    { ignoreConflict: true },
  );
  await store.insert('billing_audit_events', {
    audit_id: randomUUID(),
    tenant_id: tenantId,
    actor_type: actor?.type || 'operator',
    actor_id: actor?.id || null,
    action: 'legacy.token.revoked',
    target_type: 'billing_legacy_token',
    target_id: tokenNonce,
    reason: reason || 'operator revoke',
    before: null,
    after: { tenant_id: tenantId, token_nonce: tokenNonce },
  });
  return { revoked: true, tenant_id: tenantId, token_nonce: tokenNonce, duplicate: !row };
}

async function revokeAllLegacyTokensForTenant(store, { tenantId, actor, reason, now = new Date() }) {
  const minValidIat = Math.floor(now.getTime() / 1000) + 1;
  const existing = await getTenantLegacyPolicy(store, tenantId);
  const prior = await store.findOne('billing_tenant_legacy_policy', { tenant_id: tenantId });
  if (prior) {
    await store.update('billing_tenant_legacy_policy', { tenant_id: tenantId }, { min_valid_iat: minValidIat, updated_at: now });
  } else {
    await store.insert('billing_tenant_legacy_policy', { tenant_id: tenantId, min_valid_iat: minValidIat, updated_at: now });
  }
  await store.insert('billing_audit_events', {
    audit_id: randomUUID(),
    tenant_id: tenantId,
    actor_type: actor?.type || 'operator',
    actor_id: actor?.id || null,
    action: 'legacy.tenant_floor_raised',
    target_type: 'billing_tenant_legacy_policy',
    target_id: tenantId,
    reason: reason || 'revoke all legacy tokens',
    before: existing,
    after: { min_valid_iat: minValidIat },
  });
  return { tenant_id: tenantId, min_valid_iat: minValidIat };
}

/** Resolve tenant + nonce from bearer without trusting client tenant_id. */
function resolveLegacyBearerClaims(bearer) {
  if (!bearer) return null;
  const verified = verifyCustomerToken(bearer);
  if (verified.valid) {
    return { tenant_id: verified.tenantId, token_nonce: verified.tokenNonce, iat: verified.iat };
  }
  return parseCustomerTokenClaims(bearer);
}

module.exports = {
  isLegacyTokenRevoked,
  assertLegacyTokenAuthorized,
  revokeLegacyTokenNonce,
  revokeAllLegacyTokensForTenant,
  getTenantLegacyPolicy,
  resolveLegacyBearerClaims,
};
