'use strict';

/**
 * true-system-health.js — Event Flow health-definition tests.
 *
 * Root cause under test: the Event Flow sub-check treated "no
 * authorization_escalation row in 30 minutes" as equivalent to "the event
 * system is dead," even though cognitive_cycle (hydi-daemon's own heartbeat,
 * written through the exact same lib/heidi/CognitiveCore.ts pool.query() path
 * into the same heidi_events table) was flowing continuously the whole time.
 * See the investigation report for the full trace.
 *
 * @supabase/supabase-js is mocked so these tests never touch a real database.
 */

let mockCreateClient;
jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args) => mockCreateClient(...args),
}));

/**
 * Minimal chainable Supabase query-builder mock.
 * `tableHandlers[tableName]` receives the recorded call shape
 * ({ eq, limit, calledMaybeSingle }) and returns { data, error }.
 */
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

/** heidi_events handler distinguishing the three query shapes true-system-health.js issues. */
function heidiEventsHandler({ events }) {
  return ({ eq, limit, calledMaybeSingle }) => {
    if (eq && eq.field === 'event_type' && eq.value === 'cognitive_cycle') {
      // Automation heartbeat check (unchanged by this fix).
      return { data: events.filter((e) => e.event_type === 'cognitive_cycle'), error: null };
    }
    if (calledMaybeSingle) {
      // "last event" liveness check.
      const sorted = [...events].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return { data: sorted[0] || null, error: null };
    }
    // "recent events" (last hour, up to `limit`).
    const sorted = [...events].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { data: sorted.slice(0, limit || sorted.length), error: null };
  };
}

function minutesAgo(n) {
  return new Date(Date.now() - n * 60 * 1000).toISOString();
}

describe('true-system-health.js — Event Flow health definition', () => {
  let mod;

  beforeEach(() => {
    jest.resetModules();
    process.env.SUPABASE_URL = 'http://fake';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key';
  });

  function load(tableHandlers) {
    mockCreateClient = () => makeFakeSupabase(tableHandlers);
    mod = require('../../true-system-health');
    return mod;
  }

  // Test 1 — active cognitive heartbeat, no authorization escalation.
  test('Test 1: recent cognitive_cycle activity, no authorization_escalation -> NOT CRITICAL', async () => {
    const { checkEventFlow } = load({
      heidi_events: heidiEventsHandler({
        events: [
          { event_type: 'cognitive_cycle', created_at: minutesAgo(1) },
          { event_type: 'cognitive_cycle', created_at: minutesAgo(2) },
          { event_type: 'cognitive_cycle', created_at: minutesAgo(3) },
        ],
      }),
    });
    const supabase = mockCreateClient();
    const result = await checkEventFlow(supabase);
    expect(result.status).not.toBe('CRITICAL');
    expect(result.status).toBe('OK');
    expect(result.minutesSinceLastEvent).toBeLessThan(10);
  });

  // Test 2 — recent non-heartbeat operational event, no escalation needed.
  test('Test 2: recent legitimate operational event -> NOT CRITICAL', async () => {
    const { checkEventFlow } = load({
      heidi_events: heidiEventsHandler({
        events: [
          { event_type: 'hyve_opportunity_detected', created_at: minutesAgo(2) },
        ],
      }),
    });
    const supabase = mockCreateClient();
    const result = await checkEventFlow(supabase);
    expect(result.status).not.toBe('CRITICAL');
  });

  // Test 3 — genuine total event-system stall: nothing at all, of any type.
  test('Test 3: no heidi_events of any kind -> Event Flow remains CRITICAL', async () => {
    const { checkEventFlow } = load({
      heidi_events: heidiEventsHandler({ events: [] }),
    });
    const supabase = mockCreateClient();
    const result = await checkEventFlow(supabase);
    expect(result.status).toBe('CRITICAL');
    expect(result.minutesSinceLastEvent).toBeNull();
  });

  // Reproduces the exact real-world condition this investigation found: only
  // a stale authorization_escalation (21h old) but continuous fresh
  // cognitive_cycle activity. Must NOT be CRITICAL under the corrected logic.
  test('Reproduction: stale authorization_escalation + fresh cognitive_cycle -> NOT CRITICAL', async () => {
    const { checkEventFlow } = load({
      heidi_events: heidiEventsHandler({
        events: [
          { event_type: 'authorization_escalation', created_at: new Date(Date.now() - 21 * 60 * 60 * 1000).toISOString() },
          { event_type: 'cognitive_cycle', created_at: minutesAgo(1) },
        ],
      }),
    });
    const supabase = mockCreateClient();
    const result = await checkEventFlow(supabase);
    expect(result.status).toBe('OK');
  });

  // A real total stall must still be caught even with WARNING-tier staleness.
  test('WARNING tier preserved: last event 15 minutes ago -> WARNING, not CRITICAL and not OK', async () => {
    const { checkEventFlow } = load({
      heidi_events: heidiEventsHandler({
        events: [{ event_type: 'cognitive_cycle', created_at: minutesAgo(15) }],
      }),
    });
    const supabase = mockCreateClient();
    const result = await checkEventFlow(supabase);
    expect(result.status).toBe('WARNING');
  });
});

describe('true-system-health.js — getSystemHealth() end-to-end isolation', () => {
  let mod;

  beforeEach(() => {
    jest.resetModules();
    process.env.SUPABASE_URL = 'http://fake';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key';
  });

  function healthyFixtures(overrides = {}) {
    return {
      worker_jobs: () => ({ data: overrides.workerJobs ?? [], error: null }),
      heidi_events: heidiEventsHandler({
        events: overrides.heidiEvents ?? [
          { event_type: 'cognitive_cycle', created_at: minutesAgo(1) },
          { event_type: 'cognitive_cycle', created_at: minutesAgo(2) },
        ],
      }),
      webhook_events: () => ({ data: overrides.webhookEvents ?? [], error: null }),
      entitlements: () => ({ data: overrides.entitlements ?? [{ status: 'active' }], error: null }),
    };
  }

  function load(tableHandlers) {
    mockCreateClient = () => makeFakeSupabase(tableHandlers);
    mod = require('../../true-system-health');
    return mod;
  }

  // Test 4 — queue CRITICAL still forces overall CRITICAL even with a
  // healthy Event Flow. Proves the fix is isolated to Event Flow.
  test('Test 4: queue crossing its existing CRITICAL threshold still forces overall CRITICAL', async () => {
    const queuedJobs = Array.from({ length: 60 }, () => ({ status: 'queued' }));
    const { getSystemHealth } = load(healthyFixtures({ workerJobs: queuedJobs }));
    const health = await getSystemHealth();
    expect(health.components.queue.status).toBe('CRITICAL');
    expect(health.components.eventFlow.status).not.toBe('CRITICAL');
    expect(health.status).toBe('CRITICAL');
  });

  // Test 5 — automation heartbeat logic unchanged.
  test('Test 5: automation WARNING when no recent cognitive_cycle heartbeat (unchanged)', async () => {
    const { getSystemHealth } = load(healthyFixtures({
      // No cognitive_cycle at all anywhere -> event flow also CRITICAL here,
      // which is correct (total stall) and orthogonal to what this test checks.
      heidiEvents: [],
    }));
    const health = await getSystemHealth();
    expect(health.components.automation.status).toBe('WARNING');
  });

  test('Test 5b: automation OK when recent cognitive_cycle heartbeat present (unchanged)', async () => {
    const { getSystemHealth } = load(healthyFixtures());
    const health = await getSystemHealth();
    expect(health.components.automation.status).toBe('OK');
  });

  // Test 6 — revenue/entitlements checks unchanged.
  test('Test 6: revenue WARNING with zero payments, entitlements OK with rows present (unchanged)', async () => {
    const { getSystemHealth } = load(healthyFixtures());
    const health = await getSystemHealth();
    expect(health.components.revenue.status).toBe('WARNING'); // no payments in 24h, as before
    expect(health.components.entitlements.status).toBe('OK');
  });

  // The real-world reproduction, end to end: overall status must not be
  // CRITICAL when the only thing "wrong" is a stale authorization_escalation.
  test('End-to-end reproduction: overall status is not CRITICAL from stale escalation alone', async () => {
    const { getSystemHealth } = load(healthyFixtures({
      heidiEvents: [
        { event_type: 'authorization_escalation', created_at: new Date(Date.now() - 21 * 60 * 60 * 1000).toISOString() },
        { event_type: 'cognitive_cycle', created_at: minutesAgo(1) },
      ],
    }));
    const health = await getSystemHealth();
    expect(health.components.eventFlow.status).toBe('OK');
    expect(health.status).not.toBe('CRITICAL');
  });
});
