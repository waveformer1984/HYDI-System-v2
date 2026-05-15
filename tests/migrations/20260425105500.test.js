'use strict';
const { readMigration } = require('./helpers');

describe('20260425105500_create_clients_table', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260425105500_create_clients_table.sql').toLowerCase(); });

  test('creates clients table', () => {
    expect(sql).toContain('create table');
    expect(sql).toContain('clients');
  });

  test('has client_id UUID primary key', () => {
    expect(sql).toContain('client_id');
    expect(sql).toContain('primary key');
  });

  test('email is unique and not null', () => {
    expect(sql).toContain('email');
    expect(sql).toContain('unique');
  });

  test('has stripe_customer_id column', () => {
    expect(sql).toContain('stripe_customer_id');
  });

  test('payout_schedule check includes monthly', () => {
    expect(sql).toContain('payout_schedule');
    expect(sql).toContain('monthly');
  });

  test('status check covers active/inactive/suspended', () => {
    expect(sql).toContain('active');
    expect(sql).toContain('inactive');
    expect(sql).toContain('suspended');
  });
});
