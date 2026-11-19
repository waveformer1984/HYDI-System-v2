'use strict';

const { SpecialistPool, LlmSemaphore } = require('../../lib/dev-workforce/pool');
const { MemoryTaskStore } = require('../../lib/execution-fabric/task-store-memory');
const { ExecutionGateway } = require('../../lib/execution-fabric/gateway');
const { setPoolPaused } = require('../../lib/dev-workforce/pool-control');
const { assertNotCloneForbidden } = require('../../lib/dev-workforce/templates');

const defaultPlan = async () => [
  {
    template: 'scout',
    title: 't',
    args: { url: 'https://example.com/x' },
    acceptance_criteria: 'ok',
    subtask_id: 's-default',
  },
];

function makePool(overrides = {}) {
  const store = new MemoryTaskStore();
  const gateway = new ExecutionGateway({
    store,
    skipRecovery: true,
    executeSync: async (req) => {
      const { runPoolCapability } = require('../../lib/dev-workforce/pool-actions');
      const action = req.action;
      const args = req.args;
      const ctx = req.ctx || {};
      const result = await runPoolCapability(action, args, {
        ...ctx,
        role: req.role,
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          arrayBuffer: async () => Buffer.from('<html>ok</html>'),
          headers: { get: () => 'text/html' },
        }),
      });
      return { ...result, ok: result.ok !== false, action };
    },
  });
  return new SpecialistPool({
    store,
    gateway,
    planFn: overrides.planFn || defaultPlan,
    now: overrides.now,
    root: overrides.root,
  });
}

describe('specialist pool', () => {
  it('requeues stale lease and allows reclaim', async () => {
    const store = new MemoryTaskStore();
    let now = Date.now();
    store.now = () => now;
    const pool = makePool({ now: () => now });
    pool.store = store;
    const enq = await pool.enqueueMission({
      text: 'test',
      id: 'm1',
    });
    expect(enq.subtasks).toBeGreaterThan(0);
    const queued = await store.listQueuedPoolSubtasks();
    const t = queued[0];
    await store.claimLease(t.id, 'clone-a', 50);
    await store.transition(t.id, 'RUNNING');
    now += 60_000;
    await pool.requeueStaleLeases();
    const again = await store.get(t.id);
    expect(again.state).toBe('QUEUED');
  });

  it('respects LLM semaphore', async () => {
    const sem = new LlmSemaphore(1);
    const r1 = await sem.acquire();
    let second;
    const p = sem.acquire().then((r) => {
      second = r;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(sem.snapshot().in_use).toBe(1);
    r1();
    await p;
    second();
    expect(sem.snapshot().in_use).toBe(0);
  });

  it('does not double-process same subtask id under concurrent clones', async () => {
    const subId = `fixed-${Date.now()}`;
    const pool = makePool({
      planFn: async () => [
        {
          template: 'scout',
          title: 'one',
          args: { url: 'https://example.com/a' },
          acceptance_criteria: 'ok',
          subtask_id: subId,
        },
      ],
    });
    await pool.enqueueMission({ id: `dup-${subId}`, text: 'x' });
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => pool.runCloneOnce(String(i), 'scout')),
    );
    expect(pool.processed.has(subId)).toBe(true);
    const ran = results.filter((r) => r.task_id);
    expect(ran.length).toBeLessThanOrEqual(2);
  });

  it('pause stops new claims', async () => {
    const root = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pool-pause-'));
    const pool = makePool({
      planFn: async () => [
        {
          template: 'scout',
          title: 'fetch',
          args: { url: 'https://example.com/pause' },
          subtask_id: 'pause-1',
        },
      ],
      root,
    });
    const prev = process.env.POOL_PAUSED;
    delete process.env.POOL_PAUSED;
    await pool.enqueueMission({ id: 'paused-m', text: 'y' });
    setPoolPaused(true, root);
    const task = await pool.claimNextSubtask('c1');
    expect(task).toBeNull();
    setPoolPaused(false, root);
    const task2 = await pool.claimNextSubtask('c1');
    expect(task2).toBeTruthy();
    if (prev !== undefined) process.env.POOL_PAUSED = prev;
    else delete process.env.POOL_PAUSED;
  });

  it('blocks clone forbidden capabilities', () => {
    expect(assertNotCloneForbidden('pool.spawn_clone').ok).toBe(false);
    const pool = makePool();
    expect(pool.canSpawnMissionFromClone('pool.mission_enqueue').ok).toBe(false); // eslint-disable-line no-confusing-arrow
  });
});