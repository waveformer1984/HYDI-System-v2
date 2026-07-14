'use strict';

/**
 * Governance gate test for migration
 * 20260714180000_fix_retrieve_similar_facts_volatility.sql
 *
 * Tests static SQL content only — no live Supabase connection required.
 * Satisfies the hdi-governance-gate.yml requirement: every new .sql migration
 * must have a corresponding test in tests/migrations/<version>.test.js
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20260714180000_fix_retrieve_similar_facts_volatility.sql';

describe('Migration 20260714180000 – Fix retrieve_similar_facts Volatility', () => {
  let sql;

  beforeAll(() => {
    sql = readMigration(MIGRATION_FILE);
  });

  describe('baseline', () => {
    it('file is non-empty', () => {
      expect(sql.trim().length).toBeGreaterThan(0);
    });

    it('redefines retrieve_similar_facts via CREATE OR REPLACE', () => {
      expect(sql).toMatch(/create or replace function retrieve_similar_facts/i);
    });
  });

  describe('volatility fix', () => {
    it('is STABLE, not IMMUTABLE -- it reads from hydi_facts, which changes over time', () => {
      // Check the actual LANGUAGE clause, not the whole file -- the comment
      // above legitimately explains the old IMMUTABLE bug using that word.
      const languageClause = sql.match(/\$\$\s*language\s+plpgsql\s+\w+/i)[0];
      expect(languageClause.toLowerCase()).toMatch(/stable/);
      expect(languageClause.toUpperCase()).not.toMatch(/IMMUTABLE/);
    });

    it('keeps the same signature as the original (query_embedding, similarity_threshold, limit_results)', () => {
      expect(sql).toMatch(/query_embedding vector,\s*\n\s*similarity_threshold float default 0\.6,\s*\n\s*limit_results int default 5/i);
    });

    it('re-grants execute to anon, authenticated, service_role', () => {
      expect(sql).toMatch(/grant execute on function retrieve_similar_facts to anon, authenticated, service_role/i);
    });
  });

  describe('does not touch table structure or data', () => {
    it('contains no CREATE TABLE, ALTER TABLE, INSERT, UPDATE, or DELETE', () => {
      expect(sql.toUpperCase()).not.toMatch(/CREATE TABLE/);
      expect(sql.toUpperCase()).not.toMatch(/ALTER TABLE/);
      expect(sql.toUpperCase()).not.toMatch(/\bINSERT\b/);
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
