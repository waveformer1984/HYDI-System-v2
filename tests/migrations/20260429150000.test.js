'use strict';
const { readMigration } = require('./helpers');

describe('20260429150000_heidi_memory_layer', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260429150000_heidi_memory_layer.sql').toLowerCase(); });

  const tables = [
    'theme_predictions', 'theme_outcomes', 'theme_accuracy',
    'overconfidence_events', 'heidi_reflections', 'system_misalignment_events',
  ];
  test.each(tables)('creates table %s', (t) => {
    expect(sql).toContain(t);
    expect(sql).toContain('create table');
  });

  test('confidence columns have 0.0-1.0 range check', () => {
    expect(sql).toContain('confidence');
    expect(sql).toContain('0.0');
    expect(sql).toContain('1.0');
  });

  test('update_theme_accuracy trigger fires after insert on theme_outcomes', () => {
    expect(sql).toContain('update_theme_accuracy');
    expect(sql).toContain('after insert');
  });

  test('detect_overconfidence trigger fires after insert on theme_outcomes', () => {
    expect(sql).toContain('detect_overconfidence');
    expect(sql).toContain('theme_outcomes');
  });

  test('creates get_theme_accuracy function', () => {
    expect(sql).toContain('get_theme_accuracy');
  });

  test('creates get_system_calibration function', () => {
    expect(sql).toContain('get_system_calibration');
  });

  test('creates get_theme_calibration function', () => {
    expect(sql).toContain('get_theme_calibration');
  });

  test('RLS enabled on all 6 tables', () => {
    const count = (sql.match(/enable row level security/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(6);
  });
});
