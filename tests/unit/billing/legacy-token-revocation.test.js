'use strict';

const { MemoryBillingStore } = require('../../../lib/billing/stores/memory-store');
const { issueCustomerToken, verifyCustomerToken } = require('../../../lib/billing/customer-auth');
const {
  revokeLegacyTokenNonce,
  revokeAllLegacyTokensForTenant,
  assertLegacyTokenAuthorized,
} = require('../../../lib/billing/legacy-token-revocation');
const { resolveCustomerIdentity } = require('../../../lib/billing/customer-identity');

const SECRET = 'legacy-revocation-test-secret-0123456789ab';

describe('legacy hbc1 revocation', () => {
  let store;
  let tenant;

  beforeEach(async () => {
    store = new MemoryBillingStore();
    tenant = await store.insert('billing_tenants', { name: 'T', email: 't@test.example', status: 'active' });
    process.env.BILLING_CUSTOMER_TOKEN_SECRET = SECRET;
    process.env.BILLING_LEGACY_CUSTOMER_TOKEN = 'true';
    process.env.BILLING_SUPABASE_AUTH = 'false';
  });

  it('denies token after per-nonce revocation', async () => {
    const { token } = issueCustomerToken(tenant.tenant_id, { secret: SECRET });
    const verified = verifyCustomerToken(token, { secret: SECRET });
    expect(verified.valid).toBe(true);
    await revokeLegacyTokenNonce(store, {
      tenantId: tenant.tenant_id,
      tokenNonce: verified.tokenNonce,
      actor: { type: 'operator', id: 'op' },
      reason: 'compromised token',
    });
    const blocked = await assertLegacyTokenAuthorized(store, verified);
    expect(blocked.valid).toBe(false);
    const ctx = await resolveCustomerIdentity({ headers: { authorization: `Bearer ${token}` } }, {}, { store });
    expect(ctx).toBeNull();
  });

  it('denies tokens below tenant min_valid_iat floor', async () => {
    const { token } = issueCustomerToken(tenant.tenant_id, { secret: SECRET });
    await revokeAllLegacyTokensForTenant(store, {
      tenantId: tenant.tenant_id,
      actor: { type: 'operator', id: 'op' },
      reason: 'emergency revoke all',
    });
    const verified = verifyCustomerToken(token, { secret: SECRET });
    const blocked = await assertLegacyTokenAuthorized(store, verified);
    expect(blocked.valid).toBe(false);
  });

  it('idempotent nonce revocation', async () => {
    const { token } = issueCustomerToken(tenant.tenant_id, { secret: SECRET });
    const { tokenNonce } = verifyCustomerToken(token, { secret: SECRET });
    const a = await revokeLegacyTokenNonce(store, {
      tenantId: tenant.tenant_id,
      tokenNonce,
      actor: { type: 'operator', id: 'op' },
      reason: 'first revoke',
    });
    const b = await revokeLegacyTokenNonce(store, {
      tenantId: tenant.tenant_id,
      tokenNonce,
      actor: { type: 'operator', id: 'op' },
      reason: 'second revoke',
    });
    expect(a.revoked).toBe(true);
    expect(b.duplicate).toBe(true);
  });
});
