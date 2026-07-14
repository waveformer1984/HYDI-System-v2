'use strict';

/**
 * Governance gate test for migration 20260623120000_push_subscriptions.sql
 *
 * Tests static SQL content only — no live Supabase connection required.
 * Satisfies the hdi-governance-gate.yml requirement: every new .sql migration
 * must have a corresponding test in tests/migrations/<version>.test.js
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20260623120000_push_subscriptions.sql';

describe('Migration 20260623120000 – Push Subscriptions', () => {
  let sql;

  beforeAll(() => {
    sql = readMigration(MIGRATION_FILE);
  });

  describe('baseline', () => {
    it('file is non-empty', () => {
      expect(sql.trim().length).toBeGreaterThan(0);
    });

    it('creates public.push_subscriptions idempotently', () => {
      expect(sql).toMatch(/create table if not exists public\.push_subscriptions/i);
    });

    it('endpoint is unique (one subscription per device endpoint)', () => {
      expect(sql).toMatch(/endpoint\s+text not null unique/i);
    });
  });

  describe('indexes', () => {
    it('indexes on active and device_id', () => {
      expect(sql).toMatch(/create index if not exists idx_push_active\s+on public\.push_subscriptions\(active\)/i);
      expect(sql).toMatch(/create index if not exists idx_push_device_id\s+on public\.push_subscriptions\(device_id\)/i);
    });
  });

  describe('row level security', () => {
    it('enables RLS', () => {
      expect(sql).toMatch(/alter table public\.push_subscriptions enable row level security/i);
    });

    it('restricts access to service_role only', () => {
      expect(sql).toMatch(/create policy "service_role_all" on public\.push_subscriptions\s*\n\s*for all\s*\n\s*to service_role/i);
    });

    it('drops the policy before recreating it (idempotent re-run)', () => {
      const dropIdx = sql.search(/drop policy if exists "service_role_all"/i);
      const createIdx = sql.search(/create policy "service_role_all"/i);
      expect(dropIdx).toBeGreaterThan(-1);
      expect(createIdx).toBeGreaterThan(dropIdx);
    });
  });

  describe('state machine', () => {
    it('introduces no enum or state-machine transitions requiring approval', () => {
      expect(sql.toUpperCase()).not.toMatch(/CREATE TYPE/);
      expect(sql.toUpperCase()).not.toMatch(/\bENUM\b/);
    });
  });
});
