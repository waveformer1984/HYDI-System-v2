'use strict';

/**
 * Governance gate test for migration 20260714120000_raw_event_ledger_table.sql
 *
 * Tests static SQL content only — no live Supabase connection required.
 * Satisfies the hdi-governance-gate.yml requirement: every new .sql migration
 * must have a corresponding test in tests/migrations/<version>.test.js
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20260714120000_raw_event_ledger_table.sql';

describe('Migration 20260714120000 – Raw Event Ledger Table', () => {
  let sql;

  beforeAll(() => {
    sql = readMigration(MIGRATION_FILE);
  });

  describe('baseline', () => {
    it('file is non-empty', () => {
      expect(sql.trim().length).toBeGreaterThan(0);
    });

    it('contains valid SQL keywords', () => {
      expect(sql.toUpperCase()).toMatch(/CREATE|ALTER/);
    });

    it('creates the raw_event_ledger table', () => {
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.raw_event_ledger/i);
    });
  });

  describe('append-only guarantee', () => {
    it('fingerprint column is unique (prevents duplicate append of the same event)', () => {
      expect(sql).toMatch(/fingerprint\s+text\s+not null\s+unique/i);
    });

    it('defines only INSERT and SELECT policies — no UPDATE or DELETE policy', () => {
      const policyMatches = sql.match(/CREATE POLICY[\s\S]*?;/gi) || [];
      expect(policyMatches.length).toBe(2);
      expect(policyMatches.some((p) => /for insert/i.test(p))).toBe(true);
      expect(policyMatches.some((p) => /for select/i.test(p))).toBe(true);
      expect(policyMatches.some((p) => /for update/i.test(p))).toBe(false);
      expect(policyMatches.some((p) => /for delete/i.test(p))).toBe(false);
    });

    it('has a hash column for content-integrity verification', () => {
      expect(sql).toMatch(/hash\s+text\s+not null/i);
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
  });

  describe('row level security', () => {
    it('enables RLS on the table', () => {
      expect(sql).toMatch(/ALTER TABLE public\.raw_event_ledger ENABLE ROW LEVEL SECURITY/i);
    });

    it('restricts policies to service_role', () => {
      const policyMatches = sql.match(/CREATE POLICY[\s\S]*?to service_role[\s\S]*?;/gi) || [];
      expect(policyMatches.length).toBe(2);
    });
  });

  describe('state machine', () => {
    it('introduces no enum or state-machine transitions requiring approval', () => {
      expect(sql.toUpperCase()).not.toMatch(/CREATE TYPE/);
      expect(sql.toUpperCase()).not.toMatch(/\bENUM\b/);
    });
  });
});
