/**
 * Migration test: heidi_action_proposals — governed proposal store.
 *
 * Static assertions against the migration SQL only — no database
 * connection. The migration is intentionally NOT applied to the active
 * local database in this slice.
 */

'use strict';

const { readMigration } = require('./helpers');

const SQL = readMigration('20261002000001_heidi_action_proposals.sql');

describe('heidi_action_proposals migration — static checks (no database)', () => {
  it('creates public.heidi_action_proposals idempotently', () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.heidi_action_proposals/);
  });

  it('has uuid PK, version, and goal linkage for the mission chain', () => {
    expect(SQL).toMatch(/id\s+uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/);
    expect(SQL).toMatch(/version\s+integer NOT NULL DEFAULT 1/);
    expect(SQL).toMatch(/goal_id\s+uuid REFERENCES public\.heidi_goals\(id\)/);
  });

  it('binds approval to params_hash and records decision provenance', () => {
    for (const c of ['params_hash', 'approved_hash', 'decided_by', 'decided_at']) {
      expect(SQL).toContain(c);
    }
  });

  it('carries the plain-language disclosure fields', () => {
    for (const c of ['title', 'reason', 'expected_effects', 'risks',
      'prerequisites', 'rollback', 'reversible', 'expires_at']) {
      expect(SQL).toContain(c);
    }
  });

  it('status CHECK is consume-once lifecycle only — no execution states', () => {
    for (const s of ['pending', 'approved', 'rejected', 'expired', 'retracted']) {
      expect(SQL).toContain(`'${s}'`);
    }
    // Execution truth lives in heidi_missions, not here.
    expect(SQL).not.toMatch(/'running'|'succeeded'|'failed'/);
  });

  it('dedupes pending proposals per (producer_key, params_hash)', () => {
    expect(SQL).toMatch(/UNIQUE INDEX[\s\S]*\(producer_key, params_hash\)[\s\S]*WHERE status = 'pending'/);
  });

  it('enables RLS with a service_role-only policy', () => {
    expect(SQL).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(SQL).toMatch(/TO service_role/);
  });

  it('adds an updated_at trigger', () => {
    expect(SQL).toMatch(/trg_heidi_action_proposals_updated_at/);
  });
});
