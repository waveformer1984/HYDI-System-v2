'use strict';
const { readMigration } = require('./helpers');

describe('20260617000004_push_subscriptions', () => {
  let sql;
  beforeAll(() => {
    sql = readMigration('20260617000004_push_subscriptions.sql').toLowerCase();
  });

  test('creates push_subscriptions idempotently', () => {
    expect(sql).toContain('create table if not exists public.push_subscriptions');
  });

  const columns = ['device_id', 'endpoint', 'p256dh', 'auth', 'device_name', 'active', 'created_at', 'updated_at'];
  test.each(columns)('defines column %s', (col) => {
    expect(sql).toContain(col);
  });

  test('enforces a unique endpoint', () => {
    expect(sql).toMatch(/endpoint\s+text\s+not\s+null\s+unique/);
  });

  test('creates the active and device_id indexes', () => {
    expect(sql).toContain('idx_push_active');
    expect(sql).toContain('idx_push_device_id');
  });

  test('enables RLS scoped to service_role', () => {
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('create policy "service_role_all" on public.push_subscriptions');
    expect(sql).toContain('for all to service_role');
  });
});
