'use strict';

const { BillingService } = require('../../../lib/billing/service');
const { MemoryBillingStore } = require('../../../lib/billing/stores/memory-store');
const { FakeBillingProvider } = require('../../../lib/billing/providers/fake-provider');
const { registerTenantOwner } = require('../../../lib/billing/identity-service');

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

describe('requireCustomer identity errors', () => {
  it('returns 409 when user has multiple active memberships', async () => {
    jest.resetModules();
    const mockSupabase = {
      auth: {
        getUser: async () => ({ data: { user: { id: '44444444-4444-4444-4444-444444444444' } }, error: null }),
      },
    };
    jest.doMock('../../../lib/billing/supabase-server', () => ({
      createBillingSupabaseServer: () => mockSupabase,
      createBillingSupabaseAdmin: () => null,
      parseCookieHeader: () => [],
    }));

    const { requireCustomer, setBillingService } = require('../../../lib/billing/http');
    const store = new MemoryBillingStore();
    setBillingService(new BillingService({ store, provider: new FakeBillingProvider() }));
    process.env.BILLING_SUPABASE_AUTH = 'true';
    process.env.BILLING_LEGACY_CUSTOMER_TOKEN = 'false';

    const tenantA = await store.insert('billing_tenants', { name: 'A', email: 'a@test.example', status: 'active' });
    const tenantB = await store.insert('billing_tenants', { name: 'B', email: 'b@test.example', status: 'active' });
    const userId = '44444444-4444-4444-4444-444444444444';
    await registerTenantOwner(store, { tenantId: tenantA.tenant_id, authUserId: userId, actor: { type: 'customer', id: userId } });
    await store.insert('billing_tenant_members', {
      tenant_id: tenantB.tenant_id,
      auth_user_id: userId,
      role: 'member',
      status: 'active',
    });

    const req = { headers: {}, method: 'POST' };
    const res = mockRes();
    const tenantId = await requireCustomer(req, res, { routeName: 'test-checkout' });
    expect(tenantId).toBeNull();
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('membership_ambiguous');
  });
});
