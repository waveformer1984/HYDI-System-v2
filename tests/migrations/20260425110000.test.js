'use strict';
const { readMigration } = require('./helpers');

describe('20260425110000_create_payouts_table', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260425110000_create_payouts_table.sql').toLowerCase(); });

  test('creates payouts table', () => {
    expect(sql).toContain('create table');
    expect(sql).toContain('payouts');
  });

  test('has payout_id UUID primary key', () => {
    expect(sql).toContain('payout_id');
    expect(sql).toContain('primary key');
  });

  test('references clients with cascade delete', () => {
    expect(sql).toContain('references clients');
    expect(sql).toContain('on delete cascade');
  });

  test('has gross_earnings and net_payout_amount', () => {
    expect(sql).toContain('gross_earnings');
    expect(sql).toContain('net_payout_amount');
  });

  test('status check covers all payout states', () => {
    expect(sql).toContain('pending');
    expect(sql).toContain('scheduled');
    expect(sql).toContain('completed');
    expect(sql).toContain('failed');
  });

  test('has stripe_transfer_id column', () => {
    expect(sql).toContain('stripe_transfer_id');
  });
});
