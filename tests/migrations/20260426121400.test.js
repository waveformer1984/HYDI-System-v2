'use strict';
const { readMigration } = require('./helpers');

describe('20260426121400_fix_rls_policies', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260426121400_fix_rls_policies.sql').toLowerCase(); });

  test('is a non-empty SQL file', () => {
    expect(sql.trim().length).toBeGreaterThan(0);
  });

  test('contains RLS or policy statements', () => {
    expect(sql).toMatch(/\b(policy|row level security|grant|revoke)\b/);
  });
});
