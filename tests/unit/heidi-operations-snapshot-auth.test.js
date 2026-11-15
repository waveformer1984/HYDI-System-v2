'use strict';

const { checkOperationsSnapshotAccess } = require('../../lib/heidi/operations-snapshot-auth');

describe('operations snapshot auth', () => {
  afterEach(() => {
    delete process.env.HEIDI_SECRET;
  });

  test('rejects missing secret even on loopback semantics', () => {
    process.env.HEIDI_SECRET = 'test-secret';
    const gate = checkOperationsSnapshotAccess({ headers: {}, ip: '127.0.0.1' });
    expect(gate.ok).toBe(false);
    expect(gate.status).toBe(403);
  });

  test('allows matching x-heidi-secret', () => {
    process.env.HEIDI_SECRET = 'test-secret';
    const gate = checkOperationsSnapshotAccess({
      headers: { 'x-heidi-secret': 'test-secret' },
      ip: '127.0.0.1',
    });
    expect(gate.ok).toBe(true);
  });

  test('503 when HEIDI_SECRET unset', () => {
    const gate = checkOperationsSnapshotAccess({ headers: { 'x-heidi-secret': 'x' } });
    expect(gate.status).toBe(503);
  });
});