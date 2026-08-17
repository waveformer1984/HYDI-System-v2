'use strict';

/**
 * Governance gate test for migration 20260714150000_promote_action_type_policy.sql
 *
 * Tests static SQL content only — no live Supabase connection required.
 * Satisfies the hdi-governance-gate.yml requirement: every new .sql migration
 * must have a corresponding test in tests/migrations/<version>.test.js
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20260714150000_promote_action_type_policy.sql';

describe('Migration 20260714150000 – Promote Action-Type-Tiered Policy', () => {
  let sql;

  beforeAll(() => {
    sql = readMigration(MIGRATION_FILE);
  });

  describe('baseline', () => {
    it('file is non-empty', () => {
      expect(sql.trim().length).toBeGreaterThan(0);
    });

    it('inserts into public.policies', () => {
      expect(sql).toMatch(/insert into public\.policies/i);
    });

    it('is version 2 — does not collide with the seed policy (version 1)', () => {
      expect(sql).toMatch(/^\s*2,\s*$/im);
    });

    it('is active', () => {
      expect(sql).toMatch(/true\s*$/im);
      expect(sql).not.toMatch(/,\s*false\s*$/im);
    });
  });

  describe('does not touch the dangerous seed policy', () => {
    it('contains no UPDATE or DELETE statement', () => {
      expect(sql.toUpperCase()).not.toMatch(/\bUPDATE\b/);
      expect(sql.toUpperCase()).not.toMatch(/\bDELETE\b/);
    });

    it('the WHERE NOT EXISTS guard checks version 2, not version 1', () => {
      // The only operational reference to a specific version number must be
      // the idempotency guard on this migration's own row (version 2) —
      // "baseline-v1" appearing in the human-readable description column is
      // fine context, not an operational touch on that row.
      expect(sql).toMatch(/where stream is null and version = 2/i);
      expect(sql).not.toMatch(/where stream is null and version = 1/i);
    });
  });

  describe('risk tiers', () => {
    it('auto-approves read-only and internal action types', () => {
      expect(sql).toMatch(/"action_type":\s*{\s*"in":\s*\["fetch_data",\s*"create_task",\s*"schedule_event"\]\s*}/);
      expect(sql).toMatch(/"then":\s*"approve"/);
    });

    it('escalates external and write action types', () => {
      expect(sql).toMatch(/"action_type":\s*{\s*"in":\s*\["update_database",\s*"send_email"\]\s*}/);
      expect(sql).toMatch(/"then":\s*"escalate"/);
    });

    it('never auto-rejects — default is escalate, not reject', () => {
      expect(sql).toMatch(/"default":\s*"escalate"/);
      expect(sql).not.toMatch(/"then":\s*"reject"/);
      expect(sql).not.toMatch(/"default":\s*"reject"/);
    });
  });

  describe('idempotency', () => {
    it('guards the insert with WHERE NOT EXISTS rather than a bare INSERT or ON CONFLICT', () => {
      // ON CONFLICT (stream, version) alone is insufficient here — this row
      // also violates idx_policies_one_active_per_stream on a second run,
      // and Postgres doesn't suppress a violation of a constraint other
      // than the declared arbiter. WHERE NOT EXISTS was verified against a
      // real Postgres instance to be idempotent across repeated runs.
      expect(sql).toMatch(/where not exists\s*\(\s*select 1 from public\.policies where stream is null and version = 2\s*\)/i);
    });
  });

  describe('state machine', () => {
    it('introduces no enum or state-machine transitions requiring approval', () => {
      expect(sql.toUpperCase()).not.toMatch(/CREATE TYPE/);
      expect(sql.toUpperCase()).not.toMatch(/\bENUM\b/);
    });
  });
});
