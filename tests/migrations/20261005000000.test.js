/**
 * Migration test: heidi_proposal_authorization — consume-once bridge.
 * Static assertions against the migration SQL only — no database
 * connection.
 */
'use strict';

const { readMigration } = require('./helpers');

const SQL = readMigration('20261005000000_heidi_proposal_authorization.sql');

describe('heidi_proposal_authorization migration — static checks (no database)', () => {
  it('adds authorization_consumed_at to heidi_action_proposals idempotently', () => {
    expect(SQL).toMatch(/ALTER TABLE public\.heidi_action_proposals\s+ADD COLUMN IF NOT EXISTS authorization_consumed_at timestamptz/i);
  });

  it('does not alter proposal status or approval evidence columns', () => {
    // The bridge is a marker column, not a status change: approved stays
    // 'approved'; decided_by/decided_at/approved_hash are untouched.
    expect(SQL).not.toMatch(/DROP COLUMN/i);
    expect(SQL).not.toMatch(/ALTER COLUMN/i);
    expect(SQL).not.toMatch(/CHECK \(/i);
  });

  it('touches no other table and no rows', () => {
    expect(SQL).not.toMatch(/CREATE TABLE/i);
    expect(SQL).not.toMatch(/UPDATE public\./i);
    expect(SQL).not.toMatch(/INSERT INTO/i);
    expect(SQL).not.toMatch(/DELETE FROM/i);
  });
});
