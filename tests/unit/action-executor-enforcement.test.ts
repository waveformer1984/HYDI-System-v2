/**
 * ActionExecutor enforcement (Phase 3).
 *
 * The companion suite (action-chokepoint.test.ts) proves the gate decides
 * correctly. This one proves ActionExecutor ACTUALLY CALLS IT -- and, for the
 * case that matters most, that a refused `send_email` performs NO NETWORK
 * REQUEST. "It returned failed" and "it did not send the email" are different
 * claims, and only the second one is security.
 *
 * Before Phase 3 this path sent real outbound mail via api.resend.com with no
 * risk classification and no authorization; its only guard was whether
 * RESEND_API_KEY happened to be set.
 *
 * global.fetch and the Supabase client are both stubbed: this suite must never
 * make a real network call or touch a database.
 */

import { ActionExecutor } from '../../lib/action-executor';
import { mintSignedAuthorization } from '../helpers/signTestAuth';

/** Minimal Supabase stub -- enough for the low-risk paths to run. */
function fakeSupabase() {
  const builder: any = {
    select: () => builder,
    insert: () => builder,
    update: () => builder,
    eq: () => builder,
    limit: () => builder,
    single: async () => ({ data: { id: 'row-1' }, error: null }),
    then: (res: any) => Promise.resolve({ data: [{ id: 'row-1' }], error: null }).then(res),
  };
  return { from: () => builder } as any;
}

let fetchCalls: string[];
const realFetch = global.fetch;

beforeEach(() => {
  fetchCalls = [];
  process.env.RESEND_API_KEY = 'test-key';
  process.env.EMAIL_FROM = 'noreply@example.com';
  global.fetch = (async (url: any) => {
    fetchCalls.push(String(url));
    return { ok: true, json: async () => ({ id: 'email-123' }), text: async () => '' } as any;
  }) as any;
});

afterEach(() => {
  global.fetch = realFetch;
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
});

describe('Phase 3 — send_email is refused without authorization AND sends nothing', () => {
  test('unauthorized send_email fails closed with no network request', async () => {
    const exec = new ActionExecutor(fakeSupabase());
    const res = await exec.execute(
      { type: 'send_email', payload: { to: 'victim@example.com', subject: 'hi', body: 'x' } },
      'session-1',
    );

    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/AUTHORIZATION_REQUIRED/);

    // The claim that matters: no mail left the building.
    expect(fetchCalls).toHaveLength(0);
  });

  test('a malformed authorization is refused and still sends nothing', async () => {
    const exec = new ActionExecutor(fakeSupabase());
    const res = await exec.execute(
      { type: 'send_email', payload: { to: 'victim@example.com' } },
      'session-1',
      { approvedBy: 'user:owner' } as any, // missing approvalRef / grantedAt
    );

    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/INVALID_AUTHORIZATION/);
    expect(fetchCalls).toHaveLength(0);
  });

  test('a complete approval record DOES permit the send — the gate is not a wall', async () => {
    const exec = new ActionExecutor(fakeSupabase());
    const payload = { to: 'lead@example.com', subject: 'hi', body: 'x' };
    const res = await exec.execute(
      { type: 'send_email', payload },
      'session-1',
      // Signed approval bound to this exact action (type + session + payload).
      mintSignedAuthorization({ type: 'send_email', sessionId: 'session-1', payload }),
    );

    expect(res.status).toBe('completed');
    expect(fetchCalls.some((u) => u.includes('api.resend.com'))).toBe(true);
  });

  test('an approval minted for a DIFFERENT session is refused — it cannot be replayed', async () => {
    const exec = new ActionExecutor(fakeSupabase());
    const payload = { to: 'lead@example.com', subject: 'hi', body: 'x' };
    const res = await exec.execute(
      { type: 'send_email', payload },
      'session-2', // signed for session-1, replayed into session-2
      mintSignedAuthorization({ type: 'send_email', sessionId: 'session-1', payload }),
    );

    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/INVALID_AUTHORIZATION/);
    expect(fetchCalls).toHaveLength(0);
  });

  test('an approval minted for a DIFFERENT payload is refused — the binding is to the action', async () => {
    const exec = new ActionExecutor(fakeSupabase());
    const res = await exec.execute(
      { type: 'send_email', payload: { to: 'attacker@evil.com', subject: 'hi', body: 'x' } },
      'session-1',
      // Signed for a different recipient.
      mintSignedAuthorization({ type: 'send_email', sessionId: 'session-1', payload: { to: 'lead@example.com', subject: 'hi', body: 'x' } }),
    );

    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/INVALID_AUTHORIZATION/);
    expect(fetchCalls).toHaveLength(0);
  });

  test('a stripped/altered signature is refused', async () => {
    const exec = new ActionExecutor(fakeSupabase());
    const payload = { to: 'lead@example.com', subject: 'hi', body: 'x' };
    const auth = mintSignedAuthorization({ type: 'send_email', sessionId: 'session-1', payload });
    auth.signature = auth.signature!.slice(0, -2) + '00'; // tamper
    const res = await exec.execute(
      { type: 'send_email', payload },
      'session-1',
      auth,
    );

    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/INVALID_AUTHORIZATION/);
    expect(fetchCalls).toHaveLength(0);
  });
});

describe('Phase 3 — tier behaviour through the real executor', () => {
  test('an unknown action type is refused as R5, not merely "unsupported"', async () => {
    const exec = new ActionExecutor(fakeSupabase());
    const res = await exec.execute({ type: 'exfiltrate_all_secrets', payload: {} }, 'session-1');

    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/UNKNOWN_ACTION/);
    // It must be stopped by governance, before dispatch -- not by falling
    // through the switch to a generic "unsupported" message.
    expect(res.error).not.toMatch(/Unsupported action type/);
  });

  test('update_database (R1) runs autonomously — its own allowlist is the bound', async () => {
    const exec = new ActionExecutor(fakeSupabase());
    const res = await exec.execute(
      { type: 'update_database', payload: { table: 'sessions', values: { x: 1 } } },
      'session-1',
    );
    // Must not be stopped by governance; the executor's WRITABLE_TABLES check
    // is what constrains it, and that check must remain reachable.
    expect(String(res.error ?? '')).not.toMatch(/AUTHORIZATION_REQUIRED/);
  });

  test('update_database on a non-writable table is still rejected by the allowlist', async () => {
    const exec = new ActionExecutor(fakeSupabase());
    const res = await exec.execute(
      { type: 'update_database', payload: { table: 'ledger', values: { x: 1 } } },
      'session-1',
    );
    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/not writable/i);
  });

  test('R0/R1 actions still run autonomously — the gate must not freeze ordinary work', async () => {
    const exec = new ActionExecutor(fakeSupabase());
    const res = await exec.execute({ type: 'fetch_data', payload: { table: 'memories' } }, 'session-1');
    // Whatever the data outcome, it must NOT have been refused by governance.
    expect(String(res.error ?? '')).not.toMatch(/AUTHORIZATION_REQUIRED|UNKNOWN_ACTION|PROHIBITED/);
  });
});
