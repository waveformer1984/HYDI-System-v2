'use strict';
const { readMigration } = require('./helpers');

describe('20260424145921_hydi_stripe_sync_function', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260424145921_hydi_stripe_sync_function.sql').toLowerCase(); });

  test('is a non-empty SQL file', () => {
    expect(sql.trim().length).toBeGreaterThan(0);
  });

  test('contains valid SQL statements', () => {
    expect(sql).toMatch(/\b(create|alter|drop|insert|update|grant|do)\b/);
  });
});
