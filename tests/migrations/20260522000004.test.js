'use strict';

/**
 * Governance gate test for migration 20260522000004_rezonate_revenue_splits.sql
 *
 * Tests static SQL content only — no live Supabase connection required.
 * Satisfies the hdi-governance-gate.yml requirement: every new .sql migration
 * must have a corresponding test in tests/migrations/<version>.test.js
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20260522000004_rezonate_revenue_splits.sql';

describe('Migration 20260522000004 – Rezonate Revenue Splits Schema', () => {
  let sql;

  beforeAll(() => {
    sql = readMigration(MIGRATION_FILE);
  });

  // ──────────────────────────────────────────────────────────
  // Baseline
  // ──────────────────────────────────────────────────────────
  describe('baseline', () => {
    it('file is non-empty', () => {
      expect(sql.trim().length).toBeGreaterThan(0);
    });

    it('contains valid SQL keywords', () => {
      expect(sql.toUpperCase()).toMatch(/CREATE|ALTER|INSERT|UPDATE|DROP/);
    });

    it('contains the expected table name', () => {
      expect(sql).toMatch(/rezonate_revenue_splits/);
    });
  });

  // ──────────────────────────────────────────────────────────
  // rezonate_revenue_splits table
  // ──────────────────────────────────────────────────────────
  describe('rezonate_revenue_splits table', () => {
    it('creates rezonate_revenue_splits with IF NOT EXISTS guard', () => {
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS rezonate_revenue_splits/);
    });

    it('defines id as UUID primary key with gen_random_uuid()', () => {
      expect(sql).toMatch(/id\s+UUID\s+PRIMARY KEY DEFAULT gen_random_uuid\(\)/);
    });

    it('defines session_id referencing rezonate_collab_sessions with CASCADE delete and UNIQUE', () => {
      expect(sql).toMatch(/session_id\s+UUID.*REFERENCES rezonate_collab_sessions\(id\) ON DELETE CASCADE UNIQUE/s);
    });

    it("defines split_config JSONB NOT NULL DEFAULT '[]'", () => {
      expect(sql).toMatch(/split_config\s+JSONB\s+NOT NULL DEFAULT '\[\]'/);
    });

    it('defines total_percentage as GENERATED ALWAYS AS computed column', () => {
      expect(sql).toMatch(/total_percentage\s+DECIMAL\(5,2\)\s+GENERATED ALWAYS AS/);
    });

    it('GENERATED ALWAYS AS expression sums percentage field from jsonb_array_elements', () => {
      expect(sql).toMatch(/GENERATED ALWAYS AS[\s\S]*?jsonb_array_elements\(split_config\)/);
      expect(sql).toMatch(/->>'percentage'.*::DECIMAL/s);
    });

    it("total_percentage column is STORED", () => {
      expect(sql).toMatch(/GENERATED ALWAYS AS[\s\S]*?STORED/);
    });

    it('defines locked BOOLEAN DEFAULT FALSE', () => {
      expect(sql).toMatch(/locked\s+BOOLEAN.*DEFAULT FALSE/s);
    });

    it('defines locked_at TIMESTAMPTZ (nullable)', () => {
      expect(sql).toMatch(/locked_at\s+TIMESTAMPTZ/);
    });

    it('defines created_at TIMESTAMPTZ DEFAULT NOW()', () => {
      expect(sql).toMatch(/created_at\s+TIMESTAMPTZ.*DEFAULT NOW\(\)/s);
    });

    it('defines updated_at TIMESTAMPTZ DEFAULT NOW()', () => {
      expect(sql).toMatch(/updated_at\s+TIMESTAMPTZ.*DEFAULT NOW\(\)/s);
    });
  });

  // ──────────────────────────────────────────────────────────
  // updated_at trigger
  // ──────────────────────────────────────────────────────────
  describe('updated_at trigger', () => {
    it('creates or replaces set_updated_at() function using CREATE OR REPLACE', () => {
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.set_updated_at\(\)/);
    });

    it('trigger function sets NEW.updated_at = NOW()', () => {
      expect(sql).toMatch(/NEW\.updated_at = NOW\(\)/);
    });

    it('attaches updated_at trigger to rezonate_revenue_splits', () => {
      expect(sql).toMatch(/CREATE TRIGGER rezonate_revenue_splits_set_updated_at/);
      expect(sql).toMatch(/BEFORE UPDATE ON rezonate_revenue_splits/);
      expect(sql).toMatch(/EXECUTE FUNCTION public\.set_updated_at\(\)/);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Row Level Security
  // ──────────────────────────────────────────────────────────
  describe('row level security', () => {
    it('enables RLS on rezonate_revenue_splits', () => {
      expect(sql).toMatch(/ALTER TABLE rezonate_revenue_splits\s+ENABLE ROW LEVEL SECURITY/);
    });

    it('creates service_role full-access policy for rezonate_revenue_splits', () => {
      expect(sql).toMatch(/service_role_full_access_rezonate_revenue_splits/);
    });

    it('creates participant read policy for rezonate_revenue_splits', () => {
      expect(sql).toMatch(/participants_read_rezonate_revenue_splits/);
    });

    it('participant read policy uses EXISTS check through rezonate_collab_contributions', () => {
      expect(sql).toMatch(/EXISTS[\s\S]*?FROM rezonate_collab_contributions/);
      expect(sql).toMatch(/auth\.uid\(\)/);
    });

    it('creates creator insert policy for rezonate_revenue_splits', () => {
      expect(sql).toMatch(/creator_insert_rezonate_revenue_splits/);
    });

    it('insert policy joins through rezonate_collab_sessions to check created_by', () => {
      expect(sql).toMatch(/FROM rezonate_collab_sessions s[\s\S]*?s\.created_by = auth\.uid\(\)/);
    });

    it('insert policy enforces locked = FALSE guard', () => {
      expect(sql).toMatch(/locked = FALSE/);
    });

    it('creates creator update policy for rezonate_revenue_splits', () => {
      expect(sql).toMatch(/creator_update_rezonate_revenue_splits/);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Table comment
  // ──────────────────────────────────────────────────────────
  describe('table comment', () => {
    it('adds COMMENT on rezonate_revenue_splits', () => {
      expect(sql).toMatch(/COMMENT ON TABLE rezonate_revenue_splits IS/);
    });
  });
});
