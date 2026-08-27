/**
 * Qualification scenarios for FailedWebhookDetector
 */

import { FailedWebhookDetector } from '../../lib/operational/FailedWebhookDetector';
import { resetEscalationNotifier } from '../../lib/operational/EscalationNotifier';

/**
 * Creates a mock Supabase client using a thenable builder pattern.
 * The builder accumulates filter calls and resolves as a Promise
 * when awaited (at any point in the chain).
 */
function createMockSupabase(config: {
  failedWebhooks?: any[];
  staleWebhooks?: any[];
  retryLog?: Record<string, boolean>;
}) {
  const failedWebhooks = config.failedWebhooks || [];
  const staleWebhooks = config.staleWebhooks || [];
  const retryLog = config.retryLog || {};
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
});
