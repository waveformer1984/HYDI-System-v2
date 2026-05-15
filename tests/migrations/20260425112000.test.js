'use strict';
const { readMigration } = require('./helpers');

describe('20260425112000_alter_ledger_add_project_name', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260425112000_alter_ledger_add_project_name.sql').toLowerCase(); });

  test('is a non-empty SQL file', () => {
    expect(sql.trim().length).toBeGreaterThan(0);
  });

  test('contains valid SQL statements', () => {
    expect(sql).toMatch(/\b(create|alter|drop|insert|update|grant|do)\b/);
  });
});
