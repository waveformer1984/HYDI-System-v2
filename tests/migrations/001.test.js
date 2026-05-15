'use strict';
const { readMigration } = require('./helpers');

describe('001_keymaker_core', () => {
  let sql;
  beforeAll(() => { sql = readMigration('001_keymaker_core.sql').toLowerCase(); });

  const tables = [
    'keymaker_services', 'keymaker_keys', 'keymaker_access_log',
    'keymaker_system_state', 'keymaker_events', 'keymaker_jobs', 'keymaker_config',
  ];
  test.each(tables)('creates table %s', (t) => {
    expect(sql).toContain('create table');
    expect(sql).toContain(t);
  });

  test('keymaker_keys has unique key_hash column', () => {
    expect(sql).toContain('key_hash');
    expect(sql).toContain('unique');
  });

  test('keymaker_keys has break_glass column', () => {
    expect(sql).toContain('break_glass');
  });

  test('keymaker_system_state has singleton seed row', () => {
    expect(sql).toContain('insert into keymaker_system_state');
  });

  test('keymaker_config is pre-seeded', () => {
    expect(sql).toContain('automation_enabled');
    expect(sql).toContain('emergency_mode');
  });

  test('RLS is enabled on all 7 tables', () => {
    const count = (sql.match(/enable row level security/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(7);
  });

  test('indexes exist on keymaker_keys', () => {
    expect(sql).toContain('idx_keymaker_keys_user');
    expect(sql).toContain('idx_keymaker_keys_expires');
  });
});
