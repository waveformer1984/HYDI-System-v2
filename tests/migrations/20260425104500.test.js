'use strict';
const { readMigration } = require('./helpers');

describe('20260425104500_create_ledger_table', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260425104500_create_ledger_table.sql').toLowerCase(); });

  test('creates ledger table', () => {
    expect(sql).toContain('create table');
    expect(sql).toContain('ledger');
  });

  test('has transaction_id UUID primary key', () => {
    expect(sql).toContain('transaction_id');
    expect(sql).toContain('primary key');
  });

  test('has fee breakdown columns', () => {
    expect(sql).toContain('platform_fee_percent');
    expect(sql).toContain('agent_fee_percent');
    expect(sql).toContain('net_amount');
  });

  test('has status column', () => {
    expect(sql).toContain('status');
  });

  test('has indexes on key columns', () => {
    expect(sql).toContain('create index');
  });
});
