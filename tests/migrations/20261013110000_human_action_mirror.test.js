/**
 * Migration test: human_action_mirror table.
 * Static assertions against the migration SQL — no database connection.
 * Behavioural coverage lives in tests/unit/human-action-mirror.test.js.
 */
'use strict';

const { readMigration } = require('./helpers');

const SQL = readMigration('20261013110000_human_action_mirror.sql');

describe('human_action_mirror migration — static checks (no database)', () => {
  it('creates the mirror table idempotently with the action id as primary key', () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS human_action_mirror/);
    expect(SQL).toMatch(/id TEXT PRIMARY KEY/);
  });

  it('carries the queryable projection columns plus the audit trail', () => {
    for (const col of ['blocker_key', 'status', 'boundary JSONB', 'verifier JSONB',
      'verification JSONB', 'resolver JSONB', 'transitions JSONB',
      'action_created_at', 'action_updated_at', 'mirrored_at']) {
      expect(SQL).toContain(col);
    }
  });

  it('indexes the two obvious query shapes', () => {
    expect(SQL).toMatch(/CREATE INDEX IF NOT EXISTS human_action_mirror_status_idx/);
    expect(SQL).toMatch(/CREATE INDEX IF NOT EXISTS human_action_mirror_blocker_key_idx/);
  });

  it('enables RLS and restricts to service_role — the heidi_events trust boundary', () => {
    expect(SQL).toMatch(/ALTER TABLE human_action_mirror ENABLE ROW LEVEL SECURITY/);
    expect(SQL).toMatch(/TO service_role/);
  });

  it('is non-destructive — no drops of tables or columns', () => {
    expect(SQL).not.toMatch(/DROP TABLE/i);
    expect(SQL).not.toMatch(/DROP COLUMN/i);
    expect(SQL).not.toMatch(/DELETE FROM/i);
    expect(SQL).not.toMatch(/TRUNCATE/i);
  });
});
