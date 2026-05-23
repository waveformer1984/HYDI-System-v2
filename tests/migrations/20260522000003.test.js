'use strict';

/**
 * Governance gate test for migration 20260522000003_rezonate_rights.sql
 *
 * Tests static SQL content only — no live Supabase connection required.
 * Satisfies the hdi-governance-gate.yml requirement: every new .sql migration
 * must have a corresponding test in tests/migrations/<version>.test.js
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20260522000003_rezonate_rights.sql';

describe('Migration 20260522000003 – Rezonate Rights & Fingerprinting Schema', () => {
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

    it('contains both expected table names', () => {
      expect(sql).toMatch(/rezonate_fingerprints/);
      expect(sql).toMatch(/rezonate_ownership/);
    });
  });

  // ──────────────────────────────────────────────────────────
  // rezonate_fingerprints table
  // ──────────────────────────────────────────────────────────
  describe('rezonate_fingerprints table', () => {
    it('creates rezonate_fingerprints with IF NOT EXISTS guard', () => {
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS rezonate_fingerprints/);
    });

    it('defines id as UUID primary key with gen_random_uuid()', () => {
      expect(sql).toMatch(/id\s+UUID\s+PRIMARY KEY DEFAULT gen_random_uuid\(\)/);
    });

    it('defines project_id referencing rezonate_projects ON DELETE SET NULL', () => {
      expect(sql).toMatch(/project_id\s+UUID.*REFERENCES rezonate_projects\(id\).*ON DELETE SET NULL/s);
    });

    it('defines audio_file_id referencing rezonate_audio_files ON DELETE SET NULL', () => {
      expect(sql).toMatch(/audio_file_id\s+UUID.*REFERENCES rezonate_audio_files\(id\).*ON DELETE SET NULL/s);
    });

    it('defines hash TEXT NOT NULL UNIQUE', () => {
      expect(sql).toMatch(/hash\s+TEXT\s+NOT NULL UNIQUE/);
    });

    it("defines chroma_vector DECIMAL[] DEFAULT '{}'", () => {
      expect(sql).toMatch(/chroma_vector\s+DECIMAL\[\]\s+DEFAULT '{}'/);
    });

    it('defines spectral_hash TEXT', () => {
      expect(sql).toMatch(/spectral_hash\s+TEXT/);
    });

    it('defines duration_seconds DECIMAL(10,3)', () => {
      expect(sql).toMatch(/duration_seconds\s+DECIMAL\(10,3\)/);
    });

    it('defines submitted_by referencing auth.users', () => {
      expect(sql).toMatch(/submitted_by\s+UUID.*REFERENCES auth\.users\(id\)/s);
    });

    it('defines submitted_at TIMESTAMPTZ DEFAULT NOW()', () => {
      expect(sql).toMatch(/submitted_at\s+TIMESTAMPTZ.*DEFAULT NOW\(\)/s);
    });
  });

  // ──────────────────────────────────────────────────────────
  // rezonate_ownership table
  // ──────────────────────────────────────────────────────────
  describe('rezonate_ownership table', () => {
    it('creates rezonate_ownership with IF NOT EXISTS guard', () => {
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS rezonate_ownership/);
    });

    it('defines fingerprint_id referencing rezonate_fingerprints with CASCADE delete', () => {
      expect(sql).toMatch(/fingerprint_id\s+UUID.*REFERENCES rezonate_fingerprints\(id\) ON DELETE CASCADE/s);
    });

    it('defines owner_id referencing auth.users', () => {
      expect(sql).toMatch(/owner_id\s+UUID.*REFERENCES auth\.users\(id\)/s);
    });

    it('defines owner_name TEXT', () => {
      expect(sql).toMatch(/owner_name\s+TEXT/);
    });

    it("defines status CHECK constraint covering 'verified', 'unverified', 'disputed'", () => {
      expect(sql).toMatch(/status.*CHECK.*status IN.*'verified'.*'unverified'.*'disputed'/s);
    });

    it("defines status DEFAULT 'unverified'", () => {
      expect(sql).toMatch(/status.*DEFAULT 'unverified'/s);
    });

    it("defines claim_evidence JSONB DEFAULT '{}'", () => {
      expect(sql).toMatch(/claim_evidence\s+JSONB.*DEFAULT '{}'/s);
    });

    it('defines registered_at TIMESTAMPTZ DEFAULT NOW()', () => {
      expect(sql).toMatch(/registered_at\s+TIMESTAMPTZ.*DEFAULT NOW\(\)/s);
    });

    it('defines updated_at TIMESTAMPTZ DEFAULT NOW()', () => {
      expect(sql).toMatch(/updated_at\s+TIMESTAMPTZ.*DEFAULT NOW\(\)/s);
    });

    it('defines UNIQUE constraint on (fingerprint_id, owner_id)', () => {
      expect(sql).toMatch(/UNIQUE\s*\(\s*fingerprint_id,\s*owner_id\s*\)/);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Indexes
  // ──────────────────────────────────────────────────────────
  describe('indexes', () => {
    it('creates index on rezonate_fingerprints(hash)', () => {
      expect(sql).toMatch(/idx_rezonate_fingerprints_hash/);
      expect(sql).toMatch(/ON rezonate_fingerprints \(hash\)/);
    });

    it('creates index on rezonate_fingerprints(submitted_by)', () => {
      expect(sql).toMatch(/idx_rezonate_fingerprints_submitted_by/);
      expect(sql).toMatch(/ON rezonate_fingerprints \(submitted_by\)/);
    });

    it('creates index on rezonate_ownership(fingerprint_id)', () => {
      expect(sql).toMatch(/idx_rezonate_ownership_fingerprint_id/);
      expect(sql).toMatch(/ON rezonate_ownership \(fingerprint_id\)/);
    });

    it('creates index on rezonate_ownership(owner_id)', () => {
      expect(sql).toMatch(/idx_rezonate_ownership_owner_id/);
      expect(sql).toMatch(/ON rezonate_ownership \(owner_id\)/);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Row Level Security
  // ──────────────────────────────────────────────────────────
  describe('row level security', () => {
    it('enables RLS on rezonate_fingerprints', () => {
      expect(sql).toMatch(/ALTER TABLE rezonate_fingerprints\s+ENABLE ROW LEVEL SECURITY/);
    });

    it('enables RLS on rezonate_ownership', () => {
      expect(sql).toMatch(/ALTER TABLE rezonate_ownership\s+ENABLE ROW LEVEL SECURITY/);
    });

    it('creates service_role full-access policy for rezonate_fingerprints', () => {
      expect(sql).toMatch(/service_role_full_access_rezonate_fingerprints/);
    });

    it('creates service_role full-access policy for rezonate_ownership', () => {
      expect(sql).toMatch(/service_role_full_access_rezonate_ownership/);
    });

    it('creates public read policy for rezonate_fingerprints', () => {
      expect(sql).toMatch(/public_read_rezonate_fingerprints/);
    });

    it('creates public read policy for rezonate_ownership', () => {
      expect(sql).toMatch(/public_read_rezonate_ownership/);
    });

    it('authenticated insert policy for fingerprints checks submitted_by = auth.uid()', () => {
      expect(sql).toMatch(/users_insert_rezonate_fingerprints/);
      expect(sql).toMatch(/submitted_by = auth\.uid\(\)/);
    });

    it('authenticated insert policy for ownership checks owner_id = auth.uid()', () => {
      expect(sql).toMatch(/users_insert_rezonate_ownership/);
      expect(sql).toMatch(/owner_id = auth\.uid\(\)/);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Table comments
  // ──────────────────────────────────────────────────────────
  describe('table comments', () => {
    it('adds COMMENT on rezonate_fingerprints', () => {
      expect(sql).toMatch(/COMMENT ON TABLE rezonate_fingerprints IS/);
    });

    it('adds COMMENT on rezonate_ownership', () => {
      expect(sql).toMatch(/COMMENT ON TABLE rezonate_ownership IS/);
    });
  });
});
