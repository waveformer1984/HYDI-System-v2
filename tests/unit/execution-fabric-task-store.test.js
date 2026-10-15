'use strict';

const { MemoryTaskStore } = require('../../lib/execution-fabric/task-store-memory');

describe('execution-fabric task-store', () => {
  it('rejects invalid lifecycle transitions', async () => {
    const store = new MemoryTaskStore({ now: () => 1, randomBytes: () => Buffer.alloc(12, 1) });
    const { task: t } = await store.createTask({ capability_id: 'health.check', adapter: 'sync' });
    expect((await store.transition(t.id, 'PLANNING')).ok).toBe(true);
    expect((await store.transition(t.id, 'COMPLETED')).ok).toBe(false);
  });

  it('deduplicates by idempotency key', async () => {
    const store = new MemoryTaskStore({ now: () => 1000, randomBytes: () => Buffer.alloc(12, 2) });
    const { task: a } = await store.createTask({ capability_id: 'x', idempotency_key: 'key-1' });
    const b = await store.findByIdempotency('key-1');
    expect(b.id).toBe(a.id);
  });

  it('survives simulated process restart via snapshot', async () => {
    const store = new MemoryTaskStore({ now: () => 2000, randomBytes: () => Buffer.alloc(12, 4) });
    const { task } = await store.createTask({ capability_id: 'health.check', idempotency_key: 'restart-key' });
    await store.transition(task.id, 'PLANNING', { reason: 'test' });
    const snap = store.exportSnapshot();
    const store2 = MemoryTaskStore.importSnapshot(snap, { now: () => 3000, randomBytes: () => Buffer.alloc(12, 4) });
    const loaded = await store2.get(task.id);
    expect(loaded.state).toBe('PLANNING');
    expect(await store2.findByIdempotency('restart-key')).not.toBeNull();
  });

  it('claims lease exclusively', async () => {
    const store = new MemoryTaskStore({ now: () => 5000, randomBytes: () => Buffer.alloc(12, 5) });
    const { task } = await store.createTask({ capability_id: 'health.check' });
    expect((await store.claimLease(task.id, 'worker-a')).ok).toBe(true);
    expect((await store.claimLease(task.id, 'worker-b')).ok).toBe(false);
  });
});
