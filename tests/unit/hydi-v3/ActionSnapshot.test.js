'use strict';

const ActionSnapshot = require('../../../src/hydi-v3/ActionSnapshot');

describe('ActionSnapshot', () => {
  test('captures a memory subset', () => {
    const memory = {
      find: () => [{ id: '1', type: 'opportunity', name: 'A', status: 'active', value: 100 }],
    };
    const snap = ActionSnapshot.capture(memory, { tags: ['resonate'] });
    expect(snap.count).toBe(1);
    expect(snap.entities[0].id).toBe('1');
  });

  test('diff detects added, removed, and modified entities', () => {
    const before = { count: 2, entities: [{ id: '1', status: 'active' }, { id: '2', status: 'active' }] };
    const after = { count: 2, entities: [{ id: '1', status: 'completed' }, { id: '3', status: 'active' }] };
    const d = ActionSnapshot.diff(before, after);
    expect(d.changed).toBe(true);
    expect(d.modified.length).toBe(1);
    expect(d.added.length).toBe(1);
    expect(d.removed.length).toBe(1);
  });

  test('diff returns changed false when snapshots match', () => {
    const s = { count: 1, entities: [{ id: '1', status: 'active' }] };
    expect(ActionSnapshot.diff(s, s).changed).toBe(false);
  });
});
