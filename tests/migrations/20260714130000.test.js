'use strict';

/**
 * Governance gate test for migration 20260714130000_memories_episodic_kind.sql
 *
 * Tests static SQL content only — no live Supabase connection required.
 * Satisfies the hdi-governance-gate.yml requirement: every new .sql migration
 * must have a corresponding test in tests/migrations/<version>.test.js
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20260714130000_memories_episodic_kind.sql';

describe('Migration 20260714130000 – Memories Episodic Kind', () => {
  let sql;

  beforeAll(() => {
    sql = readMigration(MIGRATION_FILE);
  });

  describe('baseline', () => {
    it('file is non-empty', () => {
      expect(sql.trim().length).toBeGreaterThan(0);
    });

    it('contains valid SQL keywords', () => {
      expect(sql.toUpperCase()).toMatch(/ALTER/);
    });
  });

  describe('backward compatibility', () => {
    it('adds kind with a default so existing rows are unaffected', () => {
      expect(sql).toMatch(/add column if not exists kind text not null default 'conversation'/i);
    });

    it('adds metadata as a nullable jsonb column (no default required)', () => {
      expect(sql).toMatch(/add column if not exists metadata jsonb/i);
    });

    it('does not touch existing columns or drop anything', () => {
      expect(sql.toUpperCase()).not.toMatch(/DROP COLUMN/);
      expect(sql.toUpperCase()).not.toMatch(/DROP TABLE/);
    });
  });

  describe('idempotency', () => {
    it('every ALTER TABLE uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS', () => {
      const alterStatements = sql.match(/alter table[^\n]*/gi) || [];
      expect(alterStatements.length).toBe(2);
      alterStatements.forEach((stmt) => expect(stmt).toMatch(/if not exists/i));
    });

    it('index creation uses IF NOT EXISTS', () => {
      const indexStatements = sql.match(/create index[^\n]*/gi) || [];
      expect(indexStatements.length).toBe(1);
      indexStatements.forEach((stmt) => expect(stmt).toMatch(/if not exists/i));
    });
  });

  describe('state machine', () => {
    it('introduces no enum or state-machine transitions requiring approval', () => {
      expect(sql.toUpperCase()).not.toMatch(/CREATE TYPE/);
      expect(sql.toUpperCase()).not.toMatch(/\bENUM\b/);
    });
  });
});
