'use strict';

const { resolveCustomerIdentity, legacyTokensEnabled } = require('../../../lib/billing/customer-identity');
const { issueCustomerToken } = require('../../../lib/billing/customer-auth');
const { MemoryBillingStore } = require('../../../lib/billing/stores/memory-store');
const { registerTenantOwner, bindWalkieOwner } = require('../../../lib/billing/identity-service');

const SECRET = 'customer-identity-test-secret-0123456789abcd';

describe('billing customer identity (A+B)', () => {
  let store;
  let tenantA;
  let tenantB;

  beforeEach(async () => {
    store = new MemoryBillingStore();
    tenantA = await store.insert('billing_tenants', { name: 'A', email: 'a@test.example', status: 'active' });
    tenantB = await store.insert('billing_tenants', { name: 'B', email: 'b@test.example', status: 'active' });
    process.env.BILLING_CUSTOMER_TOKEN_SECRET = SECRET;
    process.env.BILLING_LEGACY_CUSTOMER_TOKEN = 'true';
    process.env.BILLING_SUPABASE_AUTH = 'false';
  });

  it('legacy bearer token resolves tenant', async () => {
    const { token } = issueCustomerToken(tenantA.tenant_id, { secret: SECRET });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const ctx = await resolveCustomerIdentity(req, {}, { store });
    expect(ctx.tenantId).toBe(tenantA.tenant_id);
    expect(ctx.mode).toBe('legacy_customer_token');
  });

  it('walkie binding required — device without binding gets no access', async () => {
    const req = { headers: { 'x-hydi-device-token': '1.2.dev1.sig' } };
    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { device_id: 'dev1', role: 'operator', status: 'approved', secret_hash: 'abc' },
              error: null,
            }),
          }),
        }),
      }),
    };
    const ctx = await resolveCustomerIdentity(req, {}, { store, supabaseLookupDevice: mockSupabase });
    expect(ctx).toBeNull();
  });

  it('registers owner membership row for auth user', async () => {
    const userId = '11111111-1111-1111-1111-111111111111';
    const row = await registerTenantOwner(store, { tenantId: tenantA.tenant_id, authUserId: userId, actor: { type: 'customer', id: userId } });
    expect(row.role).toBe('owner');
    const hit = await store.findOne('billing_tenant_members', { auth_user_id: userId });
    expect(hit.tenant_id).toBe(tenantA.tenant_id);
  });

  it('tenant B token cannot resolve as tenant A', async () => {
    const { token } = issueCustomerToken(tenantB.tenant_id, { secret: SECRET });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const ctx = await resolveCustomerIdentity(req, {}, { store });
    expect(ctx.tenantId).not.toBe(tenantA.tenant_id);
  });

  it('legacy path can be disabled', () => {
    process.env.BILLING_LEGACY_CUSTOMER_TOKEN = 'false';
    expect(legacyTokensEnabled()).toBe(false);
  });

  it('walkie with approved binding resolves bound tenant only', async () => {
    const { signDeviceToken } = require('../../../lib/auth/deviceAuth');
    const signingKey = 'walkie-test-signing-key-0123456789ab';
    await bindWalkieOwner(store, {
      deviceId: 'dev-bound',
      tenantId: tenantA.tenant_id,
      actor: { type: 'operator', id: 'op1' },
      reason: 'test bind',
    });
    const deviceToken = signDeviceToken('dev-bound', signingKey);
    const req = { headers: { 'x-hydi-device-token': deviceToken } };
    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { device_id: 'dev-bound', role: 'operator', status: 'approved', secret_hash: signingKey },
              error: null,
            }),
          }),
        }),
      }),
    };
    const ctx = await resolveCustomerIdentity(req, {}, { store, supabaseLookupDevice: mockSupabase });
    expect(ctx.tenantId).toBe(tenantA.tenant_id);
    expect(ctx.mode).toBe('walkie_owner_binding');
  });

  it('ambiguous active membership fails closed with BillingError', async () => {
    const userId = '22222222-2222-2222-2222-222222222222';
    await registerTenantOwner(store, { tenantId: tenantA.tenant_id, authUserId: userId, actor: { type: 'customer', id: userId } });
    await store.insert('billing_tenant_members', {
      tenant_id: tenantB.tenant_id,
      auth_user_id: userId,
      role: 'member',
      status: 'active',
    });
    const { getActiveMembershipForUser } = require('../../../lib/billing/identity-service');
    await expect(getActiveMembershipForUser(store, userId)).rejects.toMatchObject({
      code: 'membership_ambiguous',
      status: 409,
    });
  });

  it('session without membership falls through to legacy token', async () => {
    process.env.BILLING_SUPABASE_AUTH = 'true';
    const { token } = issueCustomerToken(tenantA.tenant_id, { secret: SECRET });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const mockSupabase = {
      auth: {
        getUser: async () => ({ data: { user: { id: '33333333-3333-3333-3333-333333333333' } }, error: null }),
      },
    };
    const original = require('../../../lib/billing/supabase-server').createBillingSupabaseServer;
    require('../../../lib/billing/supabase-server').createBillingSupabaseServer = () => mockSupabase;
    try {
      const ctx = await resolveCustomerIdentity(req, {}, { store });
      expect(ctx.mode).toBe('legacy_customer_token');
      expect(ctx.tenantId).toBe(tenantA.tenant_id);
    } finally {
      require('../../../lib/billing/supabase-server').createBillingSupabaseServer = original;
    }
  });
});
