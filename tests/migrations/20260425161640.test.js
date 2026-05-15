'use strict';
const { readMigration } = require('./helpers');

describe('20260425161640_add_stripe_connect_subaccount_support', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260425161640_add_stripe_connect_subaccount_support.sql').toLowerCase(); });

  test('drops and recreates ledger table', () => {
    expect(sql).toContain('drop table if exists ledger');
    expect(sql).toContain('create table ledger');
  });

  test('has revenue_stream and project_code columns', () => {
    expect(sql).toContain('revenue_stream');
    expect(sql).toContain('project_code');
  });

  test('has stripe_payment_intent_id column', () => {
    expect(sql).toContain('stripe_payment_intent_id');
  });

  test('fee columns are GENERATED ALWAYS AS STORED', () => {
    expect(sql).toContain('generated always as');
    expect(sql).toContain('platform_fee_amount');
    expect(sql).toContain('agent_fee_amount');
    expect(sql).toContain('stripe_fee_amount');
    expect(sql).toContain('net_amount');
  });

  test('has positive_amount check constraint', () => {
    expect(sql).toContain('positive_amount');
  });

  test('creates ledger_reconciliation view', () => {
    expect(sql).toContain('ledger_reconciliation');
  });

  test('enables RLS with service_role policy', () => {
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('service_role');
  });

  test('seeds a galactic_bytes test row', () => {
    expect(sql).toContain('insert into ledger');
    expect(sql).toContain('pi_test_galactic');
  });
});
