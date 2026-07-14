'use strict';

/**
 * Governance gate test for migration 003_memory_engine.sql
 *
 * Tests static SQL content only — no live Supabase connection required.
 * Satisfies the hdi-governance-gate.yml requirement: every new .sql migration
 * must have a corresponding test in tests/migrations/<version>.test.js
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '003_memory_engine.sql';

describe('Migration 003 – Memory Engine Tables', () => {
  let sql;

  beforeAll(() => {
    sql = readMigration(MIGRATION_FILE);
  });

  describe('baseline', () => {
    it('file is non-empty', () => {
      expect(sql.trim().length).toBeGreaterThan(0);
    });

    it('enables the vector extension before any vector() column', () => {
      const extIdx = sql.search(/create extension if not exists vector/i);
      const vectorColIdx = sql.search(/embedding\s+vector\(/i);
      expect(extIdx).toBeGreaterThan(-1);
      expect(vectorColIdx).toBeGreaterThan(extIdx);
    });
  });

  describe('tables', () => {
    it('creates procedural_workflows, knowledge_documents, semantic_chunks, interactions', () => {
      expect(sql).toMatch(/create table if not exists procedural_workflows/i);
      expect(sql).toMatch(/create table if not exists knowledge_documents/i);
      expect(sql).toMatch(/create table if not exists semantic_chunks/i);
      expect(sql).toMatch(/create table if not exists interactions/i);
    });

    it('uses IF NOT EXISTS on every CREATE TABLE for idempotency', () => {
      const createTableStatements = sql.match(/create table[^\n]*/gi) || [];
      expect(createTableStatements.length).toBeGreaterThan(0);
      createTableStatements.forEach((stmt) => {
        expect(stmt.toLowerCase()).toMatch(/create table if not exists/);
      });
    });

    it('semantic_chunks cascades on knowledge_documents deletion', () => {
      expect(sql).toMatch(/document_id uuid references knowledge_documents\(id\) on delete cascade/i);
    });

    it('interactions rows expire after creation', () => {
      expect(sql).toMatch(/check \(expires_at > created_at\)/i);
    });
  });

  describe('search function', () => {
    it('defines search_documents as a STABLE SQL function', () => {
      expect(sql).toMatch(/create or replace function search_documents/i);
      expect(sql).toMatch(/\$\$ language sql stable/i);
    });
  });

  describe('row level security', () => {
    it('enables RLS on all three user-facing tables', () => {
      expect(sql).toMatch(/alter table procedural_workflows enable row level security/i);
      expect(sql).toMatch(/alter table knowledge_documents enable row level security/i);
      expect(sql).toMatch(/alter table interactions enable row level security/i);
    });

    it('restricts writes to service_role', () => {
      const writePolicies = sql.match(/create policy "\w+_write"[^;]*;/gis) || [];
      expect(writePolicies.length).toBeGreaterThan(0);
      writePolicies.forEach((policy) => {
        expect(policy.toLowerCase()).toMatch(/auth\.role\(\) = 'service_role'/);
      });
    });
  });

  describe('state machine', () => {
    it('introduces no enum or state-machine transitions requiring approval', () => {
      expect(sql.toUpperCase()).not.toMatch(/CREATE TYPE/);
      expect(sql.toUpperCase()).not.toMatch(/\bENUM\b/);
    });
  });
});
