'use strict';
const { readMigration } = require('./helpers');

describe('20260426122000_action_worker_cron_schedule', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260426122000_action_worker_cron_schedule.sql').toLowerCase(); });

  test('is a non-empty SQL file', () => {
    expect(sql.trim().length).toBeGreaterThan(0);
  });

  test('contains valid SQL statements', () => {
    expect(sql).toMatch(/\b(create|alter|drop|insert|update|grant|do|select)\b/);
  });
});
