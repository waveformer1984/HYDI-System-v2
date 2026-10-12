/**
 * Migration test: heidi_operator_lease — durable single-holder claim.
 * Static assertions against the migration SQL only — no database
 * connection.
 */
'use strict';

const { readMigration } = require('./helpers');

const SQL = readMigration('20261012173000_heidi_operator_lease.sql');

describe('heidi_operator_lease migration — static checks (no database)', () => {
  it('creates the lease table idempotently', () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.heidi_operator_lease/i);
  });

  it('carries the columns the claim protocol needs', () => {
    for (const col of ['operator', 'owner_id', 'claimed_at', 'heartbeat_at', 'expires_at', 'released_at']) {
      expect(SQL).toMatch(new RegExp(`\\b${col}\\b`, 'i'));
    }
  });

  it('enforces one lease row per operator with a unique index', () => {
    expect(SQL).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS \w+\s+ON public\.heidi_operator_lease \(operator\)/i);
  });

  it('indexes expires_at so stale-lease scans stay cheap', () => {
    expect(SQL).toMatch(/CREATE INDEX IF NOT EXISTS \w+\s+ON public\.heidi_operator_lease \(expires_at\)/i);
  });

  it('enables RLS with a service_role-only policy', () => {
    expect(SQL).toMatch(/ALTER TABLE public\.heidi_operator_lease ENABLE ROW LEVEL SECURITY/i);
    expect(SQL).toMatch(/CREATE POLICY \w+ ON public\.heidi_operator_lease\s+TO service_role USING \(true\) WITH CHECK \(true\)/i);
  });

  it('touches no existing table or row', () => {
    expect(SQL).not.toMatch(/ALTER TABLE public\.(?!heidi_operator_lease)/i);
    expect(SQL).not.toMatch(/UPDATE public\./i);
    expect(SQL).not.toMatch(/INSERT INTO/i);
    expect(SQL).not.toMatch(/DELETE FROM/i);
    expect(SQL).not.toMatch(/DROP TABLE/i);
  });
});
