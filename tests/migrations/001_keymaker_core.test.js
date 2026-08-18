'use strict';
const { readMigration } = require('./helpers');

describe('20260101000000_keymaker_core', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260101000000_keymaker_core.sql').toLowerCase(); });

  test('creates keymaker_services table', () => {
    expect(sql).toContain('create table');
    expect(sql).toContain('keymaker_services');
  });

  test('creates keymaker_keys table', () => {
    expect(sql).toContain('keymaker_keys');
  });

  test('creates keymaker_access_log table', () => {
    expect(sql).toContain('keymaker_access_log');
  });

  test('creates keymaker_system_state table', () => {
    expect(sql).toContain('keymaker_system_state');
  });

  test('creates keymaker_events table', () => {
    expect(sql).toContain('keymaker_events');
  });

  test('creates keymaker_jobs table', () => {
    expect(sql).toContain('keymaker_jobs');
  });

  test('creates keymaker_config table', () => {
    expect(sql).toContain('keymaker_config');
  });

  test('indexes keys by user_id and expires_at', () => {
    expect(sql).toContain('idx_keymaker_keys_user');
    expect(sql).toContain('idx_keymaker_keys_expires');
  });

  test('indexes access_log by user, service and timestamp', () => {
    expect(sql).toContain('idx_access_log_user');
    expect(sql).toContain('idx_access_log_service');
    expect(sql).toContain('idx_access_log_timestamp');
  });

  test('enables RLS on all core tables', () => {
    expect(sql).toContain('enable row level security');
  });
});
