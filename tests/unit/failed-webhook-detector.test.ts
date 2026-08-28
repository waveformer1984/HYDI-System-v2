/**
 * Qualification scenarios for FailedWebhookDetector
 */

import { FailedWebhookDetector } from '../../lib/operational/FailedWebhookDetector';
import { resetEscalationNotifier } from '../../lib/operational/EscalationNotifier';

// Mock getStripeMode so the system-mode check doesn't interfere with tests.
// Individual tests can override this by calling jest.mocked(getStripeMode).mockReturnValue(...).
jest.mock('../../lib/revenue/stripe-mode', () => ({
  ...jest.requireActual('../../lib/revenue/stripe-mode'),
  getStripeMode: jest.fn(() => ({ mode: 'live', keyPrefix: 'sk_live_', liveAllowed: true, configured: true, webhookConfigured: true })),
  isTestRecord: jest.fn((opts: { checkoutSessionId?: string | null; eventId?: string | null }) => {
    if (opts.checkoutSessionId !== undefined) {
      return !opts.checkoutSessionId || opts.checkoutSessionId.startsWith('cs_test_');
    }
    if (opts.eventId !== undefined) {
      return !opts.eventId || opts.eventId.startsWith('evt_test_');
    }
    return true;
  }),
  isSyntheticTestEvent: jest.fn((eventId: string | null | undefined) => {
    return !eventId || eventId.startsWith('evt_test_');
  }),
}));

import { getStripeMode } from '../../lib/revenue/stripe-mode';

/**
 * Creates a mock Supabase client using a thenable builder pattern.
 * The builder accumulates filter calls and resolves as a Promise
 * when awaited (at any point in the chain).
 */
function createMockSupabase(config: {
  failedWebhooks?: any[];
  staleWebhooks?: any[];
  retryLog?: Record<string, boolean>;
  boundary?: string | null;
}) {
  const failedWebhooks = config.failedWebhooks || [];
  const staleWebhooks = config.staleWebhooks || [];
  const retryLog = config.retryLog || {};
  const boundary = config.boundary;
  const insertLog: any[] = [];
  const updateLog: any[] = [];

  // Thenable builder: an object that acts as both a chainable query
  // builder and a Promise (so `await` works at any point).
  function createBuilder(resolveData: { data: any; error: any }) {
    const builder: any = {
      then(resolve: any, reject: any) {
        return Promise.resolve(resolveData).then(resolve, reject);
      },
      eq(_col: string, _val: string) { return this; },
      lt(_col: string, _val: string) { return this; },
      gte(_col: string, _val: string) { return this; },
      order(_col: string, _opts: any) { return this; },
      limit(_n: number) { return this; },
      maybeSingle() { return Promise.resolve(resolveData); },
      single() { return Promise.resolve(resolveData); },
    };
    return builder;
  }

  return {
    _insertLog: insertLog,
    _updateLog: updateLog,
    from(table: string) {
      if (table === 'operational_boundary') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({
                data: boundary === undefined ? { go_live_at: new Date().toISOString() } : (boundary === null ? null : { go_live_at: boundary }),
                error: boundary === null ? { message: 'not found' } : null,
              }),
            }),
          }),
        };
      }
      if (table === 'webhook_events') {
        return {
          select: (_cols?: string) => {
            // Return a builder that resolves based on what filters are applied.
            // We need to track the eq() value to know which data to return.
            let currentStatus: string | null = null;
            const builder: any = {
              eq(col: string, val: string) {
                if (col === 'status') currentStatus = val;
                return this;
              },
              lt(_col: string, _val: string) { return this; },
              gte(_col: string, _val: string) { return this; },
              order(_col: string, _opts: any) { return this; },
              limit(_n: number) { return this; },
              then(resolve: any, reject: any) {
                let data: any[] = [];
                if (currentStatus === 'failed') data = failedWebhooks;
                else if (currentStatus === 'processing') data = staleWebhooks;
                return Promise.resolve({ data, error: null }).then(resolve, reject);
              },
            };
            return builder;
          },
          update: (data: any) => ({
            eq: (_col: string, _val: string) => {
              updateLog.push(data);
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === 'webhook_retry_log') {
        return {
          select: (_cols?: string) => {
            let targetId: string | null = null;
            const builder: any = {
              eq(col: string, val: string) {
                if (col === 'webhook_id') targetId = val;
                return this;
              },
              limit(_n: number) { return this; },
              then(resolve: any, reject: any) {
                const data = targetId && retryLog[targetId] ? [{ id: 'existing' }] : [];
                return Promise.resolve({ data, error: null }).then(resolve, reject);
              },
            };
            return builder;
          },
          insert: (row: any) => {
            insertLog.push({ table, row });
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === 'operator_escalations') {
        return {
          insert: (row: any) => {
            insertLog.push({ table, row });
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === 'push_subscriptions') {
        return {
          select: (_cols?: string) => {
            const builder: any = {
              eq(_col: string, _val: any) { return this; },
              then(resolve: any, reject: any) {
                return Promise.resolve({ data: [], error: null }).then(resolve, reject);
              },
            };
            return builder;
          },
        };
      }
      // Generic fallback
      return {
        select: () => createBuilder({ data: [], error: null }),
        insert: (row: any) => {
          insertLog.push({ table, row });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

describe('FailedWebhookDetector qualification scenarios', () => {
  beforeEach(() => {
    resetEscalationNotifier();
    jest.spyOn(console, 'log').mockImplementation(() => { });
    jest.spyOn(console, 'error').mockImplementation(() => { });
    jest.spyOn(console, 'warn').mockImplementation(() => { });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('a failed webhook that has NOT been retried gets retried once', async () => {
    const failedWebhooks = [{
      id: 'webhook-001',
      event_id: 'evt_001',
      type: 'payment_intent.payment_failed',
      status: 'failed',
      payload: { data: {} },
      created_at: hoursAgo(2),
    }];

    const mock = createMockSupabase({ failedWebhooks, retryLog: {} });
    const detector = new FailedWebhookDetector({ supabase: mock, observeOnly: false });

    const summary = await detector.detectAndRecover();

    expect(summary.totalFailed).toBe(1);
    expect(summary.retried).toBe(1);
    expect(summary.escalated).toBe(0);
    expect(mock._updateLog).toContainEqual({ status: 'queued' });
  });

  test('a failed webhook that HAS been retried is escalated, not retried again', async () => {
    const failedWebhooks = [{
      id: 'webhook-002',
      event_id: 'evt_002',
      type: 'checkout.session.completed',
      status: 'failed',
      payload: { data: {} },
      created_at: hoursAgo(5),
    }];

    const mock = createMockSupabase({
      failedWebhooks,
      retryLog: { 'webhook-002': true },
    });
    const detector = new FailedWebhookDetector({ supabase: mock, observeOnly: false });

    const summary = await detector.detectAndRecover();

    expect(summary.totalFailed).toBe(1);
    expect(summary.retried).toBe(0);
    expect(summary.escalated).toBe(1);
    expect(mock._updateLog).not.toContainEqual({ status: 'queued' });
  });

  test('a stale processing webhook is escalated, NOT auto-reset (prevent duplicates)', async () => {
    const staleWebhooks = [{
      id: 'webhook-003',
      event_id: 'evt_003',
      type: 'invoice.payment_succeeded',
      status: 'processing',
      payload: { data: {} },
      created_at: hoursAgo(3),
    }];

    const mock = createMockSupabase({ staleWebhooks, retryLog: {} });
    const detector = new FailedWebhookDetector({
      supabase: mock,
      observeOnly: false,
      staleThresholdMs: 60 * 60 * 1000,
    });

    const summary = await detector.detectAndRecover();

    expect(summary.totalStale).toBe(1);
    expect(summary.retried).toBe(0);
    expect(summary.escalated).toBe(1);
    expect(mock._updateLog).not.toContainEqual({ status: 'queued' });
  });

  test('a recently-processing webhook is NOT flagged as stale (false-positive prevention)', async () => {
    const mock = createMockSupabase({ staleWebhooks: [], retryLog: {} });
    const detector = new FailedWebhookDetector({
      supabase: mock,
      observeOnly: false,
      staleThresholdMs: 60 * 60 * 1000,
    });

    const summary = await detector.detectAndRecover();

    expect(summary.totalStale).toBe(0);
    expect(summary.escalated).toBe(0);
    expect(summary.retried).toBe(0);
  });

  test('a mix of retriable and already-retried webhooks acts correctly', async () => {
    const failedWebhooks = [
      {
        id: 'webhook-retriable',
        event_id: 'evt_retriable',
        type: 'payment_intent.payment_failed',
        status: 'failed',
        payload: { data: {} },
        created_at: hoursAgo(1),
      },
      {
        id: 'webhook-already-retried',
        event_id: 'evt_already_retried',
        type: 'checkout.session.completed',
        status: 'failed',
        payload: { data: {} },
        created_at: hoursAgo(4),
      },
    ];

    const mock = createMockSupabase({
      failedWebhooks,
      retryLog: { 'webhook-already-retried': true },
    });
    const detector = new FailedWebhookDetector({ supabase: mock, observeOnly: false });

    const summary = await detector.detectAndRecover();

    expect(summary.totalFailed).toBe(2);
    expect(summary.retried).toBe(1);
    expect(summary.escalated).toBe(1);
  });

  test('observe-only mode detects but does NOT retry or escalate', async () => {
    const failedWebhooks = [{
      id: 'webhook-005',
      event_id: 'evt_005',
      type: 'payment_intent.payment_failed',
      status: 'failed',
      payload: { data: {} },
      created_at: hoursAgo(2),
    }];

    const mock = createMockSupabase({ failedWebhooks, retryLog: {} });
    const detector = new FailedWebhookDetector({ supabase: mock, observeOnly: true });

    const summary = await detector.detectAndRecover();

    expect(summary.totalFailed).toBe(1);
    expect(summary.retried).toBe(0);
    expect(summary.escalated).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(summary.observeOnly).toBe(true);
    expect(mock._updateLog).toHaveLength(0);
  });

  test('empty database produces no findings', async () => {
    const mock = createMockSupabase({});
    const detector = new FailedWebhookDetector({ supabase: mock, observeOnly: false });

    const summary = await detector.detectAndRecover();

    expect(summary.totalFailed).toBe(0);
    expect(summary.totalStale).toBe(0);
    expect(summary.retried).toBe(0);
    expect(summary.escalated).toBe(0);
  });

  // --- Mode-based exclusion tests ---
  // These verify the primary, permanent exclusion: test-mode webhooks
  // (evt_test_* event IDs or cs_test_* in payload) are excluded even
  // when their timestamp is after the go_live_at boundary.

  test('a synthetic test webhook (evt_test_) created AFTER the boundary is excluded', async () => {
    // This is the specific scenario that would have slipped through the
    // timestamp-only fix: a new test webhook created after go_live_at.
    const futureBoundary = '2020-01-01T00:00:00Z';
    const failedWebhooks = [{
      id: 'webhook-test-after-boundary',
      event_id: 'evt_test_newQualificationRun',
      type: 'checkout.session.completed',
      status: 'failed',
      payload: { data: { object: { id: 'cs_test_newRun' } } },
      created_at: new Date().toISOString(),
    }];

    const mock = createMockSupabase({ failedWebhooks, retryLog: {}, boundary: futureBoundary });
    const detector = new FailedWebhookDetector({ supabase: mock, observeOnly: false });

    const summary = await detector.detectAndRecover();

    // The test-mode webhook must be excluded — zero findings
    expect(summary.totalFailed).toBe(0);
    expect(summary.retried).toBe(0);
    expect(summary.escalated).toBe(0);
  });

  test('a real Stripe test-mode webhook (cs_test_ in payload) is excluded', async () => {
    // Real Stripe events generated against sk_test_ have real-looking event IDs
    // but their payload contains cs_test_ checkout sessions.
    const futureBoundary = '2020-01-01T00:00:00Z';
    const failedWebhooks = [{
      id: 'webhook-real-test-mode',
      event_id: 'evt_3U8YLcITaXOHazrh1XQMmQ0I',
      type: 'checkout.session.completed',
      status: 'failed',
      payload: { data: { object: { id: 'cs_test_a1B2c3D4e5F6g7H8i9J0' } } },
      created_at: new Date().toISOString(),
    }];

    const mock = createMockSupabase({ failedWebhooks, retryLog: {}, boundary: futureBoundary });
    const detector = new FailedWebhookDetector({ supabase: mock, observeOnly: false });

    const summary = await detector.detectAndRecover();

    // Excluded because the payload has cs_test_ — it's test-mode
    expect(summary.totalFailed).toBe(0);
    expect(summary.retried).toBe(0);
    expect(summary.escalated).toBe(0);
  });

  test('a live-mode webhook (cs_live_ in payload) IS checked', async () => {
    const futureBoundary = '2020-01-01T00:00:00Z';
    const failedWebhooks = [{
      id: 'webhook-live-mode',
      event_id: 'evt_3U8YLcITaXOHazrh1XQMmQ0I',
      type: 'checkout.session.completed',
      status: 'failed',
      payload: { data: { object: { id: 'cs_live_realCustomer123' } } },
      created_at: new Date().toISOString(),
    }];

    const mock = createMockSupabase({ failedWebhooks, retryLog: {}, boundary: futureBoundary });
    const detector = new FailedWebhookDetector({ supabase: mock, observeOnly: false });

    const summary = await detector.detectAndRecover();

    // Live-mode webhook is checked — it's a real customer
    expect(summary.totalFailed).toBe(1);
    expect(summary.retried).toBe(1); // first failure, retried
  });

  test('mix of test-mode and live-mode webhooks — only live webhooks are checked', async () => {
    const futureBoundary = '2020-01-01T00:00:00Z';
    const failedWebhooks = [
      { id: 'w-test-1', event_id: 'evt_test_abc', type: 'checkout.session.completed', status: 'failed', payload: { data: { object: { id: 'cs_test_abc' } } }, created_at: new Date().toISOString() },
      { id: 'w-live-1', event_id: 'evt_3U8YLcITaXOHazrh1XQMmQ0I', type: 'checkout.session.completed', status: 'failed', payload: { data: { object: { id: 'cs_live_xyz' } } }, created_at: new Date().toISOString() },
      { id: 'w-test-2', event_id: 'evt_test_def', type: 'payment_intent.succeeded', status: 'failed', payload: { data: { object: { id: 'cs_test_def' } } }, created_at: new Date().toISOString() },
    ];

    const mock = createMockSupabase({ failedWebhooks, retryLog: {}, boundary: futureBoundary });
    const detector = new FailedWebhookDetector({ supabase: mock, observeOnly: false });

    const summary = await detector.detectAndRecover();

    // Only the 1 live webhook is checked; the 2 test webhooks are excluded
    expect(summary.totalFailed).toBe(1);
    expect(summary.retried).toBe(1); // the live one
  });

  test('a real Stripe test-mode event (empty payload, system in test mode) is excluded', async () => {
    // This is the case that can only be caught by the system-mode check:
    // real Stripe event ID (not evt_test_), empty payload, but the system
    // is running with sk_test_ so all Stripe events are test-mode.
    const futureBoundary = '2020-01-01T00:00:00Z';
    const failedWebhooks = [{
      id: 'webhook-real-test-mode-empty-payload',
      event_id: 'evt_3U8YLcITaXOHazrh1XQMmQ0I',
      type: 'charge.updated',
      status: 'failed',
      payload: {},
      created_at: new Date().toISOString(),
    }];

    // System is in test mode
    jest.mocked(getStripeMode).mockReturnValueOnce({
      mode: 'test', keyPrefix: 'sk_test_', liveAllowed: false, configured: true, webhookConfigured: true,
    });

    const mock = createMockSupabase({ failedWebhooks, retryLog: {}, boundary: futureBoundary });
    const detector = new FailedWebhookDetector({ supabase: mock, observeOnly: false });

    const summary = await detector.detectAndRecover();

    // Excluded because the system is in test mode
    expect(summary.totalFailed).toBe(0);
    expect(summary.retried).toBe(0);
    expect(summary.escalated).toBe(0);
  });

  test('a real Stripe live-mode event (empty payload, system in live mode) IS checked', async () => {
    const futureBoundary = '2020-01-01T00:00:00Z';
    const failedWebhooks = [{
      id: 'webhook-live-mode-empty-payload',
      event_id: 'evt_3U8YLcITaXOHazrh1XQMmQ0I',
      type: 'checkout.session.completed',
      status: 'failed',
      payload: {},
      created_at: new Date().toISOString(),
    }];

    // System is in live mode
    jest.mocked(getStripeMode).mockReturnValueOnce({
      mode: 'live', keyPrefix: 'sk_live_', liveAllowed: true, configured: true, webhookConfigured: true,
    });

    const mock = createMockSupabase({ failedWebhooks, retryLog: {}, boundary: futureBoundary });
    const detector = new FailedWebhookDetector({ supabase: mock, observeOnly: false });

    const summary = await detector.detectAndRecover();

    // Checked because the system is in live mode
    expect(summary.totalFailed).toBe(1);
    expect(summary.retried).toBe(1);
  });
});
