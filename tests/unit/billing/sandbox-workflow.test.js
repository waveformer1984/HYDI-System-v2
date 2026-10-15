'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createTask,
  loadTask,
  runAutomatedSteps,
  checkEnvSecrets,
  finalReport,
  BILLING_TABLES,
} = require('../../../lib/billing/sandbox-workflow');

describe('billing sandbox workflow', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-verify-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('creates a task with step statuses NOT_RUN', () => {
    const task = createTask(tmpRoot);
    expect(task.id).toMatch(/^[a-f0-9]{24}$/);
    expect(task.steps.length).toBeGreaterThan(10);
    expect(task.steps.every((s) => s.status === 'NOT_RUN')).toBe(true);
    expect(loadTask(tmpRoot, task.id).id).toBe(task.id);
  });

  it('lists all migration billing tables', () => {
    expect(BILLING_TABLES).toContain('billing_webhook_events');
    expect(BILLING_TABLES).toContain('billing_tenant_members');
    expect(BILLING_TABLES).toContain('billing_walkie_tenant_bindings');
    expect(BILLING_TABLES.length).toBe(16);
  });

  it('marks env_secrets BLOCKED when secrets missing', async () => {
    const prev = { ...process.env };
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.BILLING_CUSTOMER_TOKEN_SECRET;
    delete process.env.BILLING_STRIPE_WEBHOOK_SECRET;
    delete process.env.BILLING_PROVIDER;
    const env = await checkEnvSecrets();
    expect(env.ok).toBe(false);
    Object.assign(process.env, prev);
  });

  it('runAutomatedSteps fails postgres when db is down', async () => {
    const task = createTask(tmpRoot);
    const prevPort = process.env.PG_PORT;
    process.env.PG_PORT = '1';
    await runAutomatedSteps(task, tmpRoot);
    process.env.PG_PORT = prevPort;
    const pgStep = task.steps.find((s) => s.id === 'postgres_connect');
    expect(pgStep.status).toBe('FAIL');
    const report = finalReport(task);
    expect(report.failures.some((f) => f.id === 'postgres_connect')).toBe(true);
  });
});
