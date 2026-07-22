'use strict';
const { readMigration } = require('./helpers');

describe('20260724000001_event_bus_events_projection_marker', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260724000001_event_bus_events_projection_marker.sql').toLowerCase(); });

  test('adds projected_at column to event_bus_events', () => {
    expect(sql).toContain('alter table public.event_bus_events');
    expect(sql).toContain('projected_at');
    expect(sql).toContain('timestamptz');
  });

  test('creates a partial index on projected_at is null', () => {
    expect(sql).toContain('create index if not exists idx_event_bus_events_projected_at');
    expect(sql).toContain('projected_at is null');
  });
});
