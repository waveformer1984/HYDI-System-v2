'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const BusinessMemory = require('../../../src/hydi-v3/BusinessMemory');
const { ExecutionGateway } = require('../../../src/hydi-v3/ExecutionGateway');
const { CapabilityAdapter } = require('../../../src/hydi-v3/CapabilityAdapters');

class DangerousAdapter extends CapabilityAdapter {
  constructor() {
    super('dangerous', ['delete-file', 'send-email']);
  }

  async execute(action) {
    this.validate(action);
    return { executed: true, type: action.type };
  }
}

describe('ExecutionGateway', () => {
  let gateway;
  let memory;
  let dataPath;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `heidi-exec-gateway-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });
    memory = new BusinessMemory({ dataPath, logger: { log: () => {}, error: () => {} } });
    await memory.start();
    gateway = new ExecutionGateway({ dataPath, businessMemory: memory, logger: { log: () => {}, error: () => {} } });
    await gateway.start();
  });

  afterEach(async () => {
    if (gateway) await gateway.destroy().catch(() => {});
    if (memory) await memory.destroy().catch(() => {});
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    gateway = null;
    memory = null;
  });

  test('lifecycle methods work', async () => {
    expect(gateway._started).toBe(true);
    await gateway.flush();
    const health = gateway.healthCheck();
    expect(health.ok).toBe(true);
    gateway.stop();
    expect(gateway._started).toBe(false);
    await gateway.destroy();
    expect(gateway._destroyed).toBe(true);
  });

  test('registers default adapters and exposes capabilities', () => {
    const caps = gateway.getCapabilities();
    expect(caps.length).toBeGreaterThan(0);
    expect(caps.some((c) => c.action === 'create-report')).toBe(true);
    expect(caps.some((c) => c.action === 'draft-email')).toBe(true);
  });

  test('executes autonomous documentation action', async () => {
    const result = await gateway.execute({
      type: 'create-report',
      params: { file: 'reports/test-report.md', content: '# Test' },
      requestingAgent: 'Sales Manager',
    });
    expect(result.status).toBe('completed');
    expect(result.result.file).toContain('test-report.md');
    const history = gateway.getExecutionHistory({ status: 'completed' });
    expect(history.length).toBe(1);
  });

  test('holds review-required actions for approval', async () => {
    const result = await gateway.execute({
      type: 'draft-email',
      params: { to: 'client@example.com' },
      requestingAgent: 'Sales Manager',
    });
    expect(result.status).toBe('awaiting-approval');
    expect(gateway.getPendingApprovals().length).toBe(1);
  });

  test('approves and executes pending action', async () => {
    const pending = await gateway.execute({
      type: 'generate-proposal',
      params: { customer: 'Acme', value: 1000 },
      requestingAgent: 'Sales Manager',
    });
    const approved = await gateway.approve(pending.id);
    expect(approved.status).toBe('completed');
    expect(approved.result.customer).toBe('Acme');
  });

  test('rejects pending action', async () => {
    const pending = await gateway.execute({
      type: 'draft-email',
      params: { to: 'client@example.com' },
      requestingAgent: 'Sales Manager',
    });
    const rejected = gateway.reject(pending.id);
    expect(rejected.status).toBe('rejected');
    expect(gateway.getExecutionHistory({ status: 'rejected' }).length).toBe(1);
  });

  test('refuses forbidden actions even if adapter supports them', async () => {
    gateway.addAdapter(new DangerousAdapter());
    await expect(gateway.execute({ type: 'delete-file', params: { file: 'x' } })).rejects.toThrow('Forbidden action');
    await expect(gateway.execute({ type: 'send-email', params: {} })).rejects.toThrow('Forbidden action');
  });

  test('simulates actions without side effects', async () => {
    const simGateway = new ExecutionGateway({
      dataPath,
      businessMemory: memory,
      simulate: true,
      logger: { log: () => {}, error: () => {} },
    });
    await simGateway.start();
    const result = await simGateway.execute({ type: 'create-report', params: { file: 'x.md' } });
    expect(result.status).toBe('completed');
    expect(result.result.simulated).toBe(true);
    const file = path.join(dataPath, 'x.md');
    await expect(fs.access(file)).rejects.toThrow();
    await simGateway.destroy();
  });

  test('records audit history with all required fields', async () => {
    await gateway.execute({
      type: 'generate-summary',
      params: { text: 'hello world' },
      requestingAgent: 'Research Manager',
      workflowId: 'wf_1',
    });
    const entries = gateway.getExecutionHistory();
    const entry = entries[0];
    expect(entry.timestamp).toBeTruthy();
    expect(entry.requestingAgent).toBe('Research Manager');
    expect(entry.workflowId).toBe('wf_1');
    expect(entry.type).toBe('generate-summary');
    expect(entry.status).toBe('completed');
    expect(entry.approvalState).toBe('approved');
    expect(entry.result).toBeTruthy();
  });

  test('dashboard data aggregates counts and agent activity', async () => {
    await gateway.execute({ type: 'create-report', params: {}, requestingAgent: 'A' });
    const pending = await gateway.execute({ type: 'draft-email', params: {}, requestingAgent: 'B' });
    await gateway.reject(pending.id);
    await expect(gateway.execute({ type: 'unknown-action', params: {} })).rejects.toThrow();
    const dash = gateway.getDashboardData();
    expect(dash.counts.completed).toBeGreaterThanOrEqual(1);
    expect(dash.counts.rejected).toBe(1);
    expect(dash.agentActivity.A).toBe(1);
    expect(dash.agentActivity.B).toBe(1);
  });

  test('persists and restores log across instances', async () => {
    const result = await gateway.execute({ type: 'create-report', params: { file: 'persist.md' } });
    await gateway.destroy();

    const restored = new ExecutionGateway({ dataPath, businessMemory: memory, logger: { log: () => {}, error: () => {} } });
    await restored.start();
    const history = restored.getExecutionHistory();
    expect(history.some((e) => e.id === result.id)).toBe(true);
    await restored.destroy();
  });

  test('recovers from corrupted persistence', async () => {
    const file = path.join(dataPath, 'execution-gateway.json');
    await fs.writeFile(file, 'not-json { corrupted');
    const restored = new ExecutionGateway({ dataPath, businessMemory: memory, logger: { log: () => {}, error: () => {} } });
    await expect(restored.start()).resolves.toBeUndefined();
    expect(restored.healthCheck().ok).toBe(true);
    await restored.destroy();
  });

  test('adversarial: an agent cannot bypass the gateway by adding a dangerous adapter', async () => {
    gateway.addAdapter(new DangerousAdapter());
    await expect(gateway.execute({ type: 'send-email', params: {} })).rejects.toThrow('Forbidden action');
    const history = gateway.getExecutionHistory({ status: 'rejected' });
    expect(history.some((e) => e.type === 'send-email')).toBe(true);
  });

  test('benchmark: executes 100 autonomous actions in under one second', async () => {
    const start = Date.now();
    for (let i = 0; i < 100; i += 1) {
      await gateway.execute({ type: 'generate-summary', params: { text: `text ${i}` } });
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });
});
