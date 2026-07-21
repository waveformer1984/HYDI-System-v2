'use strict';

/**
 * Governance gate test for migration
 * 20260721013000_remove_ledger_authenticated_read_policy.sql
 *
 * Tests static SQL content only — no live Supabase connection required.
 * Satisfies the hdi-governance-gate.yml requirement: every new .sql migration
 * must have a corresponding test in tests/migrations/<version>.test.js
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20260721013000_remove_ledger_authenticated_read_policy.sql';

describe('Migration 20260721013000 – Remove ledger authenticated read policy', () => {
  let sql;

  beforeAll(() => {
    sql = readMigration(MIGRATION_FILE);
  });

  it('file is non-empty', () => {
    expect(sql.trim().length).toBeGreaterThan(0);
  });

  it('drops the unscoped authenticated read-only policy on ledger', () => {
    expect(sql).toMatch(/drop policy if exists "authenticated users read-only" on ledger/i);
  });

  it('does not touch the service-role policy', () => {
    expect(sql).not.toMatch(/drop policy.*service role/i);
  });

  it('does not re-grant broad SELECT access to any non-service role', () => {
    expect(sql).not.toMatch(/create policy[\s\S]*to authenticated/i);
  });
});
