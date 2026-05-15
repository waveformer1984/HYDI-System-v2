'use strict';
const { readMigration } = require('./helpers');

describe('20260425111000_create_generate_monthly_payouts_function', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260425111000_create_generate_monthly_payouts_function.sql').toLowerCase(); });

  test('creates generate_monthly_payouts function', () => {
    expect(sql).toContain('generate_monthly_payouts');
    expect(sql).toContain('create or replace function');
  });

  test('calculates period_start and period_end', () => {
    expect(sql).toContain('period_start');
    expect(sql).toContain('period_end');
  });

  test('inserts into payouts table', () => {
    expect(sql).toContain('insert into payouts');
  });

  test('queries ledger for fee aggregation', () => {
    expect(sql).toContain('from ledger');
  });
});
