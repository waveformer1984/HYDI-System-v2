const SharedMemoryStore = require('../../../src/hydi-v3/SharedMemoryStore');

describe('SharedMemoryStore', () => {
  test('stores and retrieves values per namespace', () => {
    const store = new SharedMemoryStore({ nodeId: 'a' });
    store.set('sessions', 'user-1', { name: 'Alice' });
    expect(store.get('sessions', 'user-1').name).toBe('Alice');
  });

  test('applies causally later values and ignores stale ones', () => {
    const store = new SharedMemoryStore({ nodeId: 'a' });
    store.set('sessions', 'k1', 'first', { vector: { a: 1 } });
    const later = store.set('sessions', 'k1', 'second', { vector: { a: 2 } });
    expect(later.applied).toBe(true);
    expect(store.get('sessions', 'k1')).toBe('second');
    const stale = store.set('sessions', 'k1', 'old', { vector: { a: 1 } });
    expect(stale.applied).toBe(false);
  });

  test('detects concurrent writes and resolves deterministically', () => {
    const store = new SharedMemoryStore({ nodeId: 'a' });
    store.set('sessions', 'k1', 'a-value', { vector: { a: 1, b: 0 } });
    const conflicts = [];
    store.on('conflict_detected', (c) => conflicts.push(c));
    const resolved = store.set('sessions', 'k1', 'b-value', { vector: { a: 0, b: 1 }, ts: Date.now() + 1, nodeId: 'b' });
    expect(resolved.conflict).toBe(true);
    expect(conflicts.length).toBe(1);
    expect(store.getConflicts('sessions').length).toBe(1);
  });

  test('append policy merges arrays without data loss', () => {
    const store = new SharedMemoryStore({ nodeId: 'a' });
    store.set('facts', 'log', ['entry-1'], { vector: { a: 1 } });
    const result = store.applyDelta({ namespace: 'facts', key: 'log', value: ['entry-2'], vector: { a: 1, b: 1 }, nodeId: 'b', ts: Date.now() });
    expect(result.applied).toBe(true);
    expect(store.get('facts', 'log')).toEqual(['entry-1', 'entry-2']);
  });

  test('operator can resolve a conflict', () => {
    const store = new SharedMemoryStore({ nodeId: 'a' });
    store.set('sessions', 'k1', 'a', { vector: { a: 1 } });
    store.set('sessions', 'k1', 'b', { vector: { b: 1 } });
    store.resolveConflict('sessions', 'k1', 'chosen');
    expect(store.get('sessions', 'k1')).toBe('chosen');
  });
});
