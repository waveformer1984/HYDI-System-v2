'use strict';

const { MemoryTaskStore } = require('../../lib/execution-fabric/task-store-memory');
const { recoverInterruptedTasks } = require('../../lib/execution-fabric/recovery');

describe('execution-fabric recovery', () => {
  it('blocks unsafe replay for non-idempotent sync tasks', async () => {
    const store = new MemoryTaskStore({ now: () => 1000, randomBytes: () => Buffer.alloc(12, 8) });
    const { task } = await store.createTask({ capability_id: 'tests.run', role: 'operator' });
    await store.transition(task.id, 'PLANNING');
    await store.transition(task.id, 'RUNNING');
    await store.claimLease(task.id, 'worker', 1);
    const rec = await recoverInterruptedTasks(store, { now: () => 5000 });
    expect(rec.recovered).toBeGreaterThan(0);
    const updated = await store.get(task.id);
    expect(updated.state).toBe('FAILED');
    expect(updated.failure_class).toBe('unsafe_replay');
  });

  it('marks idempotent tasks as RECOVERING', async () => {
    const store = new MemoryTaskStore({ now: () => 1000, randomBytes: () => Buffer.alloc(12, 9) });
    const { task } = await store.createTask({ capability_id: 'health.check', role: 'operator' });
    await store.transition(task.id, 'PLANNING');
    await store.transition(task.id, 'RUNNING');
    await store.claimLease(task.id, 'worker', 1);
    await recoverInterruptedTasks(store, { now: () => 5000 });
    const updated = await store.get(task.id);
    expect(updated.state).toBe('RECOVERING');
  });
});
