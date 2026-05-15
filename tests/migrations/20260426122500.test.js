'use strict';
const { readMigration } = require('./helpers');

describe('20260426122500_notifications_table', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260426122500_notifications_table.sql').toLowerCase(); });

  test('creates notifications table', () => {
    expect(sql).toContain('create table');
    expect(sql).toContain('notifications');
  });

  test('channel check restricts to sms and email', () => {
    expect(sql).toContain('channel');
    expect(sql).toContain("'sms'");
    expect(sql).toContain("'email'");
  });

  test('status check covers pending/sent/delivered/failed', () => {
    expect(sql).toContain("'pending'");
    expect(sql).toContain("'sent'");
    expect(sql).toContain("'delivered'");
    expect(sql).toContain("'failed'");
  });

  test('creates get_notification_stats function', () => {
    expect(sql).toContain('get_notification_stats');
  });

  test('enables RLS', () => {
    expect(sql).toContain('enable row level security');
  });
});
