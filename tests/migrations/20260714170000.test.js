'use strict';

/**
 * Governance gate test for migration
 * 20260714170000_billing_engine_stats_rpc.sql
 *
 * Tests static SQL content only — no live Supabase connection required.
 * Satisfies the hdi-governance-gate.yml requirement: every new .sql migration
 * must have a corresponding test in tests/migrations/<version>.test.js
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20260714170000_billing_engine_stats_rpc.sql';

describe('Migration 20260714170000 – Billing Engine Stats RPC', () => {
  let sql;

  beforeAll(() => {
    sql = readMigration(MIGRATION_FILE);
  });

  describe('baseline', () => {
    it('file is non-empty', () => {
      expect(sql.trim().length).toBeGreaterThan(0);
    });

    it('creates the get_billing_engine_stats function', () => {
      expect(sql).toMatch(/create or replace function public\.get_billing_engine_stats\(\)/i);
    });

    it('reads from the ledger table, not a fabricated one', () => {
      expect(sql).toMatch(/from public\.ledger/i);
    });
  });

  describe('access control', () => {
    it('revokes PUBLIC execute before granting to specific roles', () => {
      const revokeIdx = sql.search(/revoke all on function public\.get_billing_engine_stats/i);
      const grantIdx = sql.search(/grant execute on function public\.get_billing_engine_stats/i);
      expect(revokeIdx).toBeGreaterThan(-1);
      expect(grantIdx).toBeGreaterThan(revokeIdx);
    });

    it('grants execute to service_role and authenticated', () => {
      expect(sql).toMatch(/grant execute on function public\.get_billing_engine_stats\(\) to service_role/i);
      expect(sql).toMatch(/grant execute on function public\.get_billing_engine_stats\(\) to authenticated/i);
    });
  });

  describe('does not write to or fabricate ledger data', () => {
    it('contains no INSERT, UPDATE, or DELETE statement', () => {
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
