'use strict';

/**
 * Governance gate test for migration
 * 20260714160000_ledger_stripe_payment_intent_unique.sql
 *
 * Tests static SQL content only — no live Supabase connection required.
 * Satisfies the hdi-governance-gate.yml requirement: every new .sql migration
 * must have a corresponding test in tests/migrations/<version>.test.js
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20260714160000_ledger_stripe_payment_intent_unique.sql';

describe('Migration 20260714160000 – Ledger Stripe Payment Intent Unique Index', () => {
  let sql;

  beforeAll(() => {
    sql = readMigration(MIGRATION_FILE);
  });

  describe('baseline', () => {
    it('file is non-empty', () => {
      expect(sql.trim().length).toBeGreaterThan(0);
    });

    it('drops the old non-unique lookup index', () => {
      expect(sql).toMatch(/drop index if exists idx_ledger_stripe_payment\b/i);
    });

    it('creates a UNIQUE index on stripe_payment_intent_id', () => {
      expect(sql).toMatch(
        /create unique index if not exists idx_ledger_stripe_payment_intent_unique\s*\n?\s*on ledger\s*\(\s*stripe_payment_intent_id\s*\)/i
      );
    });
  });

  describe('idempotency of the migration itself', () => {
    it('uses IF EXISTS / IF NOT EXISTS so re-running it is a no-op', () => {
      expect(sql).toMatch(/drop index if exists/i);
      expect(sql).toMatch(/create unique index if not exists/i);
    });
  });

  describe('does not touch unrelated ledger data or columns', () => {
    it('contains no INSERT, UPDATE, or DELETE statement', () => {
      expect(sql.toUpperCase()).not.toMatch(/\bINSERT\b/);
      expect(sql.toUpperCase()).not.toMatch(/\bUPDATE\b/);
      expect(sql.toUpperCase()).not.toMatch(/\bDELETE\b/);
    });

    it('contains no ALTER TABLE', () => {
      expect(sql.toUpperCase()).not.toMatch(/ALTER TABLE/);
    });
  });

  describe('state machine', () => {
    it('introduces no enum or state-machine transitions requiring approval', () => {
      expect(sql.toUpperCase()).not.toMatch(/CREATE TYPE/);
      expect(sql.toUpperCase()).not.toMatch(/\bENUM\b/);
    });
  });
});
