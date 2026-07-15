'use strict';

/**
 * Governance gate test for migration 20260715122000_hydi_subsystem_status.sql
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20260715122000_hydi_subsystem_status.sql';

describe('Migration 20260715122000 – HYDI Subsystem Status', () => {
  let sql;

  beforeAll(() => {
    sql = readMigration(MIGRATION_FILE);
  });

  it('file is non-empty', () => {
    expect(sql.trim().length).toBeGreaterThan(0);
  });

  it('creates hydi_subsystem_status keyed by subsystem, covering all eight tracked subsystems', () => {
    expect(sql).toMatch(/create table if not exists public\.hydi_subsystem_status/i);
    expect(sql).toMatch(/subsystem\s+text primary key/i);
    [
      'hydi_core', 'ursula', 'rave_voice', 'botforge',
      'worker_fleet', 'memory', 'database', 'deployment',
    ].forEach((s) => expect(sql).toMatch(new RegExp(`'${s}'`)));
  });

  it('constrains status to the five defined health states', () => {
    expect(sql).toMatch(
      /check \(status in \('healthy', 'degraded', 'critical', 'offline', 'unknown'\)\)/i,
    );
  });

  it('bounds health_score to 0-100', () => {
    expect(sql).toMatch(/health_score\s+integer not null default 0 check \(health_score between 0 and 100\)/i);
  });

  it('creates the hydi_status_events audit table', () => {
    expect(sql).toMatch(/create table if not exists public\.hydi_status_events/i);
  });

  it('table and index creation use IF NOT EXISTS', () => {
    const createTableStatements = sql.match(/CREATE TABLE[^\n]*/gi) || [];
    expect(createTableStatements.length).toBe(2);
    createTableStatements.forEach((stmt) => expect(stmt).toMatch(/IF NOT EXISTS/i));
  });

  it('enables RLS on both tables and allows authenticated read on current status', () => {
    expect(sql).toMatch(/ALTER TABLE public\.hydi_subsystem_status ENABLE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/ALTER TABLE public\.hydi_status_events ENABLE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/create policy "hydi_subsystem_status_select" on public\.hydi_subsystem_status[\s\S]*?to authenticated/i);
  });

  it('drops policies before recreating them', () => {
    expect(sql).toMatch(/^\s*drop policy if exists "hydi_subsystem_status_service_all"/im);
    expect(sql).toMatch(/^\s*drop policy if exists "hydi_status_events_service_all"/im);
  });
});
