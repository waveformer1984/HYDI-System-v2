'use strict';
const { readMigration } = require('./helpers');

describe('20260516000001_create_replay_history', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260516000001_create_replay_history.sql').toLowerCase(); });

  test('creates replay_history table', () => {
    expect(sql).toContain('create table');
    expect(sql).toContain('replay_history');
  });

  test('has event_id text column', () => {
    expect(sql).toContain('event_id');
    expect(sql).toContain('text');
  });

  test('has drift_detected boolean column', () => {
    expect(sql).toContain('drift_detected');
    expect(sql).toContain('boolean');
  });

  test('has drift_fields and output jsonb columns', () => {
    expect(sql).toContain('drift_fields');
    expect(sql).toContain('original_output');
    expect(sql).toContain('replay_output');
    expect(sql).toContain('jsonb');
  });

  test('has replayed_at and created_at timestamptz columns', () => {
    expect(sql).toContain('replayed_at');
    expect(sql).toContain('created_at');
    expect(sql).toContain('timestamptz');
  });

  test('indexes by event_id for fast lookup', () => {
    expect(sql).toContain('replay_history_event_id_idx');
  });

  test('partial index on drift_detected = true', () => {
    expect(sql).toContain('replay_history_drift_idx');
    expect(sql).toContain('drift_detected = true');
  });

  test('indexes replayed_at descending for recent-first queries', () => {
    expect(sql).toContain('replay_history_replayed_at_idx');
    expect(sql).toContain('replayed_at desc');
  });
});
