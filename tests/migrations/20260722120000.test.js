'use strict';
const { readMigration } = require('./helpers');

describe('20260722120000_realtime_mobile_ops_bridge', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260722120000_realtime_mobile_ops_bridge.sql').toLowerCase(); });

  test('is a non-empty SQL file', () => {
    expect(sql.trim().length).toBeGreaterThan(0);
  });

  test('contains valid SQL statements', () => {
    expect(sql).toMatch(/\b(create|alter|drop|insert|update|grant|do|select)\b/);
  });

  test('adds agent_control_commands and notifications to the realtime publication', () => {
    expect(sql).toMatch(/alter publication supabase_realtime add table public\.agent_control_commands/);
    expect(sql).toMatch(/alter publication supabase_realtime add table public\.notifications/);
  });

  test('guards each add table with an idempotency check against pg_publication_tables', () => {
    const guards = sql.match(/pg_publication_tables/g) || [];
    expect(guards.length).toBeGreaterThanOrEqual(2);
  });

  test('does not fail the whole migration if supabase_realtime does not exist', () => {
    expect(sql).toMatch(/exception when undefined_object/);
  });
});
