/**
 * Migration test: heidi_decision_bounds live-authority columns.
 * Static assertions against the migration SQL — no database connection.
 * Behavioural coverage of the gate lives in
 * tests/unit/authority-bounds.test.js.
 */
'use strict';

const { readMigration } = require('./helpers');

const SQL = readMigration('20261013100000_heidi_decision_bounds_live.sql');

describe('heidi_decision_bounds live-authority migration — static checks (no database)', () => {
  it('adds the three live-authority columns, idempotently', () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS unattended_enabled BOOLEAN NOT NULL DEFAULT true/i);
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS denied_resolvers TEXT\[\] NOT NULL DEFAULT '\{\}'/i);
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS denied_capabilities TEXT\[\] NOT NULL DEFAULT '\{\}'/i);
  });

  it('is additive only — no drops, deletes, or truncates', () => {
    expect(SQL).not.toMatch(/DROP TABLE/i);
    expect(SQL).not.toMatch(/DROP COLUMN/i);
    expect(SQL).not.toMatch(/DELETE FROM/i);
    expect(SQL).not.toMatch(/TRUNCATE/i);
    // The only DROP is the idempotent trigger replacement, which is safe.
    expect(SQL).not.toMatch(/DROP (?!TRIGGER IF EXISTS)/i);
  });

  it('defaults preserve the previous implicit behaviour (enabled, nothing denied)', () => {
    // New columns must default so pre-migration rows are unchanged in intent.
    expect(SQL).toMatch(/unattended_enabled BOOLEAN NOT NULL DEFAULT true/);
  });

  it('keeps updated_at honest via a search_path-pinned trigger', () => {
    expect(SQL).toMatch(/SET search_path = pg_catalog/);
    expect(SQL).toMatch(/CREATE TRIGGER heidi_decision_bounds_touch/);
    expect(SQL).toMatch(/NEW\.updated_at := now\(\)/);
  });
});
