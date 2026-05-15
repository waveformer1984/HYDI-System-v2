'use strict';
const { readMigration } = require('./helpers');

describe('20260426121100_tool_executor_rpc_functions', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260426121100_tool_executor_rpc_functions.sql').toLowerCase(); });

  test('is a non-empty SQL file', () => {
    expect(sql.trim().length).toBeGreaterThan(0);
  });

  test('creates RPC functions', () => {
    expect(sql).toContain('create or replace function');
  });
});
