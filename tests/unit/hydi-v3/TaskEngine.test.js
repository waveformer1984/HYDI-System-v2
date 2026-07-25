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
    const a = engine.enqueue({ name: 'a', handler: async () => { throw new Error('boom'); }, maxRetries: 0 });
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

  test('regression: crash recovery restores interrupted running tasks and unblocks dependents', async () => {
    const order = [];
    const a = engine.enqueue({
      name: 'a',
      handler: async () => { order.push('a'); },
      maxRetries: 0,
    });
    const b = engine.enqueue({
      name: 'b',
      dependencies: [a],
      handler: async () => { order.push('b'); },
      maxRetries: 0,
    });

    // Simulate the engine beginning task A and then crashing before it completes.
    const taskA = engine.getTask(a);
    taskA.status = 'running';
    taskA.startedAt = Date.now();
    taskA.engineSessionId = 'old-session';
    await engine._flush();

    // Brand-new process instance loads the same persisted state.
    const recovered = new TaskEngine({
      dataPath,
      intervalMs: 100,
      logger: { log: () => {}, error: () => {} },
    });
    await recovered.start();

    // Handlers are in-memory and must be re-registered after restart.
    recovered.getTask(a).handler = async () => { order.push('a'); };
    recovered.getTask(b).handler = async () => { order.push('b'); };

    // The previously-running task must not stay running; it must recover and
    // eventually allow its dependent to execute.
    await recovered.processReadyTasks();
    await recovered.processReadyTasks();

    expect(recovered.getTask(a).status).not.toBe('running');
    expect(recovered.getTask(a).interruptionCount).toBeGreaterThanOrEqual(1);
    expect(order).toEqual(['a', 'b']);
    await recovered.destroy();
  });

  test('retries transient failures with configurable policy', async () => {
    const attempts = [];
    const a = engine.enqueue({
      name: 'a',
      handler: async () => { attempts.push(attempts.length); if (attempts.length < 3) throw new Error('transient'); return 'ok'; },
      maxRetries: 3,
      retryDelay: 0,
      backoffMultiplier: 1,
    });
    await engine.processReadyTasks();
    expect(engine.getTask(a).status).toBe('completed');
    expect(engine.getTask(a).retryCount).toBe(2);
    expect(attempts.length).toBe(3);
  });

  test('permanently fails after exhausting retries', async () => {
    const a = engine.enqueue({ name: 'a', handler: async () => { throw new Error('always'); }, maxRetries: 2, retryDelay: 0, backoffMultiplier: 1 });
    const b = engine.enqueue({ name: 'b', dependencies: [a], handler: async () => 'b' });
    await engine.processReadyTasks();
    await engine.processReadyTasks();
    await engine.processReadyTasks();
    expect(engine.getTask(a).status).toBe('failed');
    expect(engine.getTask(b).status).toBe('blocked');
    expect(engine.getTask(a).retryCount).toBe(2);
  });

  test('cancelling a task blocks dependents', () => {
    const a = engine.enqueue({ name: 'a', handler: async () => 'ok' });
    const b = engine.enqueue({ name: 'b', dependencies: [a], handler: async () => 'b' });
    engine.cancel(a);
    expect(engine.getTask(a).status).toBe('cancelled');
    expect(engine.getTask(b).status).toBe('blocked');
  });

  test('health report exposes recovery, retry queue, and active workers', async () => {
    const a = engine.enqueue({ name: 'a', handler: async () => { throw new Error('boom'); }, maxRetries: 2, retryDelay: 10000 });
    engine.enqueue({ name: 'b', handler: async () => 'b', maxRetries: 0 });
    await engine.processReadyTasks();
    engine.enqueue({ name: 'c', handler: async () => 'c', maxRetries: 0 });
    const report = engine.getHealthReport();
    expect(report.engineSessionId).toBeTruthy();
    expect(report.retryQueue.some((t) => t.id === a)).toBe(true);
    expect(report.queuedTasks).toBeGreaterThanOrEqual(1);
    expect(report.totalTasks).toBe(3);
  });

  test('recovers from corrupted persistence', async () => {
    const file = path.join(dataPath, 'task-engine.json');
    await fs.writeFile(file, 'not-json { corrupted');
    const recovered = new TaskEngine({ dataPath, intervalMs: 100, logger: { log: () => {}, error: () => {} } });
    await expect(recovered.start()).resolves.toBeUndefined();
    expect(recovered.getStatus().total).toBe(0);
    expect(recovered._recoveredCount).toBe(0);
    const corruptFiles = (await fs.readdir(dataPath)).filter((f) => f.includes('corrupt'));
    expect(corruptFiles.length).toBeGreaterThan(0);
    await recovered.destroy();
  });

  test('crash simulation: recover 500 interrupted running tasks without deadlock', async () => {
    const localData = path.join(dataPath, 'crash-sim');
    await fs.mkdir(localData, { recursive: true });
    const order = [];
    const crash = new TaskEngine({ dataPath: localData, intervalMs: 100, maxRetries: 0, logger: { log: () => {}, error: () => {} } });
    await crash.start();

    for (let i = 0; i < 500; i += 1) {
      crash.enqueue({
        id: `crash-a-${i}`,
        name: `a-${i}`,
        handler: async () => { order.push(`a-${i}`); },
        maxRetries: 1,
        retryDelay: 0,
      });
      crash.enqueue({
        id: `crash-b-${i}`,
        name: `b-${i}`,
        dependencies: [`crash-a-${i}`],
        handler: async () => { order.push(`b-${i}`); },
        maxRetries: 0,
      });
      const taskA = crash.getTask(`crash-a-${i}`);
      taskA.status = 'running';
      taskA.startedAt = Date.now();
      taskA.engineSessionId = 'crash-session';
    }
    await crash._flush();
    crash.stop();

    // Final restart and recovery: re-register handlers and process all tasks.
    const final = new TaskEngine({ dataPath: localData, intervalMs: 100, maxRetries: 1, retryDelay: 0, logger: { log: () => {}, error: () => {} } });
    await final.start();
    for (let i = 0; i < 500; i += 1) {
      const a = final.getTask(`crash-a-${i}`);
      const b = final.getTask(`crash-b-${i}`);
      if (a) a.handler = async () => { order.push(`a-${i}`); };
      if (b) b.handler = async () => { order.push(`b-${i}`); };
    }
    while (final.getStatus().completed < 1000 && final.getStatus().failed === 0) {
      // eslint-disable-next-line no-await-in-loop
      await final.processReadyTasks();
    }

    expect(final._recoveredCount).toBe(500);
    expect(final.getStatus().running).toBe(0);
    expect(final.getStatus().completed).toBe(1000);
    expect(final.getStatus().blocked).toBe(0);
    expect(order.length).toBe(1000);
    await final.destroy();
  }, 120000);

  test('benchmark: processes 50 independent tasks in under one second', async () => {
    const start = Date.now();
    for (let i = 0; i < 50; i += 1) {
      engine.enqueue({ name: `task-${i}`, handler: async () => i, maxRetries: 0 });
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
