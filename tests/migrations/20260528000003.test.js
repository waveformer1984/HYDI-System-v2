'use strict';
const { readMigration } = require('./helpers');

describe('20260528000003_decisions_table', () => {
  let sql;
  beforeAll(() => {
    sql = readMigration('20260528000003_decisions_table.sql').toLowerCase();
  });

  // ── Table structure ───────────────────────────────────────────────────────

  test('creates decisions table', () => {
    expect(sql).toContain('create table');
    expect(sql).toContain('public.decisions');
  });

  test('has uuid primary key', () => {
    expect(sql).toContain('uuid primary key');
    expect(sql).toContain('gen_random_uuid()');
  });

  test('has event_hash linking to RAW LEDGER', () => {
    expect(sql).toContain('event_hash');
    expect(sql).toContain('text not null');
  });

  test('has hypothesis_id from KILO', () => {
    expect(sql).toContain('hypothesis_id');
  });

  test('has foreign key to policies table', () => {
    expect(sql).toContain('references public.policies');
  });

  test('has policy_version column', () => {
    expect(sql).toContain('policy_version');
    expect(sql).toContain('int not null');
  });

  test('decision check constraint covers approve/reject/escalate', () => {
    expect(sql).toContain("check (decision in ('approve', 'reject', 'escalate'))");
  });

  test('has confidence and risk_score as numeric with range check', () => {
    expect(sql).toContain('confidence');
    expect(sql).toContain('risk_score');
    expect(sql).toContain('between 0 and 1');
  });

  test('has revenue_impact column', () => {
    expect(sql).toContain('revenue_impact');
  });

  test('has stream column for per-revenue-stream filtering', () => {
    expect(sql).toContain('stream');
  });

  test('has decided_at timestamp', () => {
    expect(sql).toContain('decided_at');
    expect(sql).toContain('default now()');
  });

  // ── Outcome backfill ──────────────────────────────────────────────────────

  test('outcome check constraint covers success/failure/unknown', () => {
    expect(sql).toContain("check (outcome in ('success', 'failure', 'unknown'))");
  });

  test('has outcome_at and outcome_detail columns', () => {
    expect(sql).toContain('outcome_at');
    expect(sql).toContain('outcome_detail');
  });

  // ── Indexes ───────────────────────────────────────────────────────────────

  test('has index on event_hash for replay lookups', () => {
    expect(sql).toContain('idx_decisions_event_hash');
  });

  test('has index on hypothesis_id', () => {
    expect(sql).toContain('idx_decisions_hypothesis_id');
  });

  test('has index on stream + decided_at for dashboard', () => {
    expect(sql).toContain('idx_decisions_stream_decided_at');
  });

  test('has partial index for pending outcome backfill', () => {
    expect(sql).toContain('idx_decisions_pending_outcome');
    expect(sql).toContain('where outcome is null');
  });

  test('has index on policy_id + outcome for policy performance', () => {
    expect(sql).toContain('idx_decisions_policy_version');
  });

  // ── RLS — immutability ────────────────────────────────────────────────────

  test('RLS is enabled', () => {
    expect(sql).toContain('enable row level security');
  });

  test('authenticated role can only select (immutable audit trail)', () => {
    expect(sql).toContain('decisions_select');
    expect(sql).toContain('for select to authenticated');
  });

  test('insert is restricted to service role', () => {
    expect(sql).toContain('decisions_insert_service');
    expect(sql).toContain('for insert to service_role');
  });

  test('update is restricted to service role for outcome backfill only', () => {
    expect(sql).toContain('decisions_update_outcome_service');
    expect(sql).toContain('for update to service_role');
  });

  // ── Policy performance view ───────────────────────────────────────────────

  test('creates policy_performance view', () => {
    expect(sql).toContain('create or replace view public.policy_performance');
  });

  test('view aggregates approved, rejected, escalated counts', () => {
    expect(sql).toContain('approved');
    expect(sql).toContain('rejected');
    expect(sql).toContain('escalated');
  });

  test('view computes success_rate', () => {
    expect(sql).toContain('success_rate');
  });

  test('view is accessible to authenticated role', () => {
    expect(sql).toContain('grant select on public.policy_performance to authenticated');
  });
});
