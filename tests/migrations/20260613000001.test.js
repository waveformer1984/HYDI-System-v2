'use strict';
const { readMigration } = require('./helpers');

describe('20260613000001_scope_rls_policies_to_service_role', () => {
  let sql;
  beforeAll(() => {
    sql = readMigration('20260613000001_scope_rls_policies_to_service_role.sql').toLowerCase();
  });

  const tables = [
    'conversation_threads',
    'rule_sets',
    'compensation_events',
    'drift_log',
  ];

  test.each(tables)('drops and recreates the service_role_all policy on %s scoped to service_role', (table) => {
    expect(sql).toContain('drop policy if exists "service_role_all" on public.' + table);
    expect(sql).toContain('create policy "service_role_all" on public.' + table);
  });

  test('every recreated policy is restricted to the service_role', () => {
    const policyCount = (sql.match(/create policy "service_role_all"/g) || []).length;
    const forAllToServiceRoleCount = (sql.match(/for all to service_role/g) || []).length;
    expect(policyCount).toBe(4);
    expect(forAllToServiceRoleCount).toBe(4);
  });

  test('preserves the using true with check true pattern', () => {
    const pattern = 'using (true) with check (true)';
    expect(sql).toContain(pattern);
  });
});
