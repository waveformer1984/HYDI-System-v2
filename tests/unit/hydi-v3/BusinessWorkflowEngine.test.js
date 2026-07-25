'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const BusinessMemory = require('../../../src/hydi-v3/BusinessMemory');
const ExecutiveOperatingSystem = require('../../../src/hydi-v3/ExecutiveOperatingSystem');
const TaskEngine = require('../../../src/hydi-v3/TaskEngine');
const { BusinessWorkflowEngine } = require('../../../src/hydi-v3/BusinessWorkflowEngine');

describe('BusinessWorkflowEngine', () => {
  let engine;
  let memory;
  let executiveOS;
  let taskEngine;
  let dataPath;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `heidi-bwe-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });
    memory = new BusinessMemory({ dataPath, logger: { log: () => {}, error: () => {} } });
    await memory.start();
    executiveOS = new ExecutiveOperatingSystem({ dataPath, businessMemory: memory, logger: { log: () => {}, error: () => {} } });
    await executiveOS.start();
    taskEngine = new TaskEngine({ dataPath, intervalMs: 10, logger: { log: () => {}, error: () => {} } });
    await taskEngine.start();
    engine = new BusinessWorkflowEngine({
      dataPath,
      businessMemory: memory,
      executiveOS,
      taskEngine,
      logger: { log: () => {}, error: () => {} },
      stepHandlers: {
        'data-collection': async () => 'requirements captured',
        'document-preparation': async () => 'document prepared',
      },
    });
    await engine.start();
  });

  afterEach(async () => {
    if (engine) await engine.destroy().catch(() => {});
    if (taskEngine) await taskEngine.destroy().catch(() => {});
    if (executiveOS) await executiveOS.destroy().catch(() => {});
    if (memory) await memory.destroy().catch(() => {});
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    engine = null;
    taskEngine = null;
    executiveOS = null;
    memory = null;
  });

  test('lifecycle methods work', async () => {
    expect(engine._started).toBe(true);
    await engine.flush();
    const health = engine.healthCheck();
    expect(health.ok).toBe(true);
    engine.stop();
    expect(engine._started).toBe(false);
    await engine.destroy();
    expect(engine._destroyed).toBe(true);
  });

  test('creates workflow with typed steps', () => {
    const id = engine.createWorkflow({ type: 'sales', title: 'Quote', expectedValue: 1000 });
    const wf = engine.getWorkflow(id);
    expect(wf.type).toBe('sales');
    expect(wf.steps.length).toBeGreaterThan(0);
    expect(wf.status).toBe('draft');
    expect(engine.getStatus().total).toBe(1);
  });

  test('rejects unknown workflow types', () => {
    const id = engine.createWorkflow({ type: 'mystery', title: 'X' });
    expect(engine.getWorkflow(id).type).toBe('sales');
  });

  test('requires approval for high-value sales before execution', async () => {
    const id = engine.createWorkflow({ type: 'sales', title: 'Big Deal', expectedValue: 10000 });
    await expect(engine.startWorkflow(id)).rejects.toThrow('requires approval');
    expect(engine.getWorkflow(id).status).toBe('awaiting-approval');
    engine.approveWorkflow(id);
    engine.startWorkflow(id);
    await new Promise((r) => setTimeout(r, 150));
    expect(engine.getWorkflow(id).status).toBe('completed');
  });

  test('auto-approves research workflows', async () => {
    const id = engine.createWorkflow({ type: 'research', title: 'Experiment' });
    await engine.startWorkflow(id);
    await new Promise((r) => setTimeout(r, 150));
    expect(engine.getWorkflow(id).status).toBe('completed');
  });

  test('converts recommendations into workflows', () => {
    const rec = { action: 'Prepare quote', reason: 'Customer asked', expectedImpact: 'Revenue $500' };
    const id = engine.createWorkflowFromRecommendation(rec);
    const wf = engine.getWorkflow(id);
    expect(wf.title).toBe('Prepare quote');
    expect(wf.type).toBe('sales');
    expect(wf.expectedValue).toBe(500);
  });

  test('getPreparedActions surfaces top next actions', () => {
    engine.createWorkflow({ type: 'sales', title: 'A', expectedValue: 100, urgency: 0.9 });
    engine.createWorkflow({ type: 'sales', title: 'B', expectedValue: 1000, urgency: 0.5 });
    const actions = engine.getPreparedActions(2);
    expect(actions[0].title).toBe('B');
    expect(actions[1].title).toBe('A');
  });

  test('records outcomes and creates lesson entity', async () => {
    const id = engine.createWorkflow({ type: 'sales', title: 'Deal', expectedValue: 500, requiredEffort: 1 });
    engine.approveWorkflow(id);
    await engine.startWorkflow(id);
    await new Promise((r) => setTimeout(r, 150));
    const outcome = await engine.recordOutcome(id, 700);
    expect(outcome.actual).toBe(700);
    expect(outcome.delta).toBe(200);
    const lessons = memory.find({ tags: ['lesson'] });
    expect(lessons.length).toBeGreaterThan(0);
  });

  test('persists and restores workflows across instances', async () => {
    const id = engine.createWorkflow({ type: 'research', title: 'Persist' });
    await engine.startWorkflow(id);
    await new Promise((r) => setTimeout(r, 150));
    await engine.destroy();

    const taskEngine2 = new TaskEngine({ dataPath, intervalMs: 10, logger: { log: () => {}, error: () => {} } });
    await taskEngine2.start();
    const restored = new BusinessWorkflowEngine({
      dataPath,
      businessMemory: memory,
      executiveOS,
      taskEngine: taskEngine2,
      logger: { log: () => {}, error: () => {} },
    });
    await restored.start();
    expect(restored.getWorkflow(id).title).toBe('Persist');
    await restored.destroy();
    await taskEngine2.destroy();
  });

  test('recovers from corrupted persistence', async () => {
    const file = path.join(dataPath, 'business-workflows.json');
    await fs.writeFile(file, 'not-json { corrupted');
    const restored = new BusinessWorkflowEngine({
      dataPath,
      businessMemory: memory,
      logger: { log: () => {}, error: () => {} },
    });
    await expect(restored.start()).resolves.toBeUndefined();
    expect(restored.healthCheck().ok).toBe(true);
    await restored.destroy();
  });

  test('custom step handlers execute and fail workflows correctly', async () => {
    const failing = new BusinessWorkflowEngine({
      dataPath,
      businessMemory: memory,
      logger: { log: () => {}, error: () => {} },
      stepHandlers: {
        'data-collection': async () => { throw new Error('bad data'); },
      },
    });
    await failing.start();
    const id = failing.createWorkflow({ type: 'sales', title: 'Fail', expectedValue: 50 });
    await expect(failing.startWorkflow(id)).rejects.toThrow('bad data');
    expect(failing.getWorkflow(id).status).toBe('failed');
    await failing.destroy();
  });

  test('benchmark: creates 100 workflows in under one second', () => {
    const start = Date.now();
    for (let i = 0; i < 100; i += 1) {
      engine.createWorkflow({ type: 'sales', title: `W-${i}`, expectedValue: i });
    }
    const elapsed = Date.now() - start;
    expect(engine.getStatus().total).toBe(100);
    expect(elapsed).toBeLessThan(1000);
  });
});
