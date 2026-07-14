'use strict';

/**
 * Governance gate test for migration 20260626150000_heidi_feedback_loop.sql
 *
 * Tests static SQL content only — no live Supabase connection required.
 * Satisfies the hdi-governance-gate.yml requirement: every new .sql migration
 * must have a corresponding test in tests/migrations/<version>.test.js
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20260626150000_heidi_feedback_loop.sql';

describe('Migration 20260626150000 – Heidi Feedback Loop', () => {
  let sql;

  beforeAll(() => {
    sql = readMigration(MIGRATION_FILE);
  });

  describe('baseline', () => {
    it('file is non-empty', () => {
      expect(sql.trim().length).toBeGreaterThan(0);
    });

    it('creates heidi_feedback idempotently', () => {
      expect(sql).toMatch(/create table if not exists heidi_feedback/i);
    });

    it('references heidi_events with cascade delete', () => {
      expect(sql).toMatch(/event_id uuid not null references heidi_events\(id\) on delete cascade/i);
    });

    it('constrains approval to a fixed set of values', () => {
      expect(sql).toMatch(/approval text not null check \(approval in \('approved', 'rejected', 'needs-changes'\)\)/i);
    });
  });

  describe('backward-compatible column additions', () => {
    it('adds updates_count and last_feedback_at to hydi_facts guarded by IF NOT EXISTS', () => {
      expect(sql).toMatch(/alter table hydi_facts add column if not exists updates_count int default 0/i);
      expect(sql).toMatch(/alter table hydi_facts add column if not exists last_feedback_at timestamp/i);
    });
  });

  describe('row level security', () => {
    it('enables RLS on heidi_feedback', () => {
      expect(sql).toMatch(/alter table heidi_feedback enable row level security/i);
    });
  });

  describe('functions', () => {
    it('defines get_feedback_stats and update_fact_from_feedback', () => {
      expect(sql).toMatch(/create or replace function get_feedback_stats\(target_division text\)/i);
      expect(sql).toMatch(/create or replace function update_fact_from_feedback/i);
    });

    it('clamps confidence adjustments to [0.50, 0.97] via least/greatest', () => {
      const fn = sql.slice(sql.search(/create or replace function update_fact_from_feedback/i));
      expect(fn).toMatch(/least\(0\.97,\s*v_old_conf \+ 0\.02\)/i);
      expect(fn).toMatch(/greatest\(0\.50,\s*v_old_conf - 0\.03\)/i);
    });

    it('approval_rate guards against divide-by-zero with NULLIF', () => {
      const fn = sql.slice(
        sql.search(/create or replace function get_feedback_stats/i),
        sql.search(/create or replace function update_fact_from_feedback/i)
      );
      expect(fn).toMatch(/nullif\(count\(\*\), 0\)/i);
    });
  });

  describe('state machine', () => {
    it('introduces no enum or state-machine transitions requiring approval', () => {
      expect(sql.toUpperCase()).not.toMatch(/CREATE TYPE/);
      expect(sql.toUpperCase()).not.toMatch(/\bENUM\b/);
    });
  });
});
