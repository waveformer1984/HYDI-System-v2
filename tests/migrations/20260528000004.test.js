'use strict';
const { readMigration } = require('./helpers');

describe('20260528000004_protoforge_calibration_worker', () => {
  let sql;
  beforeAll(() => {
    sql = readMigration('20260528000004_protoforge_calibration_worker.sql').toLowerCase();
  });

  // ── Function declaration ──────────────────────────────────────────────────

  test('creates calibrate_protoforge_decisions function', () => {
    expect(sql).toContain('create or replace function');
    expect(sql).toContain('calibrate_protoforge_decisions');
  });

  test('function is in public schema', () => {
    expect(sql).toContain('public.calibrate_protoforge_decisions');
  });

  test('function returns jsonb', () => {
    expect(sql).toContain('returns jsonb');
  });

  test('function is plpgsql with security definer', () => {
    expect(sql).toContain('language plpgsql');
    expect(sql).toContain('security definer');
  });

  // ── Parameters and defaults ───────────────────────────────────────────────

  test('has p_grace_minutes parameter with default 5', () => {
    expect(sql).toContain('p_grace_minutes');
    expect(sql).toMatch(/p_grace_minutes\s+int\s+default\s+5/);
  });

  test('has p_timeout_minutes parameter with default 60', () => {
    expect(sql).toContain('p_timeout_minutes');
    expect(sql).toMatch(/p_timeout_minutes\s+int\s+default\s+60/);
  });

  // ── Resolution path 1: action match ──────────────────────────────────────

  test('path 1 joins decisions to actions on hypothesis_id', () => {
    expect(sql).toContain("metadata->>'hypothesis_id'");
    expect(sql).toContain('public.actions');
  });

  test('path 1 maps completed action status to success outcome', () => {
    expect(sql).toContain("'completed'");
    expect(sql).toContain("'success'");
  });

  test('path 1 maps failed action status to failure outcome', () => {
    expect(sql).toContain("'failed'");
    expect(sql).toContain("'failure'");
  });

  test('path 1 only processes approved decisions', () => {
    expect(sql).toContain("decision    = 'approve'");
  });

  test('path 1 respects grace period cutoff', () => {
    expect(sql).toContain('v_cutoff_grace');
  });

  // ── Resolution path 2: timeout ────────────────────────────────────────────

  test('path 2 marks timed-out unresolved decisions as unknown', () => {
    expect(sql).toContain("'unknown'");
    expect(sql).toContain('v_cutoff_timeout');
  });

  test('path 2 only times out decisions with no matching action', () => {
    expect(sql).toContain('not exists');
  });

  test('path 2 records timeout_minutes in outcome_detail', () => {
    expect(sql).toContain("'timeout_minutes'");
    expect(sql).toContain("'timeout'");
  });

  // ── Return shape ──────────────────────────────────────────────────────────

  test('returns resolved_success count', () => {
    expect(sql).toContain("'resolved_success'");
  });

  test('returns resolved_failure count', () => {
    expect(sql).toContain("'resolved_failure'");
  });

  test('returns resolved_unknown count', () => {
    expect(sql).toContain("'resolved_unknown'");
  });

  test('returns skipped_in_grace count', () => {
    expect(sql).toContain("'skipped_in_grace'");
  });

  test('returns total_resolved count', () => {
    expect(sql).toContain("'total_resolved'");
  });

  test('returns calibrated_at timestamp', () => {
    expect(sql).toContain("'calibrated_at'");
  });

  // ── Permissions ───────────────────────────────────────────────────────────

  test('revokes execute from public (no anonymous calls)', () => {
    expect(sql).toContain('revoke all');
    expect(sql).toContain('from public');
  });

  test('grants execute to service_role only', () => {
    expect(sql).toContain('grant execute');
    expect(sql).toContain('to service_role');
  });

  // ── pg_cron schedule ──────────────────────────────────────────────────────

  test('registers pg_cron job named protoforge-calibration', () => {
    expect(sql).toContain("'protoforge-calibration'");
    expect(sql).toContain('cron.schedule');
  });

  test('pg_cron runs every 5 minutes', () => {
    expect(sql).toContain("'*/5 * * * *'");
  });

  test('pg_cron job is idempotent (unschedule before schedule)', () => {
    expect(sql).toContain('cron.unschedule');
  });

  test('pg_cron calls the calibration function', () => {
    expect(sql).toContain('select public.calibrate_protoforge_decisions');
  });
});
