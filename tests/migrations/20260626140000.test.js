'use strict';

/**
 * Governance gate test for migration 20260626140000_seed_procedural_memory.sql
 *
 * Tests static SQL content only — no live Supabase connection required.
 * Satisfies the hdi-governance-gate.yml requirement: every new .sql migration
 * must have a corresponding test in tests/migrations/<version>.test.js
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20260626140000_seed_procedural_memory.sql';

describe('Migration 20260626140000 – Seed Procedural Memory', () => {
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
  });

  describe('idempotency', () => {
    it('every INSERT is guarded by ON CONFLICT (content_key) DO NOTHING', () => {
      const inserts = sql.match(/insert into hydi_facts[\s\S]*?(?=insert into hydi_facts|$)/gi) || [];
      expect(inserts.length).toBeGreaterThan(0);
      inserts.forEach((block) => {
        expect(block).toMatch(/on conflict \(content_key\) do nothing/i);
      });
    });

    it('every seeded row has a unique, non-null content_key', () => {
      const keys = [...sql.matchAll(/'([a-z0-9_]+)'\)/gi)].map((m) => m[1]);
      expect(keys.length).toBeGreaterThan(0);
      expect(new Set(keys).size).toBe(keys.length);
    });
  });

  describe('confidence values', () => {
    it('every seeded confidence value is within [0, 1]', () => {
      const confidences = [...sql.matchAll(/,\s*(0\.\d+|1\.0),\s*'[a-z]+',/gi)].map((m) => parseFloat(m[1]));
      expect(confidences.length).toBeGreaterThan(0);
      confidences.forEach((c) => {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      });
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
