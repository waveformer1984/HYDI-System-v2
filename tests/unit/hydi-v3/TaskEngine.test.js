'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const TaskEngine = require('../../../src/hydi-v3/TaskEngine');

describe('TaskEngine', () => {
  let engine;
  let dataPath;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `heidi-task-engine-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });
    engine = new TaskEngine({ dataPath, intervalMs: 100, maxConcurrency: 2, logger: { log: () => {}, error: () => {} } });
  });

  afterEach(async () => {
    if (engine) {
      engine.stop();
      await engine.destroy().catch(() => {});
    }
    try {
      await fs.rm(dataPath, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
    engine = null;
  });

  test('starts and stops cleanly and idempotently', async () => {
    await engine.start();
    expect(engine._started).toBe(true);
    await engine.start();
    expect(engine._timer).not.toBeNull();
    engine.stop();
    expect(engine._timer).toBeNull();
    engine.stop();
    // no throw
  });

  test('destroys and flushes pending writes', async () => {
    engine.enqueue({ name: 'persist', handler: async () => 'ok' });
    await engine.destroy();
    expect(engine._destroyed).toBe(true);
    const file = path.join(dataPath, 'task-engine.json');
    const content = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(content);
    expect(parsed.tasks.length).toBe(1);
    expect(parsed.tasks[0].status).toBe('ready');
  });

  test('executes a simple task and stores result', async () => {
    const handler = jest.fn(async () => 'done');
    engine.enqueue({ name: 'one', handler });
    await engine.processReadyTasks();
    const task = engine.tasks[0];
    expect(task.status).toBe('completed');
    expect(task.result).toBe('done');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('executes tasks in priority order', async () => {
    const order = [];
    engine.enqueue({ name: 'low', priority: 'low', handler: async () => { order.push('low'); } });
    engine.enqueue({ name: 'high', priority: 'high', handler: async () => { order.push('high'); } });
    engine.enqueue({ name: 'critical', priority: 'critical', handler: async () => { order.push('critical'); } });
    await engine.processReadyTasks();
    expect(order).toEqual(['critical', 'high', 'low']);
  });

  test('executes dependent tasks after dependencies complete', async () => {
    const order = [];
    const a = engine.enqueue({ name: 'a', handler: async () => { order.push('a'); } });
    engine.enqueue({ name: 'b', dependencies: [a], handler: async () => { order.push('b'); } });
    await engine.processReadyTasks();
    await engine.processReadyTasks();
    expect(order).toEqual(['a', 'b']);
    expect(engine.getTask(a).status).toBe('completed');
    expect(engine.getTask(engine.tasks[1].id).status).toBe('completed');
  });

  test('blocks dependents when a task fails', async () => {
    const a = engine.enqueue({ name: 'a', handler: async () => { throw new Error('boom'); } });
    const b = engine.enqueue({ name: 'b', dependencies: [a], handler: async () => 'b' });
    await engine.processReadyTasks();
    expect(engine.getTask(a).status).toBe('failed');
    expect(engine.getTask(b).status).toBe('blocked');
  });

  test('rollback runs compensation and blocks dependents', async () => {
    const compensation = jest.fn(async () => {});
    const a = engine.enqueue({ name: 'a', handler: async () => 'ok', compensation });
    const b = engine.enqueue({ name: 'b', dependencies: [a], handler: async () => 'b' });
    await engine._runTask(engine.getTask(a));
    expect(engine.getTask(b).status).toBe('ready');
    await engine.rollback(a);
    expect(compensation).toHaveBeenCalledTimes(1);
    expect(engine.getTask(a).status).toBe('rolledback');
    expect(engine.getTask(b).status).toBe('blocked');
  });

  test('resumes persisted state across engine instances', async () => {
    const a = engine.enqueue({ name: 'a', handler: async () => 'ok' });
    await engine._flush();

    const restored = new TaskEngine({ dataPath, intervalMs: 100, logger: { log: () => {}, error: () => {} } });
    await restored.start();
    expect(restored.getTask(a)).toBeTruthy();
    expect(restored.getTask(a).status).toBe('ready');
    await restored.destroy();
  });

  test('getStatus reflects task states', () => {
    engine.enqueue({ name: 'a', handler: async () => 'ok' });
    engine.enqueue({ name: 'b', handler: async () => { throw new Error('x'); } });
    engine.enqueue({ name: 'c', priority: 'high', handler: async () => 'c' });
    const status = engine.getStatus();
    expect(status.total).toBe(3);
    expect(status.ready).toBe(3);
  });

  test('does not leak active timers after destroy', async () => {
    await engine.start();
    engine.enqueue({ name: 'a', handler: async () => 'ok' });
    await engine.destroy();
    expect(engine._timer).toBeNull();
    expect(engine._persistTimer).toBeNull();
  });

  test('benchmark: processes 50 independent tasks in under one second', async () => {
    const start = Date.now();
    for (let i = 0; i < 50; i += 1) {
      engine.enqueue({ name: `task-${i}`, handler: async () => i });
    }
    while (engine.getStatus().completed < 50 && engine.getStatus().failed === 0) {
      // eslint-disable-next-line no-await-in-loop
      await engine.processReadyTasks();
    }
    const elapsed = Date.now() - start;
    expect(engine.getStatus().completed).toBe(50);
    expect(elapsed).toBeLessThan(1000);
  });
});
