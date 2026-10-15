'use strict';

const {
  runBillingPreflight,
  runBillingVerifyWorkflow,
  runBillingVerifyExecution,
  runBillingReadinessReport,
} = require('../../../lib/mobile-ops/action-runners');
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

  it('billing.verify_execution returns checks and does not claim merge eligible', async () => {
    const fs = require('fs');
    const os = require('os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-exec-'));
    const out = await runBillingVerifyExecution({}, { repoRoot: tmp });
    expect(out.task_id).toMatch(/^[a-f0-9]{24}$/);
    expect(out.checks.some((c) => c.check_id === 'J.evidence_disposition')).toBe(true);
    expect(out.readiness.merge_eligible).toBe(false);
    const report = await runBillingReadinessReport({ task_id: out.task_id }, { repoRoot: tmp });
    expect(report.ok).toBe(true);
    expect(report.readiness.merge_eligible).toBe(false);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
