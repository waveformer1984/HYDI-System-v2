'use strict';
const { readMigration } = require('./helpers');

describe('20260426123000_chat_operator_notification_integration', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260426123000_chat_operator_notification_integration.sql').toLowerCase(); });

  test('is a non-empty SQL file', () => {
    expect(sql.trim().length).toBeGreaterThan(0);
  });

  test('contains valid SQL statements', () => {
    expect(sql).toMatch(/\b(create|alter|drop|insert|update|grant|do)\b/);
  });
});
