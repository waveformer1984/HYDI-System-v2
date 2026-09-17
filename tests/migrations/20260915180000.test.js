/**
 * Migration test: system_dashboard read purity + escalation write separation.
 *
 * Regression being locked down
 * ----------------------------
 * evaluate_system_escalation() wrote to event_bus_events, and system_dashboard
 * calls it. So a plain SELECT from the dashboard performed an INSERT. PostgREST
 * serves GET in a read-only transaction, which made the dashboard unreadable:
 *
 *   BEGIN READ ONLY; SELECT current_status FROM system_dashboard; ROLLBACK;
 *     ERROR: cannot execute INSERT in a read-only transaction
 *
 * api/health.js reads the dashboard through PostgREST, so /api/health returned
 * 500 and heidi-web crashed on the error. Separately, every reader of
 * /api/health generated an escalation row, and those rows were counted as
 * event-flow evidence — the health system proving its own health.
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { Client } = require('pg');

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const PG = {
  host: process.env.PG_HOST || '127.0.0.1',
  port: parseInt(process.env.PG_PORT || '54322', 10),
  database: process.env.PG_DATABASE || 'postgres',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
};

async function withClient(fn) {
  const c = new Client(PG);
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

const countEvents = () =>
  withClient(async (c) => parseInt((await c.query('select count(*)::int c from event_bus_events')).rows[0].c, 10));

jest.setTimeout(60000);

describe('system_dashboard is a pure read', () => {
  it('SELECT * FROM system_dashboard succeeds inside a READ ONLY transaction', async () => {
    // The decisive gate. This is exactly what PostgREST does for a GET.
    const rows = await withClient(async (c) => {
      await c.query('BEGIN READ ONLY');
      try {
        const r = await c.query('SELECT * FROM system_dashboard');
        return r.rows;
      } finally {
        await c.query('ROLLBACK');
      }
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveProperty('current_status');
    expect(rows[0]).toHaveProperty('escalation_level');
  });

  it('reading the dashboard does not write to event_bus_events', async () => {
    const before = await countEvents();
    await withClient(async (c) => {
      await c.query('SELECT * FROM system_dashboard');
      await c.query('SELECT * FROM system_dashboard');
      await c.query('SELECT * FROM system_dashboard');
    });
    expect(await countEvents()).toBe(before);
  });

  it('is readable through PostgREST, which is how api/health.js reads it', async () => {
    const { data, error } = await supabase.from('system_dashboard').select('*').single();
    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data).toHaveProperty('current_status');
  });

  it('a PostgREST read writes nothing either', async () => {
    const before = await countEvents();
    await supabase.from('system_dashboard').select('*').single();
    await supabase.from('system_dashboard').select('*').single();
    expect(await countEvents()).toBe(before);
  });

  it('every function the view calls is non-volatile or write-free', async () => {
    const viewdef = await withClient(async (c) =>
      (await c.query("select pg_get_viewdef('public.system_dashboard'::regclass, true) d")).rows[0].d
    );
    // The dependency path must contain no writer. Guard the two it calls.
    expect(viewdef).toContain('evaluate_system_escalation()');
    expect(viewdef).toContain('analyze_health_trends()');

    const defs = await withClient(async (c) =>
      (await c.query(
        "select proname, prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace " +
        "where n.nspname='public' and proname in ('evaluate_system_escalation','analyze_health_trends')"
      )).rows
    );
    expect(defs).toHaveLength(2);
    for (const d of defs) {
      expect(`${d.proname}:${/insert\s+into/i.test(d.prosrc)}`).toBe(`${d.proname}:false`);
    }
  });

  it('evaluate_system_escalation is marked STABLE so the planner rejects writes', async () => {
    const v = await withClient(async (c) =>
      (await c.query(
        "select provolatile from pg_proc p join pg_namespace n on n.oid=p.pronamespace " +
        "where n.nspname='public' and proname='evaluate_system_escalation'"
      )).rows[0].provolatile
    );
    expect(v).toBe('s');
  });
});

describe('escalation: calculation separated from persistence', () => {
  it('the pure calculation runs in a READ ONLY transaction and returns the verdict', async () => {
    const result = await withClient(async (c) => {
      await c.query('BEGIN READ ONLY');
      try {
        return (await c.query('SELECT evaluate_system_escalation() AS e')).rows[0].e;
      } finally {
        await c.query('ROLLBACK');
      }
    });
    expect(result).toHaveProperty('level');
    expect(result).toHaveProperty('action');
    expect(result).toHaveProperty('reason');
    expect(result).toHaveProperty('critical_in_last_10');
  });

  it('the pure calculation writes nothing', async () => {
    const before = await countEvents();
    await withClient(async (c) => c.query('SELECT evaluate_system_escalation()'));
    expect(await countEvents()).toBe(before);
  });

  it('record_system_escalation persists when escalation is required', async () => {
    const escalation = await withClient(async (c) =>
      (await c.query('SELECT evaluate_system_escalation() AS e')).rows[0].e
    );

    const before = await countEvents();
    const recorded = await withClient(async (c) =>
      (await c.query('SELECT record_system_escalation() AS r')).rows[0].r
    );
    const after = await countEvents();

    if (escalation.action === 'none') {
      expect(recorded.recorded).toBe(false);
      expect(after).toBe(before);
    } else {
      expect(recorded.recorded).toBe(true);
      expect(after).toBe(before + 1);
      // The verdict must survive the split unchanged.
      expect(recorded.level).toBe(escalation.level);
      expect(recorded.action).toBe(escalation.action);
    }
  });

  it('a recorded escalation event satisfies the current schema', async () => {
    const row = await withClient(async (c) =>
      (await c.query(
        "select event_type, topic, event_name, payload from event_bus_events " +
        "where topic = 'system:escalation' order by occurred_at desc limit 1"
      )).rows[0]
    );
    if (!row) return; // nothing escalated yet in this environment
    expect(row.event_type).toBe('system:escalation'); // NOT NULL, was omitted
    expect(row.topic).toBe('system:escalation');
    expect(row.event_name).toMatch(/^escalation_/);
    expect(row.payload).toHaveProperty('level');
  });

  it('record_system_escalation is a writer and correctly refuses a READ ONLY transaction', async () => {
    await expect(
      withClient(async (c) => {
        await c.query('BEGIN READ ONLY');
        try {
          return await c.query('SELECT record_system_escalation()');
        } finally {
          await c.query('ROLLBACK').catch(() => {});
        }
      })
    ).rejects.toThrow(/read-only transaction/i);
  });
});

describe('auto_heal_from_trends satisfies the schema', () => {
  it('supplies the NOT NULL event_type in its INSERT', async () => {
    const src = await withClient(async (c) =>
      (await c.query(
        "select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace " +
        "where n.nspname='public' and proname='auto_heal_from_trends'"
      )).rows[0].prosrc
    );
    expect(src).toContain('event_bus_events (event_type, topic, event_name, payload, occurred_at)');
    expect(src).toContain("'system:auto_heal'");
  });

  it('is not reachable from the dashboard read path', async () => {
    // It is an explicit RPC write path (api/chat/route.js), which is fine.
    // What matters is that reading the dashboard cannot trigger it.
    const viewdef = await withClient(async (c) =>
      (await c.query("select pg_get_viewdef('public.system_dashboard'::regclass, true) d")).rows[0].d
    );
    expect(viewdef).not.toContain('auto_heal_from_trends');
  });
});

describe('event-flow truth: self-generated events are not evidence of flow', () => {
  const SELF = ['system:escalation', 'system:auto_heal'];
  const excludeFilter = `topic.is.null,topic.not.in.(${SELF.map((t) => `"${t}"`).join(',')})`;

  it('escalation events exist but are excluded from event-flow evidence', async () => {
    const { data: all } = await supabase.from('event_bus_events').select('topic');
    const { data: flow } = await supabase.from('event_bus_events').select('topic').or(excludeFilter);

    const selfCount = (all || []).filter((r) => SELF.includes(r.topic)).length;
    if (selfCount === 0) return; // nothing self-generated yet

    // They are real rows...
    expect(all.length).toBeGreaterThan(flow.length);
    // ...but none of them counts as event flow.
    expect((flow || []).some((r) => SELF.includes(r.topic))).toBe(false);
  });

  it('the exclusion is null-safe — legacy rows predate the topic column', async () => {
    // `not.in` and `neq` both drop NULLs in SQL, which would silently discard
    // every pre-topic row. Verified against the live table.
    const { data: nullTopic } = await supabase.from('event_bus_events').select('topic').is('topic', null);
    if (!nullTopic || nullTopic.length === 0) return;

    const { data: flow } = await supabase.from('event_bus_events').select('topic').or(excludeFilter);
    expect((flow || []).filter((r) => r.topic === null).length).toBe(nullTopic.length);
  });

  it('does not exclude other system topics that are genuine operational evidence', () => {
    // system:healing is written by business-intelligence-layer.sql, a different
    // subsystem. Excluding all system:* would discard real evidence.
    expect(SELF).not.toContain('system:healing');
    expect(SELF).toHaveLength(2);
  });

  it('true-system-health.js no longer excludes cognitive_cycle from event-flow evidence', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.resolve(__dirname, '../../true-system-health.js'), 'utf8');
    // 2026-09-14: event-flow evidence moved from event_bus_events to
    // heidi_events, and (at the time) carried the same self-generated
    // exclusion forward onto cognitive_cycle, by analogy with
    // event_bus_events' genuinely self-referential system:escalation/
    // system:auto_heal topics above.
    //
    // 2026-09-17: that analogy was wrong. cognitive_cycle is written by
    // lib/heidi/CognitiveCore.ts's recordCycle() through the same
    // this.pool.query() call, into the same heidi_events table, as
    // authorization_escalation -- not a weaker or self-referential signal,
    // just a far more frequent one (hydi-daemon's ~60s heartbeat). Excluding
    // it produced 20/20 consecutive CRITICAL system_health_runs while every
    // other signal (process liveness, watchdog's independent classifier)
    // confirmed the system was healthy -- the only thing that had actually
    // stopped for 21+ hours was authorization_escalation, a rare,
    // request-driven event type this deployment can legitimately go many
    // hours without needing. See checkEventFlow() and
    // tests/unit/true-system-health-eventflow.test.js.
    expect(src).toContain('async function checkEventFlow(');
    // The load-bearing behavioral check: neither event-flow query filters
    // cognitive_cycle out anymore. (The old variable name may still appear
    // in comments explaining this history -- that's prose, not behavior.)
    expect(src.match(/\.or\(excludeSelfGenerated\)/g) || []).toHaveLength(0);
  });

  it('a dead event bus is CRITICAL, not OK (null must not compare as small)', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.resolve(__dirname, '../../true-system-health.js'), 'utf8');
    // `null < 10` is true in JS, so the null case must be handled before the
    // numeric comparison chain.
    expect(src).toContain("minutesSinceLastEvent === null ? 'CRITICAL'");
  });
});
