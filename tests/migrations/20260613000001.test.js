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

  test('iterates over exactly the four affected tables', () => {
    const arrayMatch = sql.match(/foreach t in array array\[([^\]]+)\]/);
    expect(arrayMatch).not.toBeNull();
    tables.forEach((table) => {
      expect(arrayMatch[1]).toContain(`'${table}'`);
    });
  });

  test('guards each table with to_regclass before touching its policy', () => {
    expect(sql).toContain("if to_regclass('public.' || t) is not null then");
  });

  test('drops and recreates the service_role_all policy via a dynamic format() template', () => {
    expect(sql).toContain('drop policy if exists "service_role_all" on public.%i');
    expect(sql).toContain('create policy "service_role_all" on public.%i');
  });

  test('every recreated policy is restricted to the service_role', () => {
    expect(sql).toContain('for all to service_role');
    // Exactly one dynamic template for each statement — the four tables are
    // covered by looping over this one CREATE, not four separate copies.
    const createTemplateCount = (sql.match(/create policy "service_role_all" on public\.%i/g) || []).length;
    expect(createTemplateCount).toBe(1);
  });

  test('preserves the using true with check true pattern', () => {
    const pattern = 'using (true) with check (true)';
    expect(sql).toContain(pattern);
  });
});
