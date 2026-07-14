'use strict';

/**
 * Governance gate test for migration
 * 20260714160000_deprecate_stale_payout_functions.sql
 *
 * Tests static SQL content only — no live Supabase connection required.
 * Satisfies the hdi-governance-gate.yml requirement: every new .sql migration
 * must have a corresponding test in tests/migrations/<version>.test.js
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20260714160000_deprecate_stale_payout_functions.sql';

describe('Migration 20260714160000 – Deprecate stale payout functions', () => {
  let sql;

  beforeAll(() => {
    sql = readMigration(MIGRATION_FILE);
  });

  it('file is non-empty', () => {
    expect(sql.trim().length).toBeGreaterThan(0);
  });

  describe('process_payout', () => {
    it('replaces the function body', () => {
      expect(sql).toMatch(/create or replace function process_payout\(p_payout_id uuid\)/i);
    });

    it('raises instead of fabricating a fake transfer id', () => {
      expect(sql).toMatch(/raise exception 'process_payout\(\) is deprecated/i);
      expect(sql).not.toMatch(/stripe_transfer_id\s*:=/i);
      expect(sql).not.toMatch(/status\s*=\s*'completed'/i);
    });

    it('points callers at the real implementation', () => {
      expect(sql).toMatch(/stripe-transfer-payout/);
    });
  });

  describe('generate_monthly_payouts', () => {
    it('replaces the function body', () => {
      expect(sql).toMatch(/create or replace function generate_monthly_payouts\(\)/i);
    });

    it('raises instead of querying removed columns', () => {
      expect(sql).toMatch(/raise exception 'generate_monthly_payouts\(\) is deprecated/i);
      // Only the function body matters here -- the preceding comment block
      // legitimately names the removed column as an explanation.
      const body = sql.slice(sql.search(/create or replace function generate_monthly_payouts/i));
      expect(body).not.toMatch(/stripe_customer_id/i);
      expect(body.toLowerCase()).not.toMatch(/from ledger/);
    });

    it('points callers at the real implementation', () => {
      expect(sql).toMatch(/monthly-payout-calculation/);
    });
  });

  describe('state machine', () => {
    it('introduces no enum or state-machine transitions requiring approval', () => {
      expect(sql.toUpperCase()).not.toMatch(/CREATE TYPE/);
      expect(sql.toUpperCase()).not.toMatch(/\bENUM\b/);
    });
  });

  describe('idempotency', () => {
    it('uses CREATE OR REPLACE FUNCTION, safe to run repeatedly', () => {
      expect(sql.toLowerCase().match(/create or replace function/g)?.length).toBe(2);
    });
  });
});
