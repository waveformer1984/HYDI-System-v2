/**
 * OperatorLease — behavioral tests over a fake Pool that emulates the
 * heidi_operator_lease row. The fake applies the same rules Postgres
 * would (single row per operator, conditional claim update, owner-scoped
 * writes), so the tests prove lease BEHAVIOR — claim/refuse/heartbeat/
 * release/stale — not just that SQL text looks right.
 */
import { OperatorLease, OperatorLeaseSupervisor } from '../../lib/heidi/OperatorLease';
import type { Pool, QueryResult } from 'pg';

interface FakeRow {
  id: string;
  operator: string;
  owner_id: string;
  host: string | null;
  pid: number | null;
  claimed_at: string;
  heartbeat_at: string;
  expires_at: string;
  released_at: string | null;
}

/**
 * Minimal Postgres-faithful emulation of heidi_operator_lease:
 *  - one row per operator
 *  - claim upsert only succeeds when expired or released (the WHERE gate)
 *  - heartbeat/release only write when owner_id matches and not released
 * Time is controllable via `now` so tests can force expiry.
 */
function fakePool() {
  const rows = new Map<string, FakeRow>();
  let nextId = 1;
  const state = { now: Date.now(), queries: [] as { text: string; values: unknown[] }[] };

  const pool = {
    query: jest.fn(async (text: string, values: unknown[] = []): Promise<QueryResult<any>> => {
      state.queries.push({ text, values });
      const now = state.now;

      if (/INSERT INTO public\.heidi_operator_lease/.test(text)) {
        const [operator, owner_id, host, pid, ttlMs] = values as [string, string, string, number, string];
        const existing = rows.get(operator);
        const claimable = !existing || new Date(existing.expires_at).getTime() < now || existing.released_at !== null;
        if (!claimable) return { rows: [], rowCount: 0, command: 'INSERT', oid: 0, fields: [] };
        const row: FakeRow = {
          id: `lease-${nextId++}`,
          operator,
          owner_id,
          host,
          pid,
          claimed_at: new Date(now).toISOString(),
          heartbeat_at: new Date(now).toISOString(),
          expires_at: new Date(now + parseInt(ttlMs, 10)).toISOString(),
          released_at: null,
        };
        rows.set(operator, row);
        return { rows: [{ id: row.id, expires_at: row.expires_at }], rowCount: 1, command: 'INSERT', oid: 0, fields: [] };
      }

      if (/UPDATE public\.heidi_operator_lease[\s\S]*heartbeat_at = now\(\)/.test(text)) {
        const [id, owner_id, ttlMs] = values as [string, string, string];
        const row = [...rows.values()].find((r) => r.id === id && r.owner_id === owner_id && r.released_at === null);
        if (!row) return { rows: [], rowCount: 0, command: 'UPDATE', oid: 0, fields: [] };
        row.heartbeat_at = new Date(now).toISOString();
        row.expires_at = new Date(now + parseInt(ttlMs, 10)).toISOString();
        return { rows: [], rowCount: 1, command: 'UPDATE', oid: 0, fields: [] };
      }

      if (/UPDATE public\.heidi_operator_lease[\s\S]*released_at = now\(\)/.test(text)) {
        const [id, owner_id] = values as [string, string];
        const row = [...rows.values()].find((r) => r.id === id && r.owner_id === owner_id && r.released_at === null);
        if (!row) return { rows: [], rowCount: 0, command: 'UPDATE', oid: 0, fields: [] };
        row.released_at = new Date(now).toISOString();
        return { rows: [], rowCount: 1, command: 'UPDATE', oid: 0, fields: [] };
      }

      if (/SELECT owner_id, host, pid, heartbeat_at, expires_at[\s\S]*WHERE operator = \$1/.test(text)) {
        const row = rows.get(values[0] as string);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0, command: 'SELECT', oid: 0, fields: [] };
      }

      if (/SELECT \* FROM public\.heidi_operator_lease WHERE operator = \$1/.test(text)) {
        const row = rows.get(values[0] as string);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0, command: 'SELECT', oid: 0, fields: [] };
      }

      if (/released_at IS NULL AND expires_at < now\(\)/.test(text)) {
        const stale = [...rows.values()].filter((r) => r.released_at === null && new Date(r.expires_at).getTime() < now);
        return { rows: stale, rowCount: stale.length, command: 'SELECT', oid: 0, fields: [] };
      }

      throw new Error(`fakePool: unhandled query: ${text.slice(0, 80)}`);
    }),
  } as unknown as Pool;

  return { pool, rows, state };
}

describe('OperatorLease', () => {
  it('claims the lease and returns the expiry evidence', async () => {
    const { pool } = fakePool();
    const lease = new OperatorLease(pool, { ttlMs: 120_000 });
    const claim = await lease.claim();
    expect(claim.held).toBe(true);
    if (claim.held) expect(Date.parse(claim.expiresAt)).toBeGreaterThan(Date.now());
  });

  it('issues the claim as ONE atomic conditional upsert — no read-then-write window', async () => {
    const { pool, state } = fakePool();
    await new OperatorLease(pool).claim();
    const writes = state.queries.filter((q) => /INSERT INTO/.test(q.text));
    expect(writes).toHaveLength(1);
    expect(writes[0].text).toMatch(/ON CONFLICT \(operator\) DO UPDATE/);
    expect(writes[0].text).toMatch(/WHERE public\.heidi_operator_lease\.expires_at < now\(\)[\s\S]*released_at IS NOT NULL/);
  });

  it('a second claimant is refused while a live lease exists', async () => {
    const { pool } = fakePool();
    const a = new OperatorLease(pool);
    const b = new OperatorLease(pool);
    expect((await a.claim()).held).toBe(true);
    const refused = await b.claim();
    expect(refused.held).toBe(false);
    if (!refused.held) expect(refused.currentOwner?.owner_id).toBe(a.ownerId);
  });

  it('an expired lease can be reclaimed by a new holder', async () => {
    const { pool, state } = fakePool();
    const a = new OperatorLease(pool, { ttlMs: 60_000 });
    const b = new OperatorLease(pool);
    await a.claim();
    state.now += 61_000; // past expiry
    expect((await b.claim()).held).toBe(true);
  });

  it('heartbeat renews expiry for the holder', async () => {
    const { pool, rows, state } = fakePool();
    const lease = new OperatorLease(pool, { ttlMs: 60_000 });
    await lease.claim();
    const before = rows.get('heidi-daemon')!.expires_at;
    state.now += 30_000;
    expect(await lease.heartbeat()).toBe(true);
    expect(rows.get('heidi-daemon')!.expires_at > before).toBe(true);
  });

  it('a superseded holder learns it lost: heartbeat returns false', async () => {
    const { pool, state } = fakePool();
    const a = new OperatorLease(pool, { ttlMs: 30_000 });
    const b = new OperatorLease(pool);
    await a.claim();
    state.now += 31_000;               // a's lease expires
    await b.claim();                   // b takes over
    expect(await a.heartbeat()).toBe(false);   // a's heartbeat touches 0 rows
    expect(await b.heartbeat()).toBe(true);    // b is the live holder
  });

  it('release marks released_at; the row can then be claimed cleanly', async () => {
    const { pool, rows } = fakePool();
    const a = new OperatorLease(pool);
    const b = new OperatorLease(pool);
    await a.claim();
    await a.release();
    expect(rows.get('heidi-daemon')!.released_at).not.toBeNull();
    expect(await a.heartbeat()).toBe(false);       // released holder cannot renew
    expect((await b.claim()).held).toBe(true);    // clean handoff, no expiry wait
  });

  it('findStale flags leases held past expiry but not released ones', async () => {
    const { pool, state } = fakePool();
    const live = new OperatorLease(pool, { operator: 'op-live', ttlMs: 120_000 });
    const dying = new OperatorLease(pool, { operator: 'op-dying', ttlMs: 30_000 });
    const done = new OperatorLease(pool, { operator: 'op-done', ttlMs: 30_000 });
    await live.claim();
    await dying.claim();
    await done.claim();
    await done.release();
    state.now += 31_000;
    const stale = await OperatorLease.findStale(pool);
    expect(stale.map((r) => r.operator)).toEqual(['op-dying']);
  });

  it('readCurrent reports the recorded holder', async () => {
    const { pool } = fakePool();
    const lease = new OperatorLease(pool);
    await lease.claim();
    const row = await OperatorLease.readCurrent(pool);
    expect(row?.owner_id).toBe(lease.ownerId);
  });
});

describe('OperatorLeaseSupervisor — the per-tick lifecycle', () => {
  const mkSupervisor = (pool: Pool, opts: { ttlMs?: number } = {}) => {
    const lines: { level: string; msg: string }[] = [];
    const collect = (level: string) => (msg: string) => lines.push({ level, msg });
    const sup = new OperatorLeaseSupervisor(pool, opts, { log: collect('log'), warn: collect('warn'), error: collect('error') });
    return { sup, lines };
  };

  it('claims on the first tick — held is true for the gate', async () => {
    const { pool } = fakePool();
    const { sup, lines } = mkSupervisor(pool);
    await sup.tick();
    expect(sup.held).toBe(true);
    expect(lines.some((l) => l.level === 'log' && /operator lease held/.test(l.msg))).toBe(true);
  });

  it('a refused startup self-heals: re-claims every tick until the predecessor expires', async () => {
    const { pool, state } = fakePool();
    await new OperatorLease(pool, { ttlMs: 60_000 }).claim(); // live predecessor
    const { sup, lines } = mkSupervisor(pool, { ttlMs: 60_000 });

    await sup.tick();
    expect(sup.held).toBe(false);
    expect(lines.some((l) => l.level === 'error' && /REFUSED/.test(l.msg))).toBe(true);

    state.now += 61_000; // predecessor's TTL lapses
    await sup.tick();
    expect(sup.held).toBe(true);
    expect(lines.some((l) => /acquired on retry/.test(l.msg))).toBe(true);
  });

  it('repeated refusals log once per holder, not once per tick', async () => {
    const { pool } = fakePool();
    await new OperatorLease(pool).claim();
    const { sup, lines } = mkSupervisor(pool);
    await sup.tick();
    await sup.tick();
    await sup.tick();
    expect(lines.filter((l) => /REFUSED/.test(l.msg))).toHaveLength(1);
  });

  it('a superseded heartbeat clears the hold and the next tick re-claims', async () => {
    const { pool, state } = fakePool();
    const { sup, lines } = mkSupervisor(pool, { ttlMs: 30_000 });
    await sup.tick();
    expect(sup.held).toBe(true);

    const contested = await new OperatorLease(pool, { ttlMs: 30_000 }).claim(); // refused — we're live
    expect(contested.held).toBe(false);
    state.now += 31_000;
    await new OperatorLease(pool, { ttlMs: 30_000 }).claim();  // expired → superseded
    await sup.tick();                                         // heartbeat touches 0 rows
    expect(sup.held).toBe(false);
    expect(lines.some((l) => /LOST/.test(l.msg))).toBe(true);

    state.now += 31_000;                                      // superseder's TTL lapses too
    await sup.tick();                                         // re-claim
    expect(sup.held).toBe(true);
    expect(lines.some((l) => /acquired on retry/.test(l.msg))).toBe(true);
  });

  it('release failures are logged, not swallowed — and the hold still clears', async () => {
    const { pool } = fakePool();
    const realQuery = pool.query.bind(pool);
    const endingPool = {
      query: async (text: string, values?: unknown[]) => {
        if (/released_at = now\(\)/.test(text)) throw new Error('pool is ending');
        return realQuery(text, values);
      },
    } as unknown as Pool;
    const { sup, lines } = mkSupervisor(endingPool);
    await sup.tick();
    expect(sup.held).toBe(true);

    await sup.release();
    expect(sup.held).toBe(false);
    expect(lines.some((l) => l.level === 'warn' && /lease release failed: pool is ending/.test(l.msg))).toBe(true);
  });
});
