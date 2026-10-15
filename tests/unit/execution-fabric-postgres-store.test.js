'use strict';

const { PostgresTaskStore } = require('../../lib/execution-fabric/task-store-postgres');
const { createExecutionFabricPgMock } = require('../helpers/execution-fabric-pg-mock');

describe('execution-fabric postgres store (mock integration)', () => {
  let mock;
  let store;

  beforeEach(() => {
    mock = createExecutionFabricPgMock();
    store = new PostgresTaskStore({
      supabase: mock,
      now: () => 10_000,
      createId: () => 'aaaaaaaaaaaaaaaaaaaaaaaa',
    });
  });

  it('persists and reloads tasks', async () => {
    const { task, created } = await store.createTask({
      capability_id: 'health.check',
      role: 'operator',
      idempotency_key: 'pg-1',
    });
    expect(created).toBe(true);
    const loaded = await store.get(task.id);
    expect(loaded.capability_id).toBe('health.check');
  });

  it('returns duplicate on idempotent create', async () => {
    await store.createTask({ capability_id: 'health.check', role: 'operator', idempotency_key: 'idem' });
    const second = await store.createTask({ capability_id: 'health.check', role: 'operator', idempotency_key: 'idem' });
    expect(second.created).toBe(false);
  });

  it('enforces valid transitions in postgres adapter', async () => {
    const { task } = await store.createTask({ capability_id: 'health.check', role: 'operator' });
    expect((await store.transition(task.id, 'PLANNING')).ok).toBe(true);
    expect((await store.transition(task.id, 'COMPLETED')).ok).toBe(false);
  });
});
