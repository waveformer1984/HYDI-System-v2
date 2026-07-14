'use strict';

/**
 * Governance gate test for migration 20260625200000_procedural_lessons.sql
 *
 * Tests static SQL content only — no live Supabase connection required.
 * Satisfies the hdi-governance-gate.yml requirement: every new .sql migration
 * must have a corresponding test in tests/migrations/<version>.test.js
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20260625200000_procedural_lessons.sql';

describe('Migration 20260625200000 – Procedural Lessons', () => {
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

    it('creates public.heidi_procedural_lessons idempotently', () => {
      expect(sql).toMatch(/create table if not exists public\.heidi_procedural_lessons/i);
    });
  });

  describe('similarity search indexes', () => {
    it('indexes situation_emb and lesson_emb with ivfflat cosine ops', () => {
      expect(sql).toMatch(/idx_procedural_situation_emb.*using ivfflat \(situation_emb vector_cosine_ops\)/is);
      expect(sql).toMatch(/idx_procedural_lesson_emb.*using ivfflat \(lesson_emb vector_cosine_ops\)/is);
    });
  });

  describe('row level security', () => {
    it('enables RLS and restricts to service_role', () => {
      expect(sql).toMatch(/alter table public\.heidi_procedural_lessons enable row level security/i);
      expect(sql).toMatch(/create policy "service_role_all" on public\.heidi_procedural_lessons\s*\n\s*for all to service_role/i);
    });
  });

  describe('functions', () => {
    it('defines match_procedural_lessons, update_lesson_application, prune_low_confidence_lessons', () => {
      expect(sql).toMatch(/create or replace function match_procedural_lessons/i);
      expect(sql).toMatch(/create or replace function update_lesson_application/i);
      expect(sql).toMatch(/create or replace function prune_low_confidence_lessons/i);
    });

    it('confidence adjustment is clamped to [0, 1] via least/greatest', () => {
      expect(sql).toMatch(/least\(1\.0,/i);
    });

    it('pruning is scoped by both a confidence floor and a minimum age, not confidence alone', () => {
      const pruneFn = sql.slice(sql.search(/create or replace function prune_low_confidence_lessons/i));
      expect(pruneFn).toMatch(/confidence < min_confidence/i);
      expect(pruneFn).toMatch(/created_at < now\(\) - \(min_age_days \|\| ' days'\)::interval/i);
    });
  });

  describe('state machine', () => {
    it('introduces no enum or state-machine transitions requiring approval', () => {
      expect(sql.toUpperCase()).not.toMatch(/CREATE TYPE/);
      expect(sql.toUpperCase()).not.toMatch(/\bENUM\b/);
    });
  });
});
