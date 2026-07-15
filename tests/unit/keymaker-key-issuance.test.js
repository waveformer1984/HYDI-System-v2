/**
 * Regression test for a real, live privilege-escalation bug: POST
 * /keymaker/keys (src/server.js) previously only guarded the `userId`
 * field of a self-service key-issuance request, not `role` or `tier`. An
 * anonymous caller (Keymaker.makeAnonymous() -> { role: 'guest', tier:
 * 'starter', userId: null }) could POST { role: 'admin', tier:
 * 'enterprise' } with no credentials at all and receive a freshly issued
 * admin-role key, which then passed every `identity.role !== 'admin'`
 * gate in src/server.js (kill-switch, break-glass, key revocation, the
 * audit log). See ISSUES_FOUND.md for the full writeup.
 *
 * src/server.js constructs many live-ish services at module load (queues,
 * heartbeat monitors, a WebSocket server) and has no existing test
 * coverage for that reason — the fix was extracted into a pure, static,
 * directly-testable method (Keymaker.canIssueKeyAs) instead.
 */
'use strict';

jest.mock('../../src/database', () => ({ supabase: {} }));

const Keymaker = require('../../src/middleware/keymaker');

const ANONYMOUS = { userId: null, role: 'guest', tier: 'starter', subscriptionId: null, scopes: ['read'] };
const ADMIN = { userId: 'admin-1', role: 'admin', tier: 'enterprise' };
const REGULAR_USER = { userId: 'user-1', role: 'user', tier: 'pro' };

describe('Keymaker.canIssueKeyAs', () => {
  it('blocks an anonymous caller from self-issuing an admin-role key (the incident)', () => {
    const result = Keymaker.canIssueKeyAs(ANONYMOUS, { role: 'admin', tier: 'enterprise' });
    expect(result.allowed).toBe(false);
  });

  it('blocks an anonymous caller from requesting an elevated tier alone', () => {
    const result = Keymaker.canIssueKeyAs(ANONYMOUS, { tier: 'enterprise' });
    expect(result.allowed).toBe(false);
  });

  it('blocks a non-admin caller from issuing a key for a different userId', () => {
    const result = Keymaker.canIssueKeyAs(REGULAR_USER, { userId: 'someone-else' });
    expect(result.allowed).toBe(false);
  });

  it('blocks a non-admin caller from elevating their own role', () => {
    const result = Keymaker.canIssueKeyAs(REGULAR_USER, { role: 'admin' });
    expect(result.allowed).toBe(false);
  });

  it('allows a non-admin caller to self-issue a key matching their own identity exactly', () => {
    const result = Keymaker.canIssueKeyAs(REGULAR_USER, { role: 'user', tier: 'pro' });
    expect(result.allowed).toBe(true);
  });

  it('allows an anonymous caller to self-issue a benign key with no overrides requested', () => {
    const result = Keymaker.canIssueKeyAs(ANONYMOUS, {});
    expect(result.allowed).toBe(true);
  });

  it('allows an admin to issue a key for another user with an elevated role', () => {
    const result = Keymaker.canIssueKeyAs(ADMIN, { userId: 'someone-else', role: 'admin', tier: 'enterprise' });
    expect(result.allowed).toBe(true);
  });

  it('allows an admin to self-issue with no identity context at all (defensive default)', () => {
    const result = Keymaker.canIssueKeyAs(ADMIN, {});
    expect(result.allowed).toBe(true);
  });
});
