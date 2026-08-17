'use strict';

/**
 * Governance gate test for migration 20260714140000_work_sessions_table.sql
 *
 * Tests static SQL content only — no live Supabase connection required.
 * Satisfies the hdi-governance-gate.yml requirement: every new .sql migration
 * must have a corresponding test in tests/migrations/<version>.test.js
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20260714140000_work_sessions_table.sql';

describe('Migration 20260714140000 – Work Sessions Table', () => {
  let sql;

  beforeAll(() => {
    sql = readMigration(MIGRATION_FILE);
  });

  describe('baseline', () => {
    it('file is non-empty', () => {
      expect(sql.trim().length).toBeGreaterThan(0);
    });

    it('creates the work_sessions table', () => {
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.work_sessions/i);
    });
  });

  describe('status state machine', () => {
    it('constrains status to the five defined values', () => {
      expect(sql).toMatch(
        /check \(status in \('planned', 'in_progress', 'completed', 'failed', 'needs_approval'\)\)/i,
      );
    });

    it('defaults status to planned', () => {
      expect(sql).toMatch(/status\s+text not null default 'planned'/i);
    });
  });

  describe('idempotency', () => {
    it('table and index creation use IF NOT EXISTS', () => {
      const createTableStatements = sql.match(/CREATE TABLE[^\n]*/gi) || [];
      expect(createTableStatements.length).toBe(1);
      createTableStatements.forEach((stmt) => expect(stmt).toMatch(/IF NOT EXISTS/i));

      const createIndexStatements = sql.match(/CREATE INDEX[^\n]*/gi) || [];
      expect(createIndexStatements.length).toBe(2);
      createIndexStatements.forEach((stmt) => expect(stmt).toMatch(/IF NOT EXISTS/i));
    });

    it('trigger function uses CREATE OR REPLACE', () => {
      expect(sql).toMatch(/create or replace function public\.work_sessions_set_updated_at/i);
    });

    it('drops the policy and the trigger before recreating them (neither supports IF NOT EXISTS in Postgres)', () => {
      expect(sql).toMatch(/^\s*drop policy if exists "work_sessions_service_all"/im);
      expect(sql).toMatch(/^\s*drop trigger if exists work_sessions_updated_at/im);
    });
  });

  describe('row level security', () => {
    it('enables RLS on the table', () => {
      expect(sql).toMatch(/ALTER TABLE public\.work_sessions ENABLE ROW LEVEL SECURITY/i);
    });

    it('restricts the policy to service_role', () => {
      // Anchored to line start so a comment mentioning "CREATE POLICY" in
      // prose doesn't get counted as a statement.
      const policyMatches = sql.match(/^\s*create policy[\s\S]*?;/gim) || [];
      expect(policyMatches.length).toBe(1);
      expect(policyMatches[0]).toMatch(/to service_role/i);
    });
  });

  describe('state machine (top-level)', () => {
    it('introduces no CREATE TYPE / ENUM (uses a CHECK constraint instead)', () => {
      expect(sql.toUpperCase()).not.toMatch(/CREATE TYPE/);
      expect(sql.toUpperCase()).not.toMatch(/\bENUM\b/);
    });
  });
});
