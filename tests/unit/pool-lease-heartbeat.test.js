'use strict';

const { MemoryTaskStore } = require('../../lib/execution-fabric/task-store-memory');
const { ExecutionGateway } = require('../../lib/execution-fabric/gateway');
const { LEASE_STALE_MS, recoverInterruptedTasks, isPoolFabricTask } = require('../../lib/execution-fabric/recovery');
const { SpecialistPool } = require('../../lib/dev-workforce/pool');

const defaultPlan = async () => [
  {
    template: 'scout',
    title: 'long',
    args: { url: 'https://example.com/x' },
    acceptance_criteria: 'ok',
    subtask_id: 'hb-1',
  },
];

function makePool(overrides = {}) {
  let now = overrides.startNow ?? 1_000_000;
  const store = new MemoryTaskStore({ now: () => now, randomBytes: () => Buffer.alloc(12, 1) });
  store._advance = (ms) => {
    now += ms;
  };
  const gateway = new ExecutionGateway({
    store,
    skipRecovery: true,
    executeSync: overrides.executeSync || (async () => ({ ok: true, action: 'pool.http_fetch' })),
  });
  const pool = new SpecialistPool({
    store,
    gateway,
    planFn: defaultPlan,
    now: () => now,
    heartbeatMs: overrides.heartbeatMs,
  });
  return { pool, store, now: () => now };
}

describe('pool lease heartbeat', () => {
  it('web recovery ignores pool fabric tasks', async () => {
    const store = new MemoryTaskStore({ now: () => 1000, randomBytes: () => Buffer.alloc(12, 2) });
    const { task } = await store.createTask({
      capability_id: 'pool.http_fetch',
      role: 'agent',
      input: { pool_subtask: true, pool_mission_id: 'm1' },
    });
    expect(isPoolFabricTask(task)).toBe(true);
    await store.transition(task.id, 'PLANNING');
    await store.transition(task.id, 'RUNNING');
    await store.claimLease(task.id, 'clone:scout:0', 1);
    const rec = await recoverInterruptedTasks(store, { now: () => 50_000 });
    expect(rec.recovered).toBe(0);
    expect((await store.get(task.id)).state).toBe('RUNNING');
  });

  it('simulated heartbeats across 3× LEASE_STALE_MS block a second holder', async () => {
    const { pool, store } = makePool();
    await pool.enqueueMission({ id: 'hb-m', text: 'x' });
    const task = await pool.claimNextSubtask('clone:scout:0');
    expect(task).toBeTruthy();
    for (let i = 0; i < 9; i += 1) {
      const renew = await store.claimLease(task.id, 'clone:scout:0', LEASE_STALE_MS);
      expect(renew.ok).toBe(true);
      store._advance(10_000);
    }
    store._advance(5_000);
    const peer = await store.claimLease(task.id, 'clone:scout:1', LEASE_STALE_MS);
    expect(peer.ok).toBe(false);
    expect(peer.error).toBe('lease_held');
  });

  it('requeues when heartbeat stops (stale lease) and another clone can claim', async () => {
    const { pool, store } = makePool();
    await pool.enqueueMission({ id: 'stale-m', text: 'x' });
    const task = [...store.tasks.values()][0];
    await store.claimLease(task.id, 'clone:scout:dead', LEASE_STALE_MS);
    await store.transition(task.id, 'PLANNING');
    await store.transition(task.id, 'RUNNING');
    store._advance(LEASE_STALE_MS + 1_000);
    await pool.requeueStaleLeases();
    const t2 = await store.get(task.id);
    expect(t2.state).toBe('QUEUED');
    expect(t2.lease_holder).toBeNull();
    const claimed = await pool.claimNextSubtask('clone:scout:new');
    expect(claimed).toBeTruthy();
  });

  it('discards handler result when lease renewal fails', async () => {
    const { pool, store } = makePool({
      heartbeatMs: 5,
      executeSync: () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, action: 'pool.http_fetch' }), 40)),
    });
    const orig = store.claimLease.bind(store);
    let n = 0;
    store.claimLease = async (id, holder, ttl) => {
      n += 1;
      if (n >= 3 && holder.startsWith('clone:')) {
        return { ok: false, error: 'version_conflict' };
      }
      return orig(id, holder, ttl);
    };
    await pool.enqueueMission({ id: 'lost', text: 'x' });
    const r = await pool.runCloneOnce('0', 'scout');
    expect(r.discarded).toBe(true);
    expect(r.error).toBe('lease_lost');
    expect(pool.poolLog.some((e) => e.event === 'lease_renew_failed')).toBe(true);
    const task = [...store.tasks.values()].find((t) => t.input.pool_subtask_id === 'hb-1');
    const after = await store.get(task.id);
    expect(after.state).toBe('QUEUED');
    expect(after.outcome).toBeNull();
  });
});