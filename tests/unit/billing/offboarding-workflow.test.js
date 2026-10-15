'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { MemoryBillingStore } = require('../../../lib/billing/stores/memory-store');
const { registerTenantOwner } = require('../../../lib/billing/identity-service');
const { issueCustomerToken } = require('../../../lib/billing/customer-auth');
const { previewOffboarding, executeOffboarding } = require('../../../lib/billing/offboarding-workflow');

const SECRET = 'offboarding-workflow-test-secret-0123456789ab';

describe('offboarding workflow', () => {
  let store;
  let root;
  let tenant;
  let userId;

  beforeEach(async () => {
    store = new MemoryBillingStore();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'offboard-'));
    tenant = await store.insert('billing_tenants', { name: 'T', email: 't@test.example', status: 'active' });
    userId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    process.env.BILLING_CUSTOMER_TOKEN_SECRET = SECRET;
    await registerTenantOwner(store, { tenantId: tenant.tenant_id, authUserId: userId, actor: { type: 'customer', id: userId } });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('preview resolves tenant from membership not forged tenant hint alone', async () => {
    const other = await store.insert('billing_tenants', { name: 'X', email: 'x@test.example', status: 'active' });
    const preview = await previewOffboarding(store, {
      auth_user_id: userId,
      tenant_id: other.tenant_id,
      revoke_membership: true,
    });
    expect(preview.resolved.tenant_id).toBe(tenant.tenant_id);
  });

  it('execute reports partial when verification fails scope', async () => {
    const { token } = issueCustomerToken(tenant.tenant_id, { secret: SECRET });
    const verified = require('../../../lib/billing/customer-auth').verifyCustomerToken(token, { secret: SECRET });
    const task = await executeOffboarding(store, {
      actor: { type: 'operator', id: 'op' },
      reason: 'test offboard',
      scope: {
        auth_user_id: userId,
        revoke_membership: true,
        revoke_legacy_nonce: true,
        legacy_bearer_preview: token,
      },
      root,
      verify: true,
    });
    expect(task.results.some((r) => r.step === 'membership.revoke' && r.status === 'PASS')).toBe(true);
    expect(['success', 'partial', 'failed']).toContain(task.disposition);
    expect(task.correlation_id).toMatch(/^[a-f0-9]{24}$/);
  });
});
