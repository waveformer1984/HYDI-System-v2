'use strict';

/**
 * Governance gate test for migration 20260629120000_seed_heidi_capabilities.sql
 *
 * Tests static SQL content only — no live Supabase connection required.
 * Satisfies the hdi-governance-gate.yml requirement: every new .sql migration
 * must have a corresponding test in tests/migrations/<version>.test.js
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20260629120000_seed_heidi_capabilities.sql';

describe('Migration 20260629120000 – Seed Heidi Capabilities', () => {
  let sql;

  beforeAll(() => {
    sql = readMigration(MIGRATION_FILE);
  });

  describe('baseline', () => {
    it('file is non-empty', () => {
      expect(sql.trim().length).toBeGreaterThan(0);
    });

    it('only inserts into hydi_facts (a pure data seed, no schema changes)', () => {
      expect(sql).toMatch(/insert into hydi_facts/i);
      expect(sql.toUpperCase()).not.toMatch(/CREATE TABLE/);
      expect(sql.toUpperCase()).not.toMatch(/ALTER TABLE/);
    });

    it('is a single INSERT statement guarded by ON CONFLICT DO NOTHING', () => {
      const inserts = sql.match(/insert into hydi_facts/gi) || [];
      expect(inserts.length).toBe(1);
      expect(sql).toMatch(/on conflict \(content_key\) do nothing/i);
    });
  });

  describe('seeded content', () => {
    it('every row is tagged to the heidi division', () => {
      const divisions = [...sql.matchAll(/,\s*'([a-z]+)',\s*'heidi_[a-z_]+'\)/gi)].map((m) => m[1]);
      expect(divisions.length).toBeGreaterThan(0);
      divisions.forEach((d) => expect(d).toBe('heidi'));
    });

    it('every content_key is unique and namespaced under heidi_', () => {
      const keys = [...sql.matchAll(/'(heidi_[a-z_]+)'\)/gi)].map((m) => m[1]);
      expect(keys.length).toBeGreaterThan(0);
      expect(new Set(keys).size).toBe(keys.length);
    });
  });

  describe('does not touch operational tables', () => {
    it('contains no UPDATE or DELETE statement', () => {
      expect(sql.toUpperCase()).not.toMatch(/\bUPDATE\b/);
      expect(sql.toUpperCase()).not.toMatch(/\bDELETE\b/);
    });
  });

  describe('state machine', () => {
    it('introduces no enum or state-machine transitions requiring approval', () => {
      expect(sql.toUpperCase()).not.toMatch(/CREATE TYPE/);
      expect(sql.toUpperCase()).not.toMatch(/\bENUM\b/);
    });
  });
});
