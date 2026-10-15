'use strict';

const { MemoryBillingStore } = require('../../../lib/billing/stores/memory-store');
const {
  bindWalkieOwner,
  revokeWalkieBinding,
  setMembershipStatus,
  getActiveMembershipForUser,
  getWalkieBinding,
} = require('../../../lib/billing/identity-service');
const { resolveCustomerIdentity } = require('../../../lib/billing/customer-identity');
const { signDeviceToken } = require('../../../lib/auth/deviceAuth');

describe('billing identity lifecycle', () => {
  let store;
  let tenant;

  beforeEach(async () => {
    store = new MemoryBillingStore();
    tenant = await store.insert('billing_tenants', { name: 'T', email: 't@test.example', status: 'active' });
    process.env.BILLING_SUPABASE_AUTH = 'false';
    process.env.BILLING_LEGACY_CUSTOMER_TOKEN = 'false';
  });

  it('revokes walkie binding and denies billing on next resolve', async () => {
    const signingKey = 'lifecycle-walkie-key-123456789012';
    await bindWalkieOwner(store, {
      deviceId: 'dev1',
      tenantId: tenant.tenant_id,
      actor: { type: 'operator', id: 'op' },
      reason: 'approve bind',
    });
    expect(await getWalkieBinding(store, 'dev1')).toBeTruthy();
    await revokeWalkieBinding(store, {
      deviceId: 'dev1',
      tenantId: tenant.tenant_id,
      actor: { type: 'operator', id: 'op' },
      reason: 'revoke bind',
    });
    expect(await getWalkieBinding(store, 'dev1')).toBeNull();
    const token = signDeviceToken('dev1', signingKey);
    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { device_id: 'dev1', role: 'operator', status: 'approved', secret_hash: signingKey },
              error: null,
            }),
          }),
        }),
      }),
    };
    const ctx = await resolveCustomerIdentity(
      { headers: { 'x-hydi-device-token': token } },
      {},
      { store, supabaseLookupDevice: mockSupabase },
    );
    expect(ctx).toBeNull();
  });

  it('revokes membership and active lookup returns null', async () => {
    const userId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    await store.insert('billing_tenant_members', {
      tenant_id: tenant.tenant_id,
      auth_user_id: userId,
      role: 'owner',
      status: 'active',
    });
    await setMembershipStatus(store, {
      tenantId: tenant.tenant_id,
      authUserId: userId,
      status: 'revoked',
      actor: { type: 'operator', id: 'op' },
      reason: 'offboard user',
    });
    expect(await getActiveMembershipForUser(store, userId)).toBeNull();
  });

  it('rejects cross-tenant rebind without revoke', async () => {
    const other = await store.insert('billing_tenants', { name: 'O', email: 'o@test.example', status: 'active' });
    await bindWalkieOwner(store, {
      deviceId: 'dev-x',
      tenantId: tenant.tenant_id,
      actor: { type: 'operator', id: 'op' },
      reason: 'first bind',
    });
    await expect(
      bindWalkieOwner(store, {
        deviceId: 'dev-x',
        tenantId: other.tenant_id,
        actor: { type: 'operator', id: 'op' },
        reason: 'second bind',
      }),
    ).rejects.toMatchObject({ code: 'conflict', status: 409 });
  });
});
