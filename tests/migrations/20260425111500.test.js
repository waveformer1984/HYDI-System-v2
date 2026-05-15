'use strict';
const { readMigration } = require('./helpers');

describe('20260425111500_create_process_payout_function', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260425111500_create_process_payout_function.sql').toLowerCase(); });

  test('creates process_payout function', () => {
    expect(sql).toContain('process_payout');
    expect(sql).toContain('create or replace function');
  });

  test('accepts p_payout_id uuid parameter', () => {
    expect(sql).toContain('p_payout_id');
    expect(sql).toContain('uuid');
  });

  test('raises exception for missing payout', () => {
    expect(sql).toContain('raise exception');
  });

  test('updates payouts to completed status', () => {
    expect(sql).toContain('completed');
    expect(sql).toContain('update payouts');
  });

  test('generates stripe_transfer_id', () => {
    expect(sql).toContain('stripe_transfer_id');
  });
});
