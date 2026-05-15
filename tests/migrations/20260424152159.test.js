'use strict';
const { readMigration } = require('./helpers');

describe('20260424152159_hydi_update_webhook_events', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260424152159_hydi_update_webhook_events.sql').toLowerCase(); });

  test('is a non-empty SQL file', () => {
    expect(sql.trim().length).toBeGreaterThan(0);
  });

  test('contains valid SQL statements', () => {
    expect(sql).toMatch(/\b(create|alter|drop|insert|update|grant|do)\b/);
  });
});
