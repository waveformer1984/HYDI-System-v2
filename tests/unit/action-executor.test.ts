/**
 * Unit tests for lib/action-executor.ts — truthful action execution.
 * A lightweight chainable Supabase stub records calls and returns a configured
 * result, so handlers can be tested without a live database.
 */

import { ActionExecutor } from '../../lib/action-executor';
import { mintSignedAuthorization } from '../helpers/signTestAuth';

type QueryResult = { data?: unknown; error?: { message: string } | null };

function fakeSupabase(result: QueryResult) {
  const calls: { table?: string; insert?: unknown; update?: unknown; eq: Array<[string, unknown]> } = { eq: [] };
  const query: Record<string, unknown> = {
    select: () => query,
    limit: () => query,
    eq: (k: string, v: unknown) => {
      calls.eq.push([k, v]);
      return query;
    },
    update: (vals: unknown) => {
      calls.update = vals;
      return query;
    },
    insert: (vals: unknown) => {
      calls.insert = vals;
      return query;
    },
    single: () => Promise.resolve(result),
    then: (resolve: (r: QueryResult) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  const supabase = {
    from: (table: string) => {
      calls.table = table;
      return query;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { supabase: supabase as any, calls };
}

describe('lib/action-executor ActionExecutor', () => {
  const realFetch = global.fetch;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = { RESEND_API_KEY: process.env.RESEND_API_KEY, EMAIL_FROM: process.env.EMAIL_FROM };
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  });

  afterEach(() => {
    process.env.RESEND_API_KEY = savedEnv.RESEND_API_KEY;
    process.env.EMAIL_FROM = savedEnv.EMAIL_FROM;
    if (savedEnv.RESEND_API_KEY === undefined) delete process.env.RESEND_API_KEY;
    if (savedEnv.EMAIL_FROM === undefined) delete process.env.EMAIL_FROM;
    global.fetch = realFetch;
  });

  it('create_task inserts and returns the new task id', async () => {
    const { supabase, calls } = fakeSupabase({ data: { id: 'task-1' }, error: null });
    const exec = new ActionExecutor(supabase);
    const res = await exec.execute({ type: 'create_task', payload: { task_name: 'do_it' } }, 'sess-1');
    expect(res.status).toBe('completed');
    expect(res.result).toEqual({ task_id: 'task-1', task_name: 'do_it' });
    expect(calls.table).toBe('actions');
  });

  it('create_task surfaces a DB error truthfully', async () => {
    const { supabase } = fakeSupabase({ data: null, error: { message: 'permission denied' } });
    const exec = new ActionExecutor(supabase);
    const res = await exec.execute({ type: 'create_task', payload: { task_name: 'x' } }, 'sess-1');
    expect(res.status).toBe('failed');
    expect(res.error).toBe('permission denied');
  });

  it('fetch_data rejects tables that are not allowlisted', async () => {
    const { supabase } = fakeSupabase({ data: [], error: null });
    const exec = new ActionExecutor(supabase);
    const res = await exec.execute({ type: 'fetch_data', payload: { table: 'secrets' } }, 'sess-1');
    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/not readable/);
  });

  it('fetch_data reads an allowlisted table and reports a row count', async () => {
    const { supabase } = fakeSupabase({ data: [{ id: 1 }, { id: 2 }], error: null });
    const exec = new ActionExecutor(supabase);
    const res = await exec.execute({ type: 'fetch_data', payload: { table: 'actions', limit: 5 } }, 'sess-1');
    expect(res.status).toBe('completed');
    expect(res.result).toEqual({ rows: [{ id: 1 }, { id: 2 }], count: 2 });
  });

  it('update_database rejects non-writable tables', async () => {
    const { supabase } = fakeSupabase({ error: null });
    const exec = new ActionExecutor(supabase);
    const res = await exec.execute(
      { type: 'update_database', payload: { table: 'actions', values: { x: 1 }, match: { id: 1 } } },
      'sess-1',
    );
    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/not writable/);
  });

  it('update_database requires non-empty values and match', async () => {
    const { supabase } = fakeSupabase({ error: null });
    const exec = new ActionExecutor(supabase);
    const res = await exec.execute(
      { type: 'update_database', payload: { table: 'sessions', values: { x: 1 }, match: {} } },
      'sess-1',
    );
    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/non-empty/);
  });

  it('schedule_event rejects an invalid timestamp', async () => {
    const { supabase } = fakeSupabase({ data: { id: 'e1' }, error: null });
    const exec = new ActionExecutor(supabase);
    const res = await exec.execute({ type: 'schedule_event', payload: { scheduled_for: 'not-a-date' } }, 'sess-1');
    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/valid ISO/);
  });

  it('schedule_event persists a valid ISO timestamp', async () => {
    const { supabase } = fakeSupabase({ data: { id: 'e1' }, error: null });
    const exec = new ActionExecutor(supabase);
    const iso = '2030-01-01T00:00:00.000Z';
    const res = await exec.execute({ type: 'schedule_event', payload: { scheduled_for: iso } }, 'sess-1');
    expect(res.status).toBe('completed');
    expect(res.result).toEqual({ event_id: 'e1', scheduled_for: iso });
  });

  it('send_email fails truthfully when credentials are not configured', async () => {
    const { supabase } = fakeSupabase({ error: null });
    const exec = new ActionExecutor(supabase);
    // Phase 3: send_email is R3 and the chokepoint now refuses it before
    // dispatch unless an approval record is produced. This test's intent is the
    // credential behaviour -- that a missing key fails honestly rather than
    // reporting a fake success -- so it supplies authorization to reach that
    // check. tests/unit/action-executor-enforcement.test.ts covers the
    // unauthorized case, including that no network request is made.
    const payload = { to: 'a@b.com', subject: 's', body: 'b' };
    const res = await exec.execute(
      { type: 'send_email', payload },
      'sess-1',
      // Signed authorization bound to this exact action (type + session +
      // payload) — a bare object is no longer enough.
      mintSignedAuthorization({ type: 'send_email', sessionId: 'sess-1', payload }),
    );
    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/Email not configured/);
  });

  it('rejects an unsupported action type', async () => {
    const { supabase } = fakeSupabase({ error: null });
    const exec = new ActionExecutor(supabase);
    const res = await exec.execute({ type: 'mine_bitcoin', payload: {} }, 'sess-1');
    expect(res.status).toBe('failed');
    // Phase 3: an unmodelled action is now stopped by the chokepoint at R5
    // BEFORE dispatch, rather than falling through the switch to a generic
    // "unsupported" message. Strictly stronger -- it is refused on risk
    // grounds, not merely on the absence of a handler.
    expect(res.error).toMatch(/UNKNOWN_ACTION/);
    expect(res.error).toMatch(/R5/);
  });
});
