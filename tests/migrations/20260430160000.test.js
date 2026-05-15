'use strict';
const { readMigration } = require('./helpers');

describe('20260430160000_create_pending_tasks', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260430160000_create_pending_tasks.sql').toLowerCase(); });

  test('creates pending_tasks table', () => {
    expect(sql).toContain('create table');
    expect(sql).toContain('pending_tasks');
  });

  test('has message_id, origin, target, action columns', () => {
    expect(sql).toContain('message_id');
    expect(sql).toContain('origin');
    expect(sql).toContain('target');
    expect(sql).toContain('action');
  });

  test('has ttl and expires_at for task expiry', () => {
    expect(sql).toContain('ttl');
    expect(sql).toContain('expires_at');
  });

  test('status check covers all five states', () => {
    expect(sql).toContain("'pending'");
    expect(sql).toContain("'processing'");
    expect(sql).toContain("'completed'");
    expect(sql).toContain("'failed'");
    expect(sql).toContain("'expired'");
  });

  test('has attempts and max_attempts retry columns', () => {
    expect(sql).toContain('attempts');
    expect(sql).toContain('max_attempts');
  });

  test('RLS restricts to service_role only', () => {
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('service_role');
  });
});
