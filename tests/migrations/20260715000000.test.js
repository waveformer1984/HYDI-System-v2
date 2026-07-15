'use strict';

/**
 * Governance gate test for migration
 * 20260715000000_ensure_webhook_events_claim_function.sql
 *
 * Tests static SQL content only — no live Supabase connection required.
 * Live behavior (idempotency across both the fresh and tracked-migration
 * starting shapes, and claim_webhook_event's duplicate-rejection semantics)
 * was verified manually against a local Postgres 16 instance before this
 * migration was added; see the commit/PR description for that transcript.
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20260715000000_ensure_webhook_events_claim_function.sql';

describe('Migration 20260715000000 – Ensure webhook_events / claim_webhook_event', () => {
  let sql;

  beforeAll(() => {
    sql = readMigration(MIGRATION_FILE);
  });

  it('file is non-empty', () => {
    expect(sql.trim().length).toBeGreaterThan(0);
  });

  describe('additive-only', () => {
    it('contains no DROP TABLE', () => {
      expect(sql.toUpperCase()).not.toMatch(/DROP TABLE/);
    });

    it('every CREATE TABLE / CREATE INDEX is guarded with IF NOT EXISTS', () => {
      const createTableMatches = sql.match(/create table(?! if not exists)/gi) || [];
      const createIndexMatches = sql.match(/create (unique )?index(?! if not exists| concurrently)/gi) || [];
      expect(createTableMatches).toEqual([]);
      expect(createIndexMatches).toEqual([]);
    });

    it('every ADD COLUMN is guarded with IF NOT EXISTS', () => {
      const bareAddColumn = sql.match(/add column(?! if not exists)/gi) || [];
      expect(bareAddColumn).toEqual([]);
    });

    it('does not touch event_type or payload columns beyond relaxing NOT NULL', () => {
      expect(sql).not.toMatch(/drop column/i);
      expect(sql).not.toMatch(/rename column/i);
    });
  });

  describe('claim_webhook_event', () => {
    it('defines the function tracked history was missing', () => {
      expect(sql).toMatch(/create or replace function public\.claim_webhook_event\(p_event_id text, p_type text\)/i);
    });

    it('rejects duplicates via ON CONFLICT DO NOTHING on event_id', () => {
      expect(sql).toMatch(/on conflict \(event_id\) do nothing/i);
    });

    it('is SECURITY DEFINER with a locked search_path', () => {
      expect(sql).toMatch(/security definer/i);
      expect(sql).toMatch(/set search_path = public, pg_temp/i);
    });

    it('grants execute only to service_role, not public', () => {
      expect(sql).toMatch(/revoke all on function public\.claim_webhook_event\(text, text\) from public/i);
      expect(sql).toMatch(/grant execute on function public\.claim_webhook_event\(text, text\) to service_role/i);
    });
  });

  describe('event_id uniqueness', () => {
    it('creates a unique index on event_id for ON CONFLICT to target', () => {
      expect(sql).toMatch(/create unique index if not exists idx_webhook_events_event_id_unique\s+on public\.webhook_events\(event_id\)/i);
    });
  });

  describe('state machine', () => {
    it('introduces no enum or state-machine transitions requiring approval', () => {
      expect(sql.toUpperCase()).not.toMatch(/CREATE TYPE/);
      expect(sql.toUpperCase()).not.toMatch(/\bENUM\b/);
    });
  });
});
