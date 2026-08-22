'use strict';
const { readMigration } = require('./helpers');

describe('20260822150000_adaptive_operator_events', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260822150000_adaptive_operator_events.sql').toLowerCase(); });

  test('is a non-empty SQL file', () => {
    expect(sql.trim().length).toBeGreaterThan(0);
  });

  test('creates adaptive_operator_events table', () => {
    expect(sql).toMatch(/create table.*adaptive_operator_events/);
  });

  test('has goal_id and event_type columns', () => {
    expect(sql).toMatch(/goal_id\s+text\s+not\s+null/);
    expect(sql).toMatch(/event_type\s+text\s+not\s+null/);
  });

  test('has jsonb payload column', () => {
    expect(sql).toMatch(/payload\s+jsonb/);
  });

  test('enables row level security', () => {
    expect(sql).toMatch(/enable row level security/);
  });

  test('creates indexes on goal_id and event_type', () => {
    expect(sql).toMatch(/idx_ao_events_goal_id/);
    expect(sql).toMatch(/idx_ao_events_type/);
  });

  test('has service_role policy', () => {
    expect(sql).toMatch(/ao_events_service_all/);
    expect(sql).toMatch(/service_role/);
  });

  test('event_type has CHECK constraint with expected values', () => {
    expect(sql).toMatch(/observation/);
    expect(sql).toMatch(/replan/);
    expect(sql).toMatch(/escalation/);
    expect(sql).toMatch(/completion/);
  });
});
