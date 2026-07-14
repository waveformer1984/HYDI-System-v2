'use strict';

/**
 * Governance gate test for migration 20260626130000_heidi_event_loop_schema.sql
 *
 * Tests static SQL content only — no live Supabase connection required.
 * Satisfies the hdi-governance-gate.yml requirement: every new .sql migration
 * must have a corresponding test in tests/migrations/<version>.test.js
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20260626130000_heidi_event_loop_schema.sql';

describe('Migration 20260626130000 – Heidi Event Loop Schema', () => {
  let sql;

  beforeAll(() => {
    sql = readMigration(MIGRATION_FILE);
  });

  describe('baseline', () => {
    it('file is non-empty', () => {
      expect(sql.trim().length).toBeGreaterThan(0);
    });

    it('creates agent_bus, heidi_decision_bounds, heidi_events, heidi_reflections idempotently', () => {
      expect(sql).toMatch(/create table if not exists agent_bus/i);
      expect(sql).toMatch(/create table if not exists heidi_decision_bounds/i);
      expect(sql).toMatch(/create table if not exists heidi_events/i);
      expect(sql).toMatch(/create table if not exists heidi_reflections/i);
    });
  });

  describe('backward-compatible column addition', () => {
    it('guards the cycle column add with an information_schema existence check', () => {
      expect(sql).toMatch(/information_schema\.columns where table_name='heidi_reflections' and column_name='cycle'/i);
      expect(sql).toMatch(/alter table heidi_reflections add column cycle int not null default 0/i);
    });
  });

  describe('decision bounds seed', () => {
    it('seeds exactly one row and is idempotent via ON CONFLICT DO NOTHING', () => {
      expect(sql).toMatch(/insert into heidi_decision_bounds/i);
      expect(sql).toMatch(/on conflict \(id\) do nothing/i);
    });

    it('default auto-approve threshold matches the documented 0.85 / $10,000 bounds', () => {
      expect(sql).toMatch(/values \(0\.85, 10000, null, null\)/i);
    });
  });

  describe('row level security', () => {
    it('enables RLS on all four tables', () => {
      ['agent_bus', 'heidi_decision_bounds', 'heidi_events', 'heidi_reflections'].forEach((table) => {
        expect(sql).toMatch(new RegExp(`alter table ${table} enable row level security`, 'i'));
      });
    });

    it('grants service_role full access on all four tables', () => {
      ['agent_bus', 'heidi_decision_bounds', 'heidi_events', 'heidi_reflections'].forEach((table) => {
        expect(sql).toMatch(new RegExp(`${table}_service_role on ${table} for all to service_role`, 'i'));
      });
    });

    it('allows authenticated users to read the audit trail (events, reflections) but not decision bounds', () => {
      expect(sql).toMatch(/heidi_events_read on heidi_events for select to authenticated/i);
      expect(sql).toMatch(/heidi_reflections_read on heidi_reflections for select to authenticated/i);
      expect(sql).not.toMatch(/heidi_decision_bounds_read/i);
    });
  });

  describe('state machine', () => {
    it('introduces no enum or state-machine transitions requiring approval', () => {
      expect(sql.toUpperCase()).not.toMatch(/CREATE TYPE/);
      expect(sql.toUpperCase()).not.toMatch(/\bENUM\b/);
    });
  });
});
