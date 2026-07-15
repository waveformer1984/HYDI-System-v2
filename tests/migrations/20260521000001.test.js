'use strict';
const { readMigration } = require('./helpers');

describe('20260521000001_fix_hydi_events_event_id_default', () => {
  let sql;
  beforeAll(() => {
    sql = readMigration('20260521000001_fix_hydi_events_event_id_default.sql').toLowerCase();
  });

  test('sets a default of gen_random_uuid() on event_id', () => {
    expect(sql).toContain('alter table hydi_events');
    expect(sql).toContain('alter column event_id set default gen_random_uuid()');
  });

  test('backfills existing null event_id rows', () => {
    expect(sql).toContain('update hydi_events');
    expect(sql).toContain('set event_id = gen_random_uuid()');
    expect(sql).toContain('where event_id is null');
  });

  test('enforces not null on event_id after backfill', () => {
    expect(sql).toContain('alter column event_id set not null');
  });

  test('normalises unknown type rows to event_type', () => {
    expect(sql).toContain("set type = event_type");
    expect(sql).toContain("type is null or type = 'unknown'");
  });
});
