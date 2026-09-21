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
});
