'use strict';

const { TaskStore } = require('../../lib/execution-fabric/task-store');

describe('execution-fabric task-store', () => {
  it('rejects invalid lifecycle transitions', () => {
    const store = new TaskStore({ now: () => 1, randomBytes: () => Buffer.alloc(12, 1) });
    const t = store.createTask({ capability_id: 'health.check', adapter: 'sync' });
    expect(store.transition(t.id, 'PLANNING').ok).toBe(true);
    expect(store.transition(t.id, 'COMPLETED').ok).toBe(false);
  });

  it('deduplicates by idempotency key', () => {
    const store = new TaskStore({ now: () => 1000, randomBytes: () => Buffer.alloc(12, 2) });
    const a = store.createTask({ capability_id: 'x', idempotency_key: 'key-1' });
    const b = store.findByIdempotency('key-1');
    expect(b.id).toBe(a.id);
  });
});
