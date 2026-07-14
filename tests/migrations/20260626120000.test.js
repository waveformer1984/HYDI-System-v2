'use strict';

/**
 * Governance gate test for migration 20260626120000_pgvector_semantic_retrieval.sql
 *
 * Tests static SQL content only — no live Supabase connection required.
 * Satisfies the hdi-governance-gate.yml requirement: every new .sql migration
 * must have a corresponding test in tests/migrations/<version>.test.js
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20260626120000_pgvector_semantic_retrieval.sql';

describe('Migration 20260626120000 – pgvector Semantic Retrieval', () => {
  let sql;

  beforeAll(() => {
    sql = readMigration(MIGRATION_FILE);
  });

  describe('baseline', () => {
    it('file is non-empty', () => {
      expect(sql.trim().length).toBeGreaterThan(0);
    });

    it('enables the vector extension', () => {
      expect(sql).toMatch(/create extension if not exists vector/i);
    });

    it('creates hydi_facts idempotently with a 1536-dim embedding column', () => {
      expect(sql).toMatch(/create table if not exists hydi_facts/i);
      expect(sql).toMatch(/embedding vector\(1536\)/i);
    });

    it('content_key is unique (backs the ON CONFLICT DO NOTHING seed pattern)', () => {
      expect(sql).toMatch(/content_key\s+text unique/i);
    });
  });

  describe('similarity search', () => {
    it('indexes embedding with ivfflat cosine ops', () => {
      expect(sql).toMatch(/hydi_facts_embedding_idx\s*\n?\s*on hydi_facts\s*\n?\s*using ivfflat \(embedding vector_cosine_ops\)/i);
    });

    it('defines retrieve_similar_facts and grants execute to anon, authenticated, service_role', () => {
      expect(sql).toMatch(/create or replace function retrieve_similar_facts/i);
      expect(sql).toMatch(/grant execute on function retrieve_similar_facts to anon, authenticated, service_role/i);
    });
  });

  describe('known follow-up', () => {
    // retrieve_similar_facts queries hydi_facts (a table whose contents
    // change), so it cannot correctly be IMMUTABLE -- that volatility
    // promise lets the planner cache/fold results across calls, risking
    // stale matches as facts are added/updated. Fixed forward in
    // 20260714180000_fix_retrieve_similar_facts_volatility.sql rather than
    // rewriting this already-applied migration in place.
    it('is marked IMMUTABLE as originally shipped (corrected by a later migration)', () => {
      expect(sql).toMatch(/\$\$ language plpgsql immutable/i);
    });
  });

  describe('state machine', () => {
    it('introduces no enum or state-machine transitions requiring approval', () => {
      expect(sql.toUpperCase()).not.toMatch(/CREATE TYPE/);
      expect(sql.toUpperCase()).not.toMatch(/\bENUM\b/);
    });
  });
});
