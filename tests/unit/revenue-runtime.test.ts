/**
 * RevenueRuntime tests — Phase H revenue lifecycle.
 *
 * Simulates the durable event fold + customer_jobs rows in memory so no
 * Stripe call, no DB, and no network is needed. The assertions are on
 * durable transitions — what the Control Tower would fold.
 */

import { RevenueRuntime } from '../../lib/heidi/RevenueRuntime';
import type { CommercialStage } from '../../lib/heidi/CommercialBridge';

interface Ev { event_type: string; division: string; payload: Record<string, unknown>; created_at: string }

interface JobRow { job_id: string; payment_status: string; job_status: string; delivery_status: string | null; requirements: Record<string, unknown>; created_at: string }

function fakeDb(seedEvents: Ev[] = [], seedJobs: JobRow[] = []) {
  const events = [...seedEvents];
  const jobs = [...seedJobs];
  const inserts = { events: 0 };
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.startsWith('INSERT INTO heidi_events')) {
        inserts.events++;
        const payload = typeof params?.[1] === 'string' ? JSON.parse(params![1] as string) : params?.[1];
        events.push({ event_type: 'commercial_offer_transition', division: 'commercial', payload, created_at: new Date().toISOString() });
        return { rows: [] };
      }
      if (sql.includes("division='commercial'") && sql.includes('ORDER BY created_at')) {
        return { rows: events.map(e => ({ event_type: e.event_type, payload: e.payload, created_at: e.created_at })) };
      }
      if (sql.includes('FROM customer_jobs')) {
        const offerId = params?.[0];
        const matched = jobs.filter(j => j.requirements?.offerId === offerId || events.some(e => e.payload?.offerId === offerId && e.payload?.jobId === j.job_id));
        return { rows: matched };
      }
      if (sql.includes('protoforge_opportunities')) return { rows: [] };
      if (sql.includes('business_finding')) return { rows: [] };
      return { rows: [] };
    },
  };
  return { pool: pool as never, events, jobs, inserts };
}

function offerEvent(offerId: string, stage: CommercialStage, extra: Record<string, unknown> = {}): Ev {
  return {
    event_type: 'commercial_offer', division: 'commercial',
    payload: { offerId, opportunityId: 'opp-1', opportunityTitle: 'test opp', product: 'protoforge_model_prep', priceCents: 2900, currency: 'usd', stage, ...extra },
    created_at: new Date().toISOString(),
  };
}

const DEPS = {
  createJob: async (input: { customerEmail: string; product: string; requirements?: Record<string, unknown> }) => ({ jobId: 'job_test_1' }),
  createCheckoutSession: async () => ({ sessionId: 'cs_test_abc123', url: 'https://checkout.stripe.com/test' }),
  reconcileJob: async () => ({ state: 'CONSISTENT' }),
};

describe('RevenueRuntime', () => {
  const OLD_ENV = { ...process.env };
  afterEach(() => { process.env = { ...OLD_ENV }; });

  it('CHECKOUT_READY with no customer identity → AUTHORIZATION_REQUIRED (human boundary)', async () => {
    const db = fakeDb([offerEvent('offer-x', 'CHECKOUT_READY')]);
    const rt = new RevenueRuntime(db.pool, DEPS);
    const [r] = await rt.advance({ offerId: 'offer-x' });
    expect(r.newStage).toBe('AUTHORIZATION_REQUIRED');
    expect(r.boundary).toBe('human_authorization');
    // durable transition recorded
    expect(db.events.some(e => e.payload.newStage === 'AUTHORIZATION_REQUIRED')).toBe(true);
  });

  it('CHECKOUT_READY + customer + no Stripe key → OFFER_BLOCKED (NOT_WIRED, no external call)', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY_01;
    const db = fakeDb([offerEvent('offer-x', 'CHECKOUT_READY')]);
    let checkoutCalled = 0;
    const rt = new RevenueRuntime(db.pool, {
      ...DEPS,
      createCheckoutSession: async () => { checkoutCalled++; return { sessionId: 'x', url: 'y' }; },
    });
    const [r] = await rt.advance({ offerId: 'offer-x', customerEmail: 'c@x.dev' });
    expect(r.newStage).toBe('OFFER_BLOCKED');
    expect(r.boundary).toBe('not_wired');
    expect(checkoutCalled).toBe(0); // no payment call was made
  });

  it('CHECKOUT_READY + customer + test mode → PAYMENT_PENDING via real job+session', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_4eC39HqLyjWDarjtT1zdp7dc';
    const db = fakeDb([offerEvent('offer-x', 'CHECKOUT_READY')]);
    const rt = new RevenueRuntime(db.pool, DEPS);
    const [r] = await rt.advance({ offerId: 'offer-x', customerEmail: 'c@x.dev' });
    expect(r.newStage).toBe('PAYMENT_PENDING');
    expect(r.jobId).toBe('job_test_1');
    expect(db.events.some(e => e.payload.newStage === 'PAYMENT_PENDING')).toBe(true);
  });

  it('idempotent: re-dispatch of a bound offer resumes, never duplicates the job', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_4eC39HqLyjWDarjtT1zdp7dc';
    const db = fakeDb(
      [offerEvent('offer-x', 'CHECKOUT_READY')],
      [{ job_id: 'job_test_1', payment_status: 'pending', job_status: 'queued', delivery_status: null, requirements: { offerId: 'offer-x' }, created_at: new Date().toISOString() }],
    );
    let jobCalls = 0;
    const rt = new RevenueRuntime(db.pool, {
      ...DEPS,
      createJob: async () => { jobCalls++; return { jobId: 'job_dup' }; },
    });
    const [r] = await rt.advance({ offerId: 'offer-x', customerEmail: 'c@x.dev' });
    expect(r.action).toBe('idempotent_resume');
    expect(r.jobId).toBe('job_test_1');
    expect(jobCalls).toBe(0); // no duplicate consequential action
  });

  it('PAYMENT_PENDING observes webhook-written payment → PAID (read-only, never asserts payment)', async () => {
    const db = fakeDb(
      [offerEvent('offer-x', 'PAYMENT_PENDING')],
      [{ job_id: 'job_1', payment_status: 'paid', job_status: 'queued', delivery_status: null, requirements: { offerId: 'offer-x' }, created_at: new Date().toISOString() }],
    );
    const rt = new RevenueRuntime(db.pool, DEPS);
    const [r] = await rt.advance({ offerId: 'offer-x' });
    expect(r.newStage).toBe('PAID');
    expect(r.jobId).toBe('job_1');
  });

  it('PAYMENT_PENDING with unpaid job stays put — does not fabricate PAID', async () => {
    const db = fakeDb(
      [offerEvent('offer-x', 'PAYMENT_PENDING')],
      [{ job_id: 'job_1', payment_status: 'pending', job_status: 'queued', delivery_status: null, requirements: { offerId: 'offer-x' }, created_at: new Date().toISOString() }],
    );
    const rt = new RevenueRuntime(db.pool, DEPS);
    const [r] = await rt.advance({ offerId: 'offer-x' });
    expect(r.newStage).toBe('PAYMENT_PENDING');
    expect(db.events.some(e => e.payload.newStage === 'PAID')).toBe(false);
  });

  it('DELIVERED + CONSISTENT reconcile → RECONCILED; MISMATCH stays in RECONCILING', async () => {
    const db = fakeDb(
      [offerEvent('offer-x', 'DELIVERED')],
      [{ job_id: 'job_1', payment_status: 'paid', job_status: 'delivered', delivery_status: 'delivered', requirements: { offerId: 'offer-x' }, created_at: new Date().toISOString() }],
    );
    const ok = new RevenueRuntime(db.pool, DEPS);
    const [r1] = await ok.advance({ offerId: 'offer-x' });
    expect(r1.newStage).toBe('RECONCILED');

    const db2 = fakeDb(
      [offerEvent('offer-y', 'DELIVERED')],
      [{ job_id: 'job_2', payment_status: 'paid', job_status: 'delivered', delivery_status: 'delivered', requirements: { offerId: 'offer-y' }, created_at: new Date().toISOString() }],
    );
    const bad = new RevenueRuntime(db2.pool, { ...DEPS, reconcileJob: async () => ({ state: 'MISMATCH' }) });
    const [r2] = await bad.advance({ offerId: 'offer-y' });
    expect(r2.newStage).toBe('RECONCILING'); // never advances past a mismatch
    expect(db2.events.some(e => e.payload.newStage === 'RECONCILED')).toBe(false);
  });

  it('live mode without LiveTransactionAuthorization → AUTHORIZATION_REQUIRED, no checkout', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_4eC39HqLyjWDarjtT1zdp7dc';
    process.env.ALLOW_LIVE_STRIPE = 'true';
    const db = fakeDb([offerEvent('offer-x', 'CHECKOUT_READY')]);
    let checkoutCalled = 0;
    const rt = new RevenueRuntime(db.pool, {
      ...DEPS,
      pendingLiveAuthorizations: () => [], // none pending
      createCheckoutSession: async () => { checkoutCalled++; return { sessionId: 'cs_live_x', url: 'y' }; },
    });
    const [r] = await rt.advance({ offerId: 'offer-x', customerEmail: 'c@x.dev' });
    expect(r.newStage).toBe('AUTHORIZATION_REQUIRED');
    expect(r.boundary).toBe('human_authorization');
    expect(checkoutCalled).toBe(0);
  });
});
