'use strict';

/**
 * Governance gate test for migration 20260818120000_reconcile_notifications_schema.sql
 *
 * Verifies that the corrective migration:
 * 1. Adds all July-schema columns using ADD COLUMN IF NOT EXISTS
 * 2. Creates the July indexes using CREATE INDEX IF NOT EXISTS
 * 3. Replaces April RLS policies with the July unified policy
 * 4. Does not drop any April columns (backward compatible)
 * 5. Is idempotent (all statements use IF NOT EXISTS or DROP IF EXISTS)
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20260818120000_reconcile_notifications_schema.sql';

describe('Migration 20260818120000 – Reconcile notifications schema', () => {
  let sql;

  beforeAll(() => {
    sql = readMigration(MIGRATION_FILE);
  });

  it('file is non-empty', () => {
    expect(sql.trim().length).toBeGreaterThan(0);
  });

  it('adds all July-schema columns with ADD COLUMN IF NOT EXISTS', () => {
    const julyColumns = ['category', 'severity', 'title', 'body', 'device_id', 'read_at', 'delivered_at'];
    julyColumns.forEach((col) => {
      expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\s`, 'i'));
    });
  });

  it('creates July indexes with IF NOT EXISTS', () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public\.notifications \(device_id, read_at\)/i);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_notifications_category ON public\.notifications \(category\)/i);
  });

  it('drops April RLS policies before creating the July policy', () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS "notifications_select_service_role"/i);
    expect(sql).toMatch(/DROP POLICY IF EXISTS "notifications_insert_service_role"/i);
    expect(sql).toMatch(/DROP POLICY IF EXISTS "notifications_update_service_role"/i);
  });

  it('creates the July unified service_role policy', () => {
    expect(sql).toMatch(/CREATE POLICY "notifications_service_all" ON public\.notifications/i);
    expect(sql).toMatch(/FOR ALL TO service_role/i);
  });

  it('does not drop any April columns (backward compatible)', () => {
    // Strip comments before checking — the header comment mentions "does not drop columns"
    const sqlOnly = sql.replace(/--[^\n]*/g, '');
    expect(sqlOnly).not.toMatch(/DROP COLUMN/i);
  });

  it('enables RLS idempotently', () => {
    expect(sql).toMatch(/ALTER TABLE public\.notifications ENABLE ROW LEVEL SECURITY/i);
  });

  it('all ALTER TABLE statements use IF NOT EXISTS for columns', () => {
    const alterStatements = sql.match(/ALTER TABLE public\.notifications ADD COLUMN[^\n]*/gi) || [];
    expect(alterStatements.length).toBe(7);
    alterStatements.forEach((stmt) => expect(stmt).toMatch(/IF NOT EXISTS/i));
  });

  it('is idempotent (all DDL uses IF NOT EXISTS or DROP IF EXISTS)', () => {
    // No bare CREATE POLICY without a preceding DROP
    const createPolicyStatements = sql.match(/CREATE POLICY/gi) || [];
    expect(createPolicyStatements.length).toBe(1);
    // The one CREATE POLICY is preceded by a DROP POLICY IF EXISTS
    expect(sql).toMatch(/DROP POLICY IF EXISTS "notifications_service_all"/i);
  });
});
