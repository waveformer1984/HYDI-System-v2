'use strict';
const { readMigration } = require('./helpers');

describe('20260425110500_alter_ledger_table', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260425110500_alter_ledger_table.sql').toLowerCase(); });

  test('drops source_account column', () => {
    expect(sql).toContain('drop column');
    expect(sql).toContain('source_account');
  });

  test('adds stripe_customer_id column', () => {
    expect(sql).toContain('add column');
    expect(sql).toContain('stripe_customer_id');
  });

  test('creates index on stripe_customer_id', () => {
    expect(sql).toContain('idx_ledger_stripe_customer');
  });
});
