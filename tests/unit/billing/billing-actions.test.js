'use strict';

const { runBillingPreflight, runBillingVerifyWorkflow } = require('../../../lib/mobile-ops/action-runners');
const path = require('path');

describe('billing typed actions', () => {
  it('billing.preflight parses PASS/FAIL lines', async () => {
    const out = await runBillingPreflight({
      preflightExec: async () => ({
        stdout: 'PASS postgres_connect: Postgres reachable\nFAIL billing_tables: missing: x\n',
        stderr: '',
      }),
      repoRoot: path.join(__dirname, '../../..'),
    });
    expect(out.ok).toBe(false);
    expect(out.checks).toHaveLength(2);
  });

  it('billing.verify_workflow creates task and returns report', async () => {
    const fs = require('fs');
    const os = require('os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-action-'));
    const out = await runBillingVerifyWorkflow({}, { repoRoot: tmp });
    expect(out.task_id).toMatch(/^[a-f0-9]{24}$/);
    expect(out.report.summary).toBeDefined();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
