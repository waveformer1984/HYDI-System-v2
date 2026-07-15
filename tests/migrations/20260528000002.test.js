'use strict';
const { readMigration } = require('./helpers');

describe('20260528000002_policies_table', () => {
  let sql;
  beforeAll(() => {
    sql = readMigration('20260528000002_policies_table.sql').toLowerCase();
  });

  // ── Table structure ───────────────────────────────────────────────────────

  test('creates policies table', () => {
    expect(sql).toContain('create table');
    expect(sql).toContain('public.policies');
  });

  test('has uuid primary key with gen_random_uuid()', () => {
    expect(sql).toContain('uuid primary key');
    expect(sql).toContain('gen_random_uuid()');
  });

  test('has version int not null', () => {
    expect(sql).toContain('version');
    expect(sql).toContain('int not null');
  });

  test('has nullable stream column for per-stream scoping', () => {
    expect(sql).toContain('stream');
    // stream must be nullable (null = global baseline)
    expect(sql).not.toMatch(/stream\s+text\s+not null/);
  });

  test('has jsonb rules column', () => {
    expect(sql).toContain('rules');
    expect(sql).toContain('jsonb not null');
  });

  test('has is_active boolean defaulting to false', () => {
    expect(sql).toContain('is_active');
    expect(sql).toContain('boolean not null default false');
  });

  test('has activation window columns', () => {
    expect(sql).toContain('active_from');
    expect(sql).toContain('active_to');
  });

  test('has created_at and updated_at timestamps', () => {
    expect(sql).toContain('created_at');
    expect(sql).toContain('updated_at');
  });

  // ── Uniqueness / integrity ────────────────────────────────────────────────

  test('enforces stream + version uniqueness', () => {
    expect(sql).toContain('unique');
    expect(sql).toContain('stream');
    expect(sql).toContain('version');
  });

  test('enforces at most one active policy per stream', () => {
    expect(sql).toContain('idx_policies_one_active_per_stream');
    expect(sql).toContain('where is_active = true');
  });

  // ── Indexes ───────────────────────────────────────────────────────────────

  test('has index on stream + is_active for hot-path lookup', () => {
    expect(sql).toContain('idx_policies_stream_active');
  });

  test('has index on activation window', () => {
    expect(sql).toContain('idx_policies_active_window');
  });

  // ── Trigger ───────────────────────────────────────────────────────────────

  test('auto-updates updated_at via trigger', () => {
    expect(sql).toContain('before update on public.policies');
    expect(sql).toContain('policies_set_updated_at');
  });

  // ── RLS ───────────────────────────────────────────────────────────────────

  test('RLS is enabled', () => {
    expect(sql).toContain('enable row level security');
  });

  test('authenticated role can select active policies', () => {
    expect(sql).toContain('policies_select_active');
    expect(sql).toContain('to authenticated');
  });

  test('service role has full write access', () => {
    expect(sql).toContain('policies_service_all');
    expect(sql).toContain('to service_role');
  });

  // ── Seed ─────────────────────────────────────────────────────────────────

  test('seeds baseline-v1 policy in inactive state', () => {
    expect(sql).toContain('baseline-v1');
    expect(sql).toContain('false  -- promote explicitly');
  });

  test('baseline seed rules contain approve, escalate, and default reject', () => {
    expect(sql).toContain('"approve"');
    expect(sql).toContain('"escalate"');
    expect(sql).toContain('"reject"');
  });
});
