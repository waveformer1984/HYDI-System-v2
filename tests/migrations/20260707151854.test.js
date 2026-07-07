'use strict';
const { readMigration } = require('./helpers');

describe('20260707151854_local_baseline_missing_core_objects', () => {
  let sql;
  beforeAll(() => {
    sql = readMigration('20260707151854_local_baseline_missing_core_objects.sql').toLowerCase();
  });

  test('enables pgvector', () => {
    expect(sql).toContain('create extension if not exists vector');
  });

  test('creates the heidi memory layer tables', () => {
    for (const t of ['public.memories', 'public.actions', 'public.sessions']) {
      expect(sql).toContain(`create table if not exists ${t}`);
    }
    expect(sql).toContain('embedding vector(1536)');
  });

  test('creates search_memories with PostgREST-compatible parameter names', () => {
    expect(sql).toContain('function public.search_memories');
    expect(sql).toContain('query_embedding vector(1536)');
    expect(sql).toContain('match_count int');
    // parameter must be qualified in the body to avoid 42P13/ambiguity
    expect(sql).toContain('search_memories.user_id');
  });

  test('creates the revenue pipeline tables', () => {
    for (const t of ['public.leads', 'public.outreach', 'public.proposals', 'public.quotes',
      'public.checkout_sessions', 'public.product_ideas', 'public.product_listings', 'public.task_queue']) {
      expect(sql).toContain(`create table if not exists ${t}`);
    }
  });

  test('creates the worker queue with the status state machine', () => {
    expect(sql).toContain('create table if not exists public.worker_jobs');
    expect(sql).toContain('create table if not exists public.worker_failures');
    expect(sql).toContain("'queued','processing','done','failed','dead'");
  });

  test('adds code-compatible columns to event_bus_events', () => {
    for (const c of ['topic', 'event_name', 'source_worker', 'correlation_id', 'occurred_at']) {
      expect(sql).toContain(`add column if not exists ${c}`);
    }
  });

  test('creates health functions and the system_dashboard view', () => {
    expect(sql).toContain('create table if not exists public.system_health_runs');
    expect(sql).toContain('function public.analyze_health_trends');
    expect(sql).toContain('function public.evaluate_system_escalation');
    expect(sql).toContain('function public.auto_heal_from_trends');
    expect(sql).toContain('function public.retry_failed_jobs');
    expect(sql).toContain('function public.flag_dead_jobs');
    expect(sql).toContain('create or replace view public.system_dashboard');
  });

  test('system_dashboard exposes every column api/health.js reads', () => {
    for (const col of ['current_status', 'last_check', 'trend_status', 'trend_reason',
      'critical_pct', 'warning_pct', 'avg_queue_size', 'escalation_level',
      'escalation_action', 'escalation_reason', 'jobs_queued', 'jobs_failed',
      'jobs_dead', 'events_last_hour', 'auto_heals_24h']) {
      expect(sql).toContain(`as ${col}`);
    }
  });

  test('enables RLS on every new table', () => {
    for (const t of ['memories', 'actions', 'sessions', 'leads', 'outreach', 'proposals',
      'quotes', 'checkout_sessions', 'product_ideas', 'product_listings', 'task_queue',
      'worker_jobs', 'worker_failures', 'system_health_runs']) {
      expect(sql).toContain(`alter table public.${t}`);
    }
    const rlsCount = (sql.match(/enable row level security/g) || []).length;
    expect(rlsCount).toBeGreaterThanOrEqual(14);
  });

  test('functions pin search_path (SECURITY DEFINER hygiene)', () => {
    const definerCount = (sql.match(/security definer/g) || []).length;
    const searchPathCount = (sql.match(/set search_path = pg_catalog, public, extensions/g) || []).length;
    expect(searchPathCount).toBeGreaterThanOrEqual(definerCount);
  });

  test('does not schedule pg_cron jobs (operational concern, not schema)', () => {
    expect(sql).not.toContain('cron.schedule');
  });
});
