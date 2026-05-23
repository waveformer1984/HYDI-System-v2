'use strict';

/**
 * Governance gate test for migration 20260522000002_rezonate_collab.sql
 *
 * Tests static SQL content only — no live Supabase connection required.
 * Satisfies the hdi-governance-gate.yml requirement: every new .sql migration
 * must have a corresponding test in tests/migrations/<version>.test.js
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20260522000002_rezonate_collab.sql';

describe('Migration 20260522000002 – Rezonate Collaboration Schema', () => {
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

    it('contains all three expected table names', () => {
      expect(sql).toMatch(/rezonate_collab_sessions/);
      expect(sql).toMatch(/rezonate_collab_contributions/);
      expect(sql).toMatch(/rezonate_collab_events/);
    });
  });

  // ──────────────────────────────────────────────────────────
  // rezonate_collab_sessions table
  // ──────────────────────────────────────────────────────────
  describe('rezonate_collab_sessions table', () => {
    it('creates rezonate_collab_sessions with IF NOT EXISTS guard', () => {
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS rezonate_collab_sessions/);
    });

    it('defines id as UUID primary key with gen_random_uuid()', () => {
      expect(sql).toMatch(/id\s+UUID\s+PRIMARY KEY DEFAULT gen_random_uuid\(\)/);
    });

    it('defines project_id referencing rezonate_projects with CASCADE delete', () => {
      expect(sql).toMatch(/project_id\s+UUID.*REFERENCES rezonate_projects\(id\) ON DELETE CASCADE/s);
    });

    it('defines name TEXT NOT NULL', () => {
      expect(sql).toMatch(/name\s+TEXT\s+NOT NULL/);
    });

    it("defines status CHECK constraint covering 'open', 'locked', 'closed'", () => {
      expect(sql).toMatch(/status.*CHECK.*status IN.*'open'.*'locked'.*'closed'/s);
    });

    it("defines status DEFAULT 'open'", () => {
      expect(sql).toMatch(/status.*DEFAULT 'open'/s);
    });

    it('defines max_participants INT DEFAULT 8', () => {
      expect(sql).toMatch(/max_participants\s+INT.*DEFAULT 8/s);
    });

    it('defines created_by referencing auth.users', () => {
      expect(sql).toMatch(/created_by\s+UUID.*REFERENCES auth\.users\(id\)/s);
    });

    it('defines created_at TIMESTAMPTZ DEFAULT NOW()', () => {
      expect(sql).toMatch(/created_at\s+TIMESTAMPTZ.*DEFAULT NOW\(\)/s);
    });

    it('defines closed_at TIMESTAMPTZ', () => {
      expect(sql).toMatch(/closed_at\s+TIMESTAMPTZ/);
    });
  });

  // ──────────────────────────────────────────────────────────
  // rezonate_collab_contributions table
  // ──────────────────────────────────────────────────────────
  describe('rezonate_collab_contributions table', () => {
    it('creates rezonate_collab_contributions with IF NOT EXISTS guard', () => {
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS rezonate_collab_contributions/);
    });

    it('defines session_id referencing rezonate_collab_sessions with CASCADE delete', () => {
      expect(sql).toMatch(/session_id\s+UUID.*REFERENCES rezonate_collab_sessions\(id\) ON DELETE CASCADE/s);
    });

    it('defines user_id referencing auth.users', () => {
      expect(sql).toMatch(/user_id\s+UUID.*REFERENCES auth\.users\(id\)/s);
    });

    it('defines display_name TEXT NOT NULL', () => {
      expect(sql).toMatch(/display_name\s+TEXT\s+NOT NULL/);
    });

    it("defines pad_indices INTEGER[] DEFAULT '{}'", () => {
      expect(sql).toMatch(/pad_indices\s+INTEGER\[\]\s+DEFAULT '{}'/);
    });

    it('defines event_count INT DEFAULT 0', () => {
      expect(sql).toMatch(/event_count\s+INT.*DEFAULT 0/s);
    });

    it('defines joined_at TIMESTAMPTZ DEFAULT NOW()', () => {
      expect(sql).toMatch(/joined_at\s+TIMESTAMPTZ.*DEFAULT NOW\(\)/s);
    });

    it('defines left_at TIMESTAMPTZ (nullable)', () => {
      expect(sql).toMatch(/left_at\s+TIMESTAMPTZ/);
    });

    it('defines UNIQUE constraint on (session_id, user_id)', () => {
      expect(sql).toMatch(/UNIQUE\s*\(\s*session_id,\s*user_id\s*\)/);
    });
  });

  // ──────────────────────────────────────────────────────────
  // rezonate_collab_events table
  // ──────────────────────────────────────────────────────────
  describe('rezonate_collab_events table', () => {
    it('creates rezonate_collab_events with IF NOT EXISTS guard', () => {
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS rezonate_collab_events/);
    });

    it('defines session_id referencing rezonate_collab_sessions with CASCADE delete', () => {
      expect(sql).toMatch(/rezonate_collab_events[\s\S]*?session_id\s+UUID.*REFERENCES rezonate_collab_sessions\(id\) ON DELETE CASCADE/);
    });

    it('defines user_id referencing auth.users', () => {
      expect(sql).toMatch(/rezonate_collab_events[\s\S]*?user_id\s+UUID.*REFERENCES auth\.users\(id\)/);
    });

    it('defines event_type TEXT NOT NULL', () => {
      expect(sql).toMatch(/event_type\s+TEXT\s+NOT NULL/);
    });

    it("defines event_type CHECK constraint covering all required event types", () => {
      expect(sql).toMatch(/event_type IN[\s\S]*?'pad_record'[\s\S]*?'pad_clear'[\s\S]*?'pad_loop_toggle'[\s\S]*?'bpm_change'[\s\S]*?'play'[\s\S]*?'stop'/);
    });

    it("defines payload JSONB NOT NULL DEFAULT '{}'", () => {
      expect(sql).toMatch(/payload\s+JSONB\s+NOT NULL DEFAULT '{}'/);
    });

    it('defines created_at TIMESTAMPTZ DEFAULT NOW()', () => {
      expect(sql).toMatch(/rezonate_collab_events[\s\S]*?created_at\s+TIMESTAMPTZ.*DEFAULT NOW\(\)/);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Indexes
  // ──────────────────────────────────────────────────────────
  describe('indexes', () => {
    it('creates index on rezonate_collab_contributions(session_id)', () => {
      expect(sql).toMatch(/idx_rezonate_collab_contributions_session_id/);
      expect(sql).toMatch(/ON rezonate_collab_contributions \(session_id\)/);
    });

    it('creates index on rezonate_collab_contributions(user_id)', () => {
      expect(sql).toMatch(/idx_rezonate_collab_contributions_user_id/);
      expect(sql).toMatch(/ON rezonate_collab_contributions \(user_id\)/);
    });

    it('creates index on rezonate_collab_events(session_id)', () => {
      expect(sql).toMatch(/idx_rezonate_collab_events_session_id/);
      expect(sql).toMatch(/ON rezonate_collab_events \(session_id\)/);
    });

    it('creates index on rezonate_collab_events(created_at)', () => {
      expect(sql).toMatch(/idx_rezonate_collab_events_created_at/);
      expect(sql).toMatch(/ON rezonate_collab_events \(created_at\)/);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Row Level Security
  // ──────────────────────────────────────────────────────────
  describe('row level security', () => {
    it('enables RLS on rezonate_collab_sessions', () => {
      expect(sql).toMatch(/ALTER TABLE rezonate_collab_sessions\s+ENABLE ROW LEVEL SECURITY/);
    });

    it('enables RLS on rezonate_collab_contributions', () => {
      expect(sql).toMatch(/ALTER TABLE rezonate_collab_contributions\s+ENABLE ROW LEVEL SECURITY/);
    });

    it('enables RLS on rezonate_collab_events', () => {
      expect(sql).toMatch(/ALTER TABLE rezonate_collab_events\s+ENABLE ROW LEVEL SECURITY/);
    });

    it('creates service_role full-access policy for rezonate_collab_sessions', () => {
      expect(sql).toMatch(/service_role_full_access_rezonate_collab_sessions/);
    });

    it('creates service_role full-access policy for rezonate_collab_contributions', () => {
      expect(sql).toMatch(/service_role_full_access_rezonate_collab_contributions/);
    });

    it('creates service_role full-access policy for rezonate_collab_events', () => {
      expect(sql).toMatch(/service_role_full_access_rezonate_collab_events/);
    });

    it('RLS session read policy uses EXISTS check through contributions', () => {
      expect(sql).toMatch(/EXISTS[\s\S]*?FROM rezonate_collab_contributions/);
    });

    it('RLS events insert policy restricts to authenticated users via user_id = auth.uid()', () => {
      expect(sql).toMatch(/users_insert_rezonate_collab_events/);
      expect(sql).toMatch(/user_id = auth\.uid\(\)/);
    });

    it('authenticated insert policy for sessions checks created_by = auth.uid()', () => {
      expect(sql).toMatch(/created_by = auth\.uid\(\)/);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Table comments
  // ──────────────────────────────────────────────────────────
  describe('table comments', () => {
    it('adds COMMENT on rezonate_collab_sessions', () => {
      expect(sql).toMatch(/COMMENT ON TABLE rezonate_collab_sessions IS/);
    });

    it('adds COMMENT on rezonate_collab_contributions', () => {
      expect(sql).toMatch(/COMMENT ON TABLE rezonate_collab_contributions IS/);
    });

    it('adds COMMENT on rezonate_collab_events', () => {
      expect(sql).toMatch(/COMMENT ON TABLE rezonate_collab_events IS/);
    });
  });
});
