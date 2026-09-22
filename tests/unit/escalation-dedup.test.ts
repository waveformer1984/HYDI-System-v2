/**
 * EscalationNotifier dedup — a logical incident must not insert unlimited
 * duplicate operator_escalations rows. Live bug observed 2026-09-21:
 * the same stuck_job row re-inserted every scheduler cycle.
 *
 * Required behavior:
 *   first detection          → insert one row
 *   same unresolved incident → update the existing row (last_seen_at)
 *   resolved incident        → next detection inserts a new row
 *   different incident       → new row
 */

import { EscalationNotifier } from '../../lib/operational/EscalationNotifier';

interface Row {
  id: string;
  category: string;
  resolved: boolean;
  metadata: Record<string, any>;
  [k: string]: any;
}

function makeMockSupabase() {
  const rows: Row[] = [];
  let nextId = 1;
  // Test hook: when set, every select on operator_escalations fails —
  // simulating a PostgREST/filter error at the dedupe lookup.
  let selectError: { message: string } | null = null;

  function matchOr(row: Row, expr: string): boolean {
    // supports: metadata->>k.eq.v,metadata->>k2.eq.v2
    return expr.split(',').some((clause) => {
      const m = clause.match(/^metadata->>(\w+)\.eq\.(.+)$/);
      if (!m) return false;
      return String(row.metadata?.[m[1]]) === m[2];
    });
  }

  function makeQuery(tableName: string) {
    const state = {
      mode: 'select' as 'select' | 'insert' | 'update',
      filters: [] as Array<(r: Row) => boolean>,
      orExpr: null as string | null,
      payload: null as any,
      orderCol: null as string | null,
      limitN: null as number | null,
    };

    const chain: any = {
      select: (_cols?: string, _opts?: any) => { state.mode = 'select'; return chain; },
      insert: (row: any) => { state.mode = 'insert'; state.payload = row; return chain; },
      update: (payload: any) => { state.mode = 'update'; state.payload = payload; return chain; },
      eq: (col: string, val: any) => {
        state.filters.push((r: Row) => r[col] === val);
        return chain;
      },
      or: (expr: string) => { state.orExpr = expr; return chain; },
      order: (col: string, _opts?: any) => { state.orderCol = col; return chain; },
      limit: (n: number) => { state.limitN = n; return chain; },
      then: (resolve: any) => {
        if (tableName !== 'operator_escalations') return resolve({ data: null, error: null });
        if (state.mode === 'insert') {
          const row = { id: `esc-${nextId++}`, ...state.payload };
          rows.push(row);
          return resolve({ data: [row], error: null });
        }
        let matched = rows.filter((r) => state.filters.every((f) => f(r)));
        if (state.orExpr) matched = matched.filter((r) => matchOr(r, state.orExpr!));
        if (state.mode === 'update') {
          matched.forEach((r) => Object.assign(r, state.payload));
          return resolve({ data: matched, error: null });
        }
        if (selectError) return resolve({ data: null, error: selectError });
        if (state.orderCol) {
          matched = [...matched].sort((a, b) => String(b[state.orderCol!]).localeCompare(String(a[state.orderCol!])));
        }
        if (state.limitN) matched = matched.slice(0, state.limitN);
        return resolve({ data: matched, error: null });
      },
    };
    return chain;
  }

  return {
    rows,
    from: (t: string) => makeQuery(t),
    setSelectError: (e: { message: string } | null) => { selectError = e; },
  };
}

function stuckJobNotification(jobId: string, hours = 50) {
  return {
    category: 'stuck_job',
    severity: 'warning' as const,
    title: `Job awaiting review for ${hours}h`,
    body: `Job ${jobId} stale.`,
    actionRequired: 'Review the artifact.',
    metadata: { jobId, stuckDurationHours: hours, context: 'awaiting_review' },
  };
}

describe('EscalationNotifier dedup', () => {
  test('D1: first detection inserts exactly one row', async () => {
    const supa = makeMockSupabase();
    const n = new EscalationNotifier(supa);
    const r = await n.notify(stuckJobNotification('job-1'));
    expect(r.sent).toBe(true);
    expect(supa.rows).toHaveLength(1);
    expect(supa.rows[0].metadata.jobId).toBe('job-1');
  });

  test('D2: repeated detection of the SAME unresolved incident updates, not duplicates', async () => {
    const supa = makeMockSupabase();
    const n = new EscalationNotifier(supa);
    await n.notify(stuckJobNotification('job-1', 50));
    await n.notify(stuckJobNotification('job-1', 51)); // next cycle, one hour later
    await n.notify(stuckJobNotification('job-1', 52));

    expect(supa.rows).toHaveLength(1);
    // refreshed in place: title/body updated to latest duration, last_seen stamped
    expect(supa.rows[0].title).toMatch(/52h/);
    expect(supa.rows[0].metadata.last_seen_at).toBeTruthy();
  });

  test('D3: a resolved incident followed by re-detection creates a NEW row', async () => {
    const supa = makeMockSupabase();
    const n = new EscalationNotifier(supa);
    await n.notify(stuckJobNotification('job-1'));
    supa.rows[0].resolved = true; // human resolved it
    await n.notify(stuckJobNotification('job-1')); // incident recurs

    expect(supa.rows).toHaveLength(2);
    expect(supa.rows[0].resolved).toBe(true); // resolved row untouched
    expect(supa.rows[1].resolved).toBe(false);
  });

  test('D4: a different incident (different jobId) inserts a separate row', async () => {
    const supa = makeMockSupabase();
    const n = new EscalationNotifier(supa);
    await n.notify(stuckJobNotification('job-1'));
    await n.notify(stuckJobNotification('job-2'));

    expect(supa.rows).toHaveLength(2);
  });

  test('D5: no incident key in metadata → always inserts (no dedupe basis)', async () => {
    const supa = makeMockSupabase();
    const n = new EscalationNotifier(supa);
    const n1 = { ...stuckJobNotification('x'), metadata: { context: 'test' } };
    await n.notify(n1);
    await n.notify(n1);
    expect(supa.rows).toHaveLength(2);
  });

  test('D6: webhook_retry incidents key on metadata.eventId — dedupes like jobId', async () => {
    // Census 2026-09-21: 439 webhook_retry rows all keyed on
    // metadata.eventId — the original dedup only checked jobId/dedupeKey,
    // so webhook incidents would have kept inserting after d9740f7.
    const supa = makeMockSupabase();
    const n = new EscalationNotifier(supa);
    const webhook = (id: string) => ({
      category: 'webhook_retry',
      severity: 'warning' as const,
      title: `Webhook stuck in processing: ${id}`,
      body: `Event ${id} stuck.`,
      metadata: { eventId: id, eventType: 'checkout.session.completed', webhookId: 'wh-1' },
    });
    await n.notify(webhook('evt_abc'));
    await n.notify(webhook('evt_abc'));
    await n.notify(webhook('evt_xyz'));

    expect(supa.rows).toHaveLength(2); // evt_abc deduped, evt_xyz separate
    expect(supa.rows[0].metadata.eventId).toBe('evt_abc');
    expect(supa.rows[0].metadata.last_seen_at).toBeTruthy();
  });

  test('D7: dedupe lookup error fails CLOSED — no duplicate row inserted', async () => {
    const supa = makeMockSupabase();
    const n = new EscalationNotifier(supa);
    await n.notify(stuckJobNotification('job-1')); // canonical row exists
    expect(supa.rows).toHaveLength(1);

    // Simulate a PostgREST failure at the lookup: the old code fell through
    // to insert — the mechanism behind hourly duplicate floods.
    supa.setSelectError({ message: 'failed to parse logic tree' });
    const r = await n.notify(stuckJobNotification('job-1', 999));
    const r2 = await n.notify(stuckJobNotification('job-2', 10)); // even a NEW incident
    supa.setSelectError(null);

    expect(supa.rows).toHaveLength(1); // no duplicate, no new row while lookup is broken
    expect(r.error).toMatch(/dedupe lookup failed/i);
    expect(r2.error).toMatch(/dedupe lookup failed/i);
    expect(r.sent).toBe(true); // console channel still carried the escalation

    // Lookup healthy again → dedupe resumes, still one row for job-1.
    await n.notify(stuckJobNotification('job-1', 1000));
    expect(supa.rows).toHaveLength(1);
    await n.notify(stuckJobNotification('job-2', 11));
    expect(supa.rows).toHaveLength(2); // job-2 lands once, not per attempt
  });
});
