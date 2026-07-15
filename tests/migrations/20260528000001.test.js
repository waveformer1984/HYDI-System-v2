'use strict';
const { readMigration } = require('./helpers');

describe('20260528000001_enable_rls_unprotected_tables', () => {
  let sql;
  beforeAll(() => {
    sql = readMigration('20260528000001_enable_rls_unprotected_tables.sql').toLowerCase();
  });

  test('enables RLS on conversation_threads', () => {
    expect(sql).toContain('conversation_threads');
    expect(sql).toContain('enable row level security');
  });

  test('enables RLS on rule_sets', () => {
    expect(sql).toContain('rule_sets');
  });

  test('enables RLS on compensation_events', () => {
    expect(sql).toContain('compensation_events');
  });

  test('enables RLS on drift_log', () => {
    expect(sql).toContain('drift_log');
  });

  test('creates service_role_all policies', () => {
    expect(sql).toContain('create policy');
    expect(sql).toContain('service_role_all');
  });

  test('uses using (true) with check (true) pattern', () => {
    expect(sql).toContain('using (true)');
    expect(sql).toContain('with check (true)');
  });
});
