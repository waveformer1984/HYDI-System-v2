'use strict';

/**
 * true-system-health.js — Phase 7: optional-integration isolation and UNKNOWN visibility.
 *
 * Defect under test (observed 2026-09-18, HYDI_BASELINE.json):
 *   STRIPE_SECRET_KEY is deliberately unset (local-first). The revenue check
 *   therefore found 0 payments in 24h and set health.status = 'WARNING'. That
 *   produced WARNING in 20 of 20 system_health_runs, which drove
 *   analyze_health_trends() to 'degrading' and evaluate_system_escalation() to
 *   'warning_escalation', which made /api/health return status:'degraded',
 *   which the watchdog read as a heidi-web failure -> 6,603 escalations and
 *   29 recovery attempts scored 0 successful (recovery's postcondition
 *   requires postState === 'HEALTHY').
 *
 *   Separately, `entitlements` does not exist as a table. The check caught the
 *   error, set status 'UNKNOWN', and pushed NOTHING — no issue, no warning. The
 *   unknown was invisible rather than reported.
 *
 * Contract (HYDI Master Execution Contract, Phase 7):
 *   - Core system health is queue + event flow + automation ONLY.
 *   - An absent optional integration yields OPTIONAL_SERVICE_UNAVAILABLE and
 *     must never degrade core status.
 *   - UNKNOWN must stay visible. Never UNKNOWN -> PASS. Never silently dropped.
 *
 * @supabase/supabase-js is mocked; these tests never touch a real database.
 */

let mockCreateClient;
jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args) => mockCreateClient(...args),
}));

function makeFakeSupabase(tableHandlers) {
  return {
    from(table) {
      const calls = { eq: null, limit: null };
      const builder = {
        select: () => builder,
        order: () => builder,
        gte: () => builder,
        or: () => builder,
        eq: (field, value) => { calls.eq = { field, value }; return builder; },
        limit: (n) => { calls.limit = n; return builder; },
        maybeSingle: async () => {
          const handler = tableHandlers[table];
          if (!handler) return { data: null, error: { message: `no handler for ${table}` } };
          return handler({ ...calls, calledMaybeSingle: true });
        },
        then: (resolve, reject) => {
          const handler = tableHandlers[table];
          const result = handler
            ? handler({ ...calls, calledMaybeSingle: false })
            : { data: null, error: { message: `no handler for ${table}` } };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

function minutesAgo(n) {
  return new Date(Date.now() - n * 60 * 1000).toISOString();
}

/** A fully healthy core: fresh events, live heartbeat, empty queue. */
function healthyCoreHandlers() {
  const events = [
    { event_type: 'cognitive_cycle', created_at: minutesAgo(1) },
    { event_type: 'cognitive_cycle', created_at: minutesAgo(2) },
    { event_type: 'cognitive_cycle', created_at: minutesAgo(3) },
    { event_type: 'cognitive_cycle', created_at: minutesAgo(4) },
  ];
  return {
    heidi_events: ({ eq, limit, calledMaybeSingle }) => {
      if (eq && eq.field === 'event_type' && eq.value === 'cognitive_cycle') {
        return { data: events, error: null };
      }
      const sorted = [...events].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      if (calledMaybeSingle) return { data: sorted[0] || null, error: null };
      return { data: sorted.slice(0, limit || sorted.length), error: null };
    },
    jobs: () => ({ data: [], error: null }),
  };
}

const TABLE_MISSING = {
  code: '42P01',
  message: 'relation "public.entitlements" does not exist',
};

describe('Phase 7 — revenue is an optional integration, not core health', () => {
  let ORIGINAL_STRIPE;

  beforeEach(() => {
    jest.resetModules();
    process.env.SUPABASE_URL = 'http://fake';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key';
    ORIGINAL_STRIPE = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
  });

  afterEach(() => {
    if (ORIGINAL_STRIPE === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = ORIGINAL_STRIPE;
  });

  function load(tableHandlers) {
    mockCreateClient = () => makeFakeSupabase(tableHandlers);
    return require('../../true-system-health');
  }

  test('R1: Stripe not configured -> OPTIONAL_SERVICE_UNAVAILABLE, not WARNING', async () => {
    const { checkRevenue } = load({ webhook_events: () => ({ data: [], error: null }) });
    const r = await checkRevenue(makeFakeSupabase({ webhook_events: () => ({ data: [], error: null }) }), {});
    expect(r.status).toBe('OPTIONAL_SERVICE_UNAVAILABLE');
    expect(r.reason).toBe('stripe_not_configured');
    expect(r.configured).toBe(false);
    // The exact false signal that caused the incident must not reappear.
    expect(r.status).not.toBe('WARNING');
  });

  test('R2: Stripe configured but zero payments -> NO_ACTIVITY (a business fact, not a fault)', async () => {
    const { checkRevenue } = load({});
    const r = await checkRevenue(
      makeFakeSupabase({ webhook_events: () => ({ data: [], error: null }) }),
      { STRIPE_SECRET_KEY: 'sk_test_x' }
    );
    expect(r.status).toBe('NO_ACTIVITY');
    expect(r.configured).toBe(true);
    expect(r.payments24h).toBe(0);
    expect(r.status).not.toBe('WARNING');
  });

  test('R3: Stripe configured with payments -> OK and revenue totalled', async () => {
    const { checkRevenue } = load({});
    const r = await checkRevenue(
      makeFakeSupabase({
        webhook_events: () => ({ data: [{ amount: '2500' }, { amount: '1000' }], error: null }),
      }),
      { STRIPE_SECRET_KEY: 'sk_test_x' }
    );
    expect(r.status).toBe('OK');
    expect(r.payments24h).toBe(2);
    expect(r.revenue24h).toBeCloseTo(35.0, 2);
  });

  test('R4: query failure -> UNKNOWN, never OK (no UNKNOWN -> PASS)', async () => {
    const { checkRevenue } = load({});
    const r = await checkRevenue(
      makeFakeSupabase({ webhook_events: () => ({ data: null, error: { message: 'boom' } }) }),
      { STRIPE_SECRET_KEY: 'sk_test_x' }
    );
    expect(r.status).toBe('UNKNOWN');
    expect(r.status).not.toBe('OK');
  });
});

describe('Phase 7 — entitlements UNKNOWN stays visible', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.SUPABASE_URL = 'http://fake';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key';
  });

  function load() {
    mockCreateClient = () => makeFakeSupabase({});
    return require('../../true-system-health');
  }

  test('E1: table missing -> OPTIONAL_SERVICE_UNAVAILABLE with an explicit reason', async () => {
    const { checkEntitlements } = load();
    const r = await checkEntitlements(
      makeFakeSupabase({ entitlements: () => ({ data: null, error: TABLE_MISSING }) })
    );
    expect(r.status).toBe('OPTIONAL_SERVICE_UNAVAILABLE');
    expect(r.reason).toBe('table_missing');
  });

  test('E2: unexpected error -> UNKNOWN, never OK', async () => {
    const { checkEntitlements } = load();
    const r = await checkEntitlements(
      makeFakeSupabase({ entitlements: () => ({ data: null, error: { message: 'connection reset' } }) })
    );
    expect(r.status).toBe('UNKNOWN');
    expect(r.status).not.toBe('OK');
  });

  test('E3: rows present -> OK with counts', async () => {
    const { checkEntitlements } = load();
    const r = await checkEntitlements(
      makeFakeSupabase({
        entitlements: () => ({ data: [{ status: 'active' }, { status: 'expired' }], error: null }),
      })
    );
    expect(r.status).toBe('OK');
    expect(r.active).toBe(1);
    expect(r.total).toBe(2);
  });
});

describe('Phase 7 — core status isolation (the decisive contract test)', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.SUPABASE_URL = 'http://fake';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key';
    delete process.env.STRIPE_SECRET_KEY;
  });

  // Tests here may set STRIPE_SECRET_KEY to reach the configured code path;
  // clear it so it cannot leak into another suite sharing this worker process.
  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
  });

  function loadWith(extraHandlers) {
    const handlers = { ...healthyCoreHandlers(), ...extraHandlers };
    mockCreateClient = () => makeFakeSupabase(handlers);
    return require('../../true-system-health');
  }

  test('C1: healthy core + absent Stripe + missing entitlements table -> status OK', async () => {
    const { getSystemHealth } = loadWith({
      webhook_events: () => ({ data: [], error: null }),
      entitlements: () => ({ data: null, error: TABLE_MISSING }),
    });
    const health = await getSystemHealth();

    // THE regression this phase exists to prevent.
    expect(health.status).toBe('OK');

    // Optional integrations are reported, separately, and truthfully.
    expect(health.optionalIntegrations.revenue.status).toBe('OPTIONAL_SERVICE_UNAVAILABLE');
    expect(health.optionalIntegrations.entitlements.status).toBe('OPTIONAL_SERVICE_UNAVAILABLE');

    // They are NOT core components.
    expect(health.components.revenue).toBeUndefined();
    expect(health.components.entitlements).toBeUndefined();

    // And they contributed nothing to the core verdict.
    const revenueWarnings = health.warnings.filter((w) => /revenue/i.test(w));
    expect(revenueWarnings).toHaveLength(0);
  });

  test('C2: an optional integration in UNKNOWN is surfaced in health.unknowns, not dropped', async () => {
    // Stripe must be CONFIGURED here, otherwise checkRevenue short-circuits to
    // OPTIONAL_SERVICE_UNAVAILABLE and never reaches the failing query we want
    // to exercise. This test is about a genuine unknown, not an absent service.
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    const { getSystemHealth } = loadWith({
      webhook_events: () => ({ data: null, error: { message: 'transient failure' } }),
      entitlements: () => ({ data: null, error: { message: 'connection reset' } }),
    });
    const health = await getSystemHealth();

    expect(Array.isArray(health.unknowns)).toBe(true);
    expect(health.unknowns.length).toBeGreaterThanOrEqual(2);
    expect(health.unknowns.join(' ')).toMatch(/revenue/i);
    expect(health.unknowns.join(' ')).toMatch(/entitlements/i);

    // Visible, but still not a core failure — unknown optional state is not a system fault.
    expect(health.status).toBe('OK');
    // And emphatically not silently upgraded.
    expect(health.optionalIntegrations.revenue.status).not.toBe('OK');
  });

  test('C3: core failures still degrade status — optional isolation must not mute real faults', async () => {
    const staleEvents = [{ event_type: 'cognitive_cycle', created_at: minutesAgo(180) }];
    mockCreateClient = () =>
      makeFakeSupabase({
        heidi_events: ({ eq, limit, calledMaybeSingle }) => {
          if (eq && eq.field === 'event_type' && eq.value === 'cognitive_cycle') {
            return { data: [], error: null }; // no heartbeat in 5 min
          }
          if (calledMaybeSingle) return { data: staleEvents[0], error: null };
          return { data: staleEvents.slice(0, limit || 1), error: null };
        },
        jobs: () => ({ data: [], error: null }),
        webhook_events: () => ({ data: [], error: null }),
        entitlements: () => ({ data: null, error: TABLE_MISSING }),
      });
    const { getSystemHealth } = require('../../true-system-health');
    const health = await getSystemHealth();

    // Event flow stale by 180 min -> CRITICAL. Optional isolation must not suppress this.
    expect(health.components.eventFlow.status).toBe('CRITICAL');
    expect(health.status).toBe('CRITICAL');
  });

  test('C4: UNKNOWN is never converted to PASS anywhere in the payload', async () => {
    // As in C2: configured-but-failing is what produces a true UNKNOWN.
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    const { getSystemHealth } = loadWith({
      webhook_events: () => ({ data: null, error: { message: 'x' } }),
      entitlements: () => ({ data: null, error: { message: 'y' } }),
    });
    const health = await getSystemHealth();
    const serialized = JSON.stringify(health);
    // If a component reports UNKNOWN it must still read UNKNOWN in the payload.
    expect(health.optionalIntegrations.revenue.status).toBe('UNKNOWN');
    expect(health.optionalIntegrations.entitlements.status).toBe('UNKNOWN');
    expect(serialized).toContain('UNKNOWN');
  });
});
