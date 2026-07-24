'use strict';
const { readMigration } = require('./helpers');

describe('20260723000001_financial_ledger_rename', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260723000001_financial_ledger_rename.sql').toLowerCase(); });

  test('renames ledger table to financial_ledger', () => {
    expect(sql).toContain('rename to financial_ledger');
    expect(sql).toContain('public.financial_ledger');
  });

  test('creates a compatibility view named ledger', () => {
    expect(sql).toContain('create view public.ledger');
    expect(sql).toContain('security_invoker');
    expect(sql).toContain('from public.financial_ledger');
  });

  test('recreates ledger_reconciliation from financial_ledger', () => {
    expect(sql).toContain('create or replace view public.ledger_reconciliation');
    expect(sql).toContain('from public.financial_ledger');
  });

  test('recreates generate_monthly_payouts against financial_ledger', () => {
    expect(sql).toContain('create or replace function public.generate_monthly_payouts');
    expect(sql).toContain('public.financial_ledger');
  });
});
