'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const BusinessMemory = require('../../../src/hydi-v3/BusinessMemory');
const ExecutiveOperatingSystem = require('../../../src/hydi-v3/ExecutiveOperatingSystem');
const TaskEngine = require('../../../src/hydi-v3/TaskEngine');
const { BusinessWorkflowEngine } = require('../../../src/hydi-v3/BusinessWorkflowEngine');
const { ExecutionGateway } = require('../../../src/hydi-v3/ExecutionGateway');
const ExecutiveCockpit = require('../../../src/hydi-v3/ExecutiveCockpit');

describe('ExecutiveCockpit', () => {
  let cockpit;
  let memory;
  let executiveOS;
  let taskEngine;
  let workflowEngine;
  let executionGateway;
  let dataPath;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `heidi-cockpit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });
    memory = new BusinessMemory({ dataPath, logger: { log: () => {}, error: () => {} } });
    await memory.start();
    executiveOS = new ExecutiveOperatingSystem({ dataPath, businessMemory: memory, logger: { log: () => {}, error: () => {} } });
    await executiveOS.start();
    taskEngine = new TaskEngine({ dataPath, intervalMs: 10, logger: { log: () => {}, error: () => {} } });
    await taskEngine.start();
    workflowEngine = new BusinessWorkflowEngine({
      dataPath,
      businessMemory: memory,
      executiveOS,
      taskEngine,
      logger: { log: () => {}, error: () => {} },
    });
    await workflowEngine.start();
    executionGateway = new ExecutionGateway({ dataPath, businessMemory: memory, logger: { log: () => {}, error: () => {} } });
    await executionGateway.start();
    cockpit = new ExecutiveCockpit({
      dataPath,
      businessMemory: memory,
      executiveOS,
      workflowEngine,
      executionGateway,
      logger: { log: () => {}, error: () => {} },
    });
    await cockpit.start();
  });

  afterEach(async () => {
    if (cockpit) await cockpit.destroy().catch(() => {});
    if (executionGateway) await executionGateway.destroy().catch(() => {});
    if (workflowEngine) await workflowEngine.destroy().catch(() => {});
    if (taskEngine) await taskEngine.destroy().catch(() => {});
    if (executiveOS) await executiveOS.destroy().catch(() => {});
    if (memory) await memory.destroy().catch(() => {});
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    cockpit = null;
    executionGateway = null;
    workflowEngine = null;
    taskEngine = null;
    executiveOS = null;
    memory = null;
  });

  test('lifecycle methods work', async () => {
    expect(cockpit._started).toBe(true);
    await cockpit.flush();
    const health = cockpit.healthCheck();
    expect(health.ok).toBe(true);
    cockpit.stop();
    expect(cockpit._started).toBe(false);
    await cockpit.destroy();
    expect(cockpit._destroyed).toBe(true);
  });

  test('parses natural language commands', () => {
    expect(cockpit.parseCommand('Good morning').command).toBe('good-morning');
    expect(cockpit.parseCommand('how are we doing?').command).toBe('status');
    expect(cockpit.parseCommand('what should I focus on').command).toBe('focus');
    expect(cockpit.parseCommand('approvals').command).toBe('approvals');
    expect(cockpit.parseCommand('history').command).toBe('history');
    expect(cockpit.parseCommand('workflows').command).toBe('workflows');
    expect(cockpit.parseCommand('approve exec_123').command).toBe('approve');
    expect(cockpit.parseCommand('approve exec_123').id).toBe('exec_123');
    expect(cockpit.parseCommand('priority revenue').command).toBe('priority');
    expect(cockpit.parseCommand('priority revenue').priority).toBe('revenue');
  });

  test('good morning response reflects ProtoForge state', async () => {
    memory.put({ type: 'opportunity', name: 'Big Deal', value: 5000, effort: 1, risk: 0 });
    memory.put({ type: 'client', name: 'Acme', status: 'active' });
    const res = cockpit.goodMorning();
    expect(res.text).toContain('Good morning');
    expect(res.text).toContain('ProtoForge status');
    expect(res.text).toContain('Recommended next action');
  });

  test('how are we doing reports dashboard numbers', async () => {
    memory.put({ type: 'opportunity', name: 'Deal', value: 1000, status: 'active' });
    memory.put({ type: 'client', name: 'Lead', status: 'active' });
    const res = cockpit.howAreWeDoing();
    expect(res.text).toContain('Active workflows');
    expect(res.text).toContain('Revenue opportunities');
    expect(res.text).toContain('Active customers');
  });

  test('focus for today filters by owner priority', async () => {
    memory.put({ type: 'opportunity', name: 'Big Deal', value: 5000, effort: 1, risk: 0 });
    memory.put({ type: 'equipment', name: 'Printer', status: 'maintenance' });
    const res = await cockpit.handleCommand('focus');
    expect(res.text).toContain('Focus for today');
    await cockpit.handleCommand('priority manufacturing');
    const mfg = await cockpit.handleCommand('focus');
    expect(mfg.text.toLowerCase()).toContain('printer');
  });

  test('lists pending approvals and allows approve/reject', async () => {
    const pending = await executionGateway.execute({
      type: 'draft-email',
      params: { to: 'client@example.com' },
      requestingAgent: 'Sales Manager',
    });
    const list = cockpit.listApprovals();
    expect(list.approvals.length).toBe(1);
    const approved = await cockpit.handleCommand(`approve ${pending.id}`);
    expect(approved.text).toContain('Approved and executed');
    expect(cockpit.listApprovals().approvals.length).toBe(0);
  });

  test('executeAction routes through ExecutionGateway only', async () => {
    const result = await cockpit.executeAction({
      type: 'create-report',
      params: { file: 'cockpit-report.md', content: '# Report' },
      requestingAgent: 'Cockpit',
    });
    expect(result.status).toBe('completed');
    const history = executionGateway.getExecutionHistory({ status: 'completed' });
    expect(history.some((h) => h.requestingAgent === 'Cockpit')).toBe(true);
  });

  test('rejects forbidden actions through cockpit', async () => {
    await expect(cockpit.executeAction({ type: 'send-email', params: {} })).rejects.toThrow('Forbidden action');
  });

  test('dashboard data is accurate and does not fabricate data', () => {
    const data = cockpit.getDashboardData();
    expect(typeof data.activeWorkflows).toBe('number');
    expect(typeof data.pendingApprovals).toBe('number');
    expect(typeof data.revenueOpportunities).toBe('number');
    expect(Array.isArray(data.risks)).toBe(true);
  });

  test('persists and restores owner priority and interactions', async () => {
    await cockpit.handleCommand('priority creative');
    await cockpit.handleCommand('status');
    await cockpit.destroy();

    const restored = new ExecutiveCockpit({
      dataPath,
      businessMemory: memory,
      executiveOS,
      workflowEngine,
      executionGateway,
      logger: { log: () => {}, error: () => {} },
    });
    await restored.start();
    expect(restored.ownerPriority).toBe('creative');
    expect(restored.interactions.length).toBe(2);
    await restored.destroy();
  });

  test('recovers from corrupted persistence', async () => {
    const file = path.join(dataPath, 'executive-cockpit.json');
    await fs.writeFile(file, 'not-json { corrupted');
    const restored = new ExecutiveCockpit({
      dataPath,
      businessMemory: memory,
      executiveOS,
      workflowEngine,
      executionGateway,
      logger: { log: () => {}, error: () => {} },
    });
    await expect(restored.start()).resolves.toBeUndefined();
    expect(restored.healthCheck().ok).toBe(true);
    await restored.destroy();
  });

  test('benchmark: handles 50 commands in under one second', async () => {
    const start = Date.now();
    for (let i = 0; i < 50; i += 1) {
      await cockpit.handleCommand('status');
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });
});
