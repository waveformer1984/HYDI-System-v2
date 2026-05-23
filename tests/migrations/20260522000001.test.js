'use strict';

/**
 * Governance gate test for migration 20260522000001_rezonate_schema.sql
 *
 * Tests static SQL content only — no live Supabase connection required.
 * Satisfies the hdi-governance-gate.yml requirement: every new .sql migration
 * must have a corresponding test in tests/migrations/<version>.test.js
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20260522000001_rezonate_schema.sql';

describe('Migration 20260522000001 – Rezonate Music Platform Schema', () => {
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

    it('contains all five expected table names', () => {
      expect(sql).toMatch(/rezonate_projects/);
      expect(sql).toMatch(/rezonate_tracks/);
      expect(sql).toMatch(/rezonate_patterns/);
      expect(sql).toMatch(/rezonate_audio_files/);
      expect(sql).toMatch(/rezonate_processing_settings/);
    });
  });

  // ──────────────────────────────────────────────────────────
  // rezonate_projects table
  // ──────────────────────────────────────────────────────────
  describe('rezonate_projects table', () => {
    it('creates rezonate_projects with IF NOT EXISTS guard', () => {
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS rezonate_projects/);
    });

    it('defines id as UUID primary key with gen_random_uuid()', () => {
      expect(sql).toMatch(/id\s+UUID\s+PRIMARY KEY DEFAULT gen_random_uuid\(\)/);
    });

    it('defines user_id referencing auth.users with CASCADE delete', () => {
      expect(sql).toMatch(/user_id\s+UUID.*REFERENCES auth\.users\(id\) ON DELETE CASCADE/s);
    });

    it('defines name as TEXT NOT NULL', () => {
      // Match name column declaration (before the comma/newline) in the projects table block
      expect(sql).toMatch(/name\s+TEXT\s+NOT NULL/);
    });

    it('defines tempo INT with DEFAULT 120', () => {
      expect(sql).toMatch(/tempo\s+INT.*DEFAULT 120/s);
    });

    it("defines time_signature with DEFAULT '4/4'", () => {
      expect(sql).toMatch(/time_signature.*DEFAULT '4\/4'/s);
    });

    it("defines key_signature with DEFAULT 'C major'", () => {
      expect(sql).toMatch(/key_signature.*DEFAULT 'C major'/s);
    });

    it("defines status column with CHECK constraint covering 'draft', 'active', 'archived'", () => {
      expect(sql).toMatch(/status.*CHECK.*status IN.*'draft'.*'active'.*'archived'/s);
    });

    it("defines status DEFAULT 'draft'", () => {
      expect(sql).toMatch(/status.*DEFAULT 'draft'/s);
    });

    it('defines created_at as TIMESTAMPTZ DEFAULT NOW()', () => {
      expect(sql).toMatch(/created_at\s+TIMESTAMPTZ.*DEFAULT NOW\(\)/s);
    });

    it('defines updated_at as TIMESTAMPTZ DEFAULT NOW()', () => {
      expect(sql).toMatch(/updated_at\s+TIMESTAMPTZ.*DEFAULT NOW\(\)/s);
    });
  });

  // ──────────────────────────────────────────────────────────
  // rezonate_tracks table
  // ──────────────────────────────────────────────────────────
  describe('rezonate_tracks table', () => {
    it('creates rezonate_tracks with IF NOT EXISTS guard', () => {
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS rezonate_tracks/);
    });

    it('defines project_id referencing rezonate_projects with CASCADE delete', () => {
      expect(sql).toMatch(/project_id\s+UUID.*REFERENCES rezonate_projects\(id\) ON DELETE CASCADE/s);
    });

    it("defines type column with CHECK constraint covering 'audio', 'midi', 'instrument'", () => {
      expect(sql).toMatch(/type.*CHECK.*type IN.*'audio'.*'midi'.*'instrument'/s);
    });

    it('defines muted BOOLEAN DEFAULT FALSE', () => {
      expect(sql).toMatch(/muted\s+BOOLEAN.*DEFAULT FALSE/s);
    });

    it('defines solo BOOLEAN DEFAULT FALSE', () => {
      expect(sql).toMatch(/solo\s+BOOLEAN.*DEFAULT FALSE/s);
    });

    it('defines volume as DECIMAL(4,2) DEFAULT 0.0', () => {
      expect(sql).toMatch(/volume\s+DECIMAL\(4,2\).*DEFAULT 0\.0/s);
    });

    it('defines pan as DECIMAL(4,2) DEFAULT 0.0', () => {
      expect(sql).toMatch(/pan\s+DECIMAL\(4,2\).*DEFAULT 0\.0/s);
    });

    it('defines position INT DEFAULT 0', () => {
      expect(sql).toMatch(/position\s+INT.*DEFAULT 0/s);
    });
  });

  // ──────────────────────────────────────────────────────────
  // rezonate_patterns table
  // ──────────────────────────────────────────────────────────
  describe('rezonate_patterns table', () => {
    it('creates rezonate_patterns with IF NOT EXISTS guard', () => {
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS rezonate_patterns/);
    });

    it('defines track_id referencing rezonate_tracks with CASCADE delete', () => {
      expect(sql).toMatch(/track_id\s+UUID.*REFERENCES rezonate_tracks\(id\) ON DELETE CASCADE/s);
    });

    it('defines length_bars INT DEFAULT 4', () => {
      expect(sql).toMatch(/length_bars\s+INT.*DEFAULT 4/s);
    });

    it('defines start_position INT DEFAULT 0', () => {
      expect(sql).toMatch(/start_position\s+INT.*DEFAULT 0/s);
    });

    it("defines data as JSONB NOT NULL DEFAULT '{}'", () => {
      expect(sql).toMatch(/data\s+JSONB\s+NOT NULL DEFAULT '{}'/);
    });
  });

  // ──────────────────────────────────────────────────────────
  // rezonate_audio_files table
  // ──────────────────────────────────────────────────────────
  describe('rezonate_audio_files table', () => {
    it('creates rezonate_audio_files with IF NOT EXISTS guard', () => {
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS rezonate_audio_files/);
    });

    it('defines project_id referencing rezonate_projects with CASCADE delete', () => {
      // Use a broader pattern since there are multiple project_id references
      expect(sql).toMatch(/rezonate_audio_files[\s\S]*?project_id\s+UUID.*REFERENCES rezonate_projects\(id\) ON DELETE CASCADE/);
    });

    it('defines track_id referencing rezonate_tracks with ON DELETE SET NULL (nullable)', () => {
      expect(sql).toMatch(/track_id\s+UUID.*REFERENCES rezonate_tracks\(id\) ON DELETE SET NULL/s);
    });

    it('defines filename TEXT NOT NULL', () => {
      expect(sql).toMatch(/filename\s+TEXT\s+NOT NULL/);
    });

    it('defines file_path TEXT NOT NULL', () => {
      expect(sql).toMatch(/file_path\s+TEXT\s+NOT NULL/);
    });

    it("defines storage_bucket with DEFAULT 'rezonate-audio'", () => {
      expect(sql).toMatch(/storage_bucket.*DEFAULT 'rezonate-audio'/s);
    });

    it('defines duration_seconds as DECIMAL(10,3)', () => {
      expect(sql).toMatch(/duration_seconds\s+DECIMAL\(10,3\)/);
    });

    it('defines sample_rate INT', () => {
      expect(sql).toMatch(/sample_rate\s+INT/);
    });

    it('defines bit_depth INT', () => {
      expect(sql).toMatch(/bit_depth\s+INT/);
    });

    it('defines file_size_bytes BIGINT', () => {
      expect(sql).toMatch(/file_size_bytes\s+BIGINT/);
    });
  });

  // ──────────────────────────────────────────────────────────
  // rezonate_processing_settings table
  // ──────────────────────────────────────────────────────────
  describe('rezonate_processing_settings table', () => {
    it('creates rezonate_processing_settings with IF NOT EXISTS guard', () => {
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS rezonate_processing_settings/);
    });

    it('defines track_id referencing rezonate_tracks with CASCADE delete', () => {
      // processing_settings also references tracks with CASCADE
      expect(sql).toMatch(/rezonate_processing_settings[\s\S]*?track_id\s+UUID.*REFERENCES rezonate_tracks\(id\) ON DELETE CASCADE/);
    });

    it('defines effect_type TEXT NOT NULL', () => {
      expect(sql).toMatch(/effect_type\s+TEXT\s+NOT NULL/);
    });

    it("defines parameters as JSONB NOT NULL DEFAULT '{}'", () => {
      // parameters column appears only in processing_settings
      expect(sql).toMatch(/parameters\s+JSONB\s+NOT NULL DEFAULT '{}'/);
    });

    it('defines enabled BOOLEAN DEFAULT TRUE', () => {
      expect(sql).toMatch(/enabled\s+BOOLEAN.*DEFAULT TRUE/s);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Indexes
  // ──────────────────────────────────────────────────────────
  describe('indexes', () => {
    it('creates index on rezonate_projects(user_id)', () => {
      expect(sql).toMatch(/idx_rezonate_projects_user_id/);
      expect(sql).toMatch(/ON rezonate_projects \(user_id\)/);
    });

    it('creates index on rezonate_tracks(project_id)', () => {
      expect(sql).toMatch(/idx_rezonate_tracks_project_id/);
      expect(sql).toMatch(/ON rezonate_tracks \(project_id\)/);
    });

    it('creates index on rezonate_patterns(track_id)', () => {
      expect(sql).toMatch(/idx_rezonate_patterns_track_id/);
      expect(sql).toMatch(/ON rezonate_patterns \(track_id\)/);
    });

    it('creates index on rezonate_audio_files(project_id)', () => {
      expect(sql).toMatch(/idx_rezonate_audio_files_project_id/);
      expect(sql).toMatch(/ON rezonate_audio_files \(project_id\)/);
    });

    it('creates index on rezonate_audio_files(track_id)', () => {
      expect(sql).toMatch(/idx_rezonate_audio_files_track_id/);
      expect(sql).toMatch(/ON rezonate_audio_files \(track_id\)/);
    });

    it('creates index on rezonate_processing_settings(track_id)', () => {
      expect(sql).toMatch(/idx_rezonate_processing_settings_track_id/);
      expect(sql).toMatch(/ON rezonate_processing_settings \(track_id\)/);
    });
  });

  // ──────────────────────────────────────────────────────────
  // updated_at trigger
  // ──────────────────────────────────────────────────────────
  describe('updated_at trigger', () => {
    it('creates or replaces set_updated_at() function', () => {
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.set_updated_at\(\)/);
    });

    it('trigger function sets NEW.updated_at = NOW()', () => {
      expect(sql).toMatch(/NEW\.updated_at = NOW\(\)/);
    });

    it('attaches trigger to rezonate_projects', () => {
      expect(sql).toMatch(/CREATE TRIGGER rezonate_projects_set_updated_at/);
      expect(sql).toMatch(/BEFORE UPDATE ON rezonate_projects/);
      expect(sql).toMatch(/EXECUTE FUNCTION public\.set_updated_at\(\)/);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Row Level Security
  // ──────────────────────────────────────────────────────────
  describe('row level security', () => {
    it('enables RLS on rezonate_projects', () => {
      expect(sql).toMatch(/ALTER TABLE rezonate_projects\s+ENABLE ROW LEVEL SECURITY/);
    });

    it('enables RLS on rezonate_tracks', () => {
      expect(sql).toMatch(/ALTER TABLE rezonate_tracks\s+ENABLE ROW LEVEL SECURITY/);
    });

    it('enables RLS on rezonate_patterns', () => {
      expect(sql).toMatch(/ALTER TABLE rezonate_patterns\s+ENABLE ROW LEVEL SECURITY/);
    });

    it('enables RLS on rezonate_audio_files', () => {
      expect(sql).toMatch(/ALTER TABLE rezonate_audio_files\s+ENABLE ROW LEVEL SECURITY/);
    });

    it('enables RLS on rezonate_processing_settings', () => {
      expect(sql).toMatch(/ALTER TABLE rezonate_processing_settings\s+ENABLE ROW LEVEL SECURITY/);
    });

    // rezonate_projects policies
    it('creates service_role full-access policy for rezonate_projects', () => {
      expect(sql).toMatch(/service_role_full_access_rezonate_projects/);
    });

    it('creates authenticated user ownership policy for rezonate_projects via user_id', () => {
      expect(sql).toMatch(/users_own_rezonate_projects/);
      expect(sql).toMatch(/user_id = auth\.uid\(\)/);
    });

    // rezonate_tracks policies
    it('creates service_role full-access policy for rezonate_tracks', () => {
      expect(sql).toMatch(/service_role_full_access_rezonate_tracks/);
    });

    it('creates authenticated user ownership policy for rezonate_tracks via project JOIN', () => {
      expect(sql).toMatch(/users_own_rezonate_tracks/);
    });

    // rezonate_patterns policies
    it('creates service_role full-access policy for rezonate_patterns', () => {
      expect(sql).toMatch(/service_role_full_access_rezonate_patterns/);
    });

    it('creates authenticated user ownership policy for rezonate_patterns via track->project JOIN', () => {
      expect(sql).toMatch(/users_own_rezonate_patterns/);
    });

    // rezonate_audio_files policies
    it('creates service_role full-access policy for rezonate_audio_files', () => {
      expect(sql).toMatch(/service_role_full_access_rezonate_audio_files/);
    });

    it('creates authenticated user ownership policy for rezonate_audio_files via project JOIN', () => {
      expect(sql).toMatch(/users_own_rezonate_audio_files/);
    });

    // rezonate_processing_settings policies
    it('creates service_role full-access policy for rezonate_processing_settings', () => {
      expect(sql).toMatch(/service_role_full_access_rezonate_processing_settings/);
    });

    it('creates authenticated user ownership policy for rezonate_processing_settings via track->project JOIN', () => {
      expect(sql).toMatch(/users_own_rezonate_processing_settings/);
    });

    it('RLS policies use auth.uid() for identity check', () => {
      expect(sql).toMatch(/auth\.uid\(\)/);
    });

    it('child-table RLS policies use EXISTS subqueries to verify project ownership', () => {
      expect(sql).toMatch(/EXISTS\s*\(\s*SELECT 1 FROM rezonate_projects/s);
    });

    it('grandchild-table RLS policies JOIN through tracks to verify project ownership', () => {
      expect(sql).toMatch(/FROM rezonate_tracks t\s+JOIN rezonate_projects p ON p\.id = t\.project_id/s);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Table comments
  // ──────────────────────────────────────────────────────────
  describe('table comments', () => {
    it('adds COMMENT on rezonate_projects', () => {
      expect(sql).toMatch(/COMMENT ON TABLE rezonate_projects IS/);
    });

    it('adds COMMENT on rezonate_tracks', () => {
      expect(sql).toMatch(/COMMENT ON TABLE rezonate_tracks IS/);
    });

    it('adds COMMENT on rezonate_patterns', () => {
      expect(sql).toMatch(/COMMENT ON TABLE rezonate_patterns IS/);
    });

    it('adds COMMENT on rezonate_audio_files', () => {
      expect(sql).toMatch(/COMMENT ON TABLE rezonate_audio_files IS/);
    });

    it('adds COMMENT on rezonate_processing_settings', () => {
      expect(sql).toMatch(/COMMENT ON TABLE rezonate_processing_settings IS/);
    });
  });
});
