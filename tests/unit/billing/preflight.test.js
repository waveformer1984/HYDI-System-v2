'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

describe('billing-preflight script', () => {
  it('fails when postgres is unreachable', () => {
    const script = path.join(__dirname, '../../../scripts/billing-preflight.js');
    const res = spawnSync(process.execPath, [script], {
      env: { ...process.env, PG_PORT: '1', BILLING_PROVIDER: 'fake', BILLING_CUSTOMER_TOKEN_SECRET: 'x'.repeat(32) },
      encoding: 'utf8',
    });
    expect(res.status).not.toBe(0);
    expect(res.stdout || res.stderr).toMatch(/postgres_connect|ECONNREFUSED|connect/i);
  });
});
