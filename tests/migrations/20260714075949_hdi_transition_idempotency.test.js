'use strict';
const { readMigration } = require('./helpers');

describe('20260714075949_hdi_transition_idempotency', () => {
  let sql;
  beforeAll(() => {
    sql = readMigration('20260714075949_hdi_transition_idempotency.sql').toLowerCase();
  });

  test('recreates hydi_transition with idempotency check before phase match', () => {
    expect(sql).toContain('create or replace function hydi_transition');
    expect(sql).toContain('returns jsonb');
    // idempotency lookup should happen before the phase mismatch check
    const idempotencyIndex = sql.indexOf('idempotency_key = p_idempotency_key');
    const phaseMismatchIndex = sql.indexOf('phase mismatch');
    expect(idempotencyIndex).toBeGreaterThan(0);
    expect(phaseMismatchIndex).toBeGreaterThan(0);
    expect(idempotencyIndex).toBeLessThan(phaseMismatchIndex);
  });
});
