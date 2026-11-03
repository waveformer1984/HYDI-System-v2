'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { getBillingOpsSnapshot, readBillingAlertSync } = require('../../lib/billing/ops-snapshot');

describe('billing ops snapshot', () => {
  it('reads reconcile errors from worker status file', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-ops-'));
    const statusDir = path.join(root, '.runtime', 'billing');
    fs.mkdirSync(statusDir, { recursive: true });
    fs.writeFileSync(path.join(statusDir, 'worker-status.json'), JSON.stringify({
      ts: new Date().toISOString(),
      lastReconcile: { errors: [{ code: 'x' }], subscriptions_checked: 1 },
    }));
    const alert = readBillingAlertSync(root);
    expect(alert).toMatch(/reconcile reported 1 error/);
    const snap = await getBillingOpsSnapshot({ root });
    expect(snap.worker.last_reconcile.error_count).toBe(1);
  });
});
