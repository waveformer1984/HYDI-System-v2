/**
 * REVENUE CHAIN STAGE INVARIANTS — PAYMENT_PENDING → PAID → RECONCILED.
 *
 * Complements authorized-revenue-advance.test.ts (which proves the
 * CHECKOUT_READY → AUTHORIZATION_REQUIRED boundary) by proving the stages
 * BEYOND it keep their contracts:
 *
 *   - PAYMENT_PENDING only observes webhook-written payment — the runtime
 *     never promotes an unpaid job to PAID.
 *   - Live mode requires a LiveTransactionAuthorization matching customer,
 *     amount AND currency — a mismatch in any one refuses checkout.
 *   - Job creation is offer-bound and idempotent — an existing job for the
 *     offer resumes instead of duplicating.
 *   - RECONCILED is terminal for the runtime — REVENUE_PROVEN belongs to
 *     ProofEngine alone, and ProofEngine refuses test-mode revenue claims.
 *
 * Pools are fake event-sourced stores (same pattern as
 * authorized-revenue-advance.test.ts) — no Stripe, no DB.
 */
import { RevenueRuntime } from '../../lib/heidi/RevenueRuntime';
import { collectOffers } from '../../lib/heidi/CommercialBridge';
import { ProofEngine } from '../../lib/heidi/ProofEngine';
import type { Pool } from 'pg';

const OFFER = 'offer-cccc11112222';
const JOB = 'job_test_chain_001';

type Stage = string;
interface JobRow {
  job_id: string; payment_status: string; job_status: string;
  delivery_status: string | null; stripe_checkout_session_id: string | null;
}

function makeStore(stage: Stage, job: JobRow | null) {
  const events = [{
    event_type: 'commercial_offer',
    payload: {
      offerId: OFFER, opportunityId: 'opp-chain', opportunityTitle: 'chain probe',
      product: 'protoforge_model_prep', priceCents: 2900, currency: 'usd', stage,
    },
    created_at: new Date().toISOString(),
  }] as Array<{ event_type: string; payload: Record<string, unknown>; created_at: string }>;
  const calls = { jobWrites: 0, createJob: 0, createCheckout: 0 };
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      if (/FROM heidi_events\s+WHERE division='commercial'/s.test(sql)) return { rows: events };
      if (/INSERT INTO heidi_events/.test(sql)) {
        events.push({
          event_type: String(params?.[0]), payload: JSON.parse(String(params?.[1])),
          created_at: new Date().toISOString(),
        });
        return { rows: [] };
      }
      if (/FROM customer_jobs/.test(sql)) {
        if (/INSERT|UPDATE/i.test(sql)) calls.jobWrites++;
        return { rows: job ? [job] : [] };
      }
      return { rows: [] };
    },
  } as unknown as Pool;
  return { pool, events, calls };
}

const stageOf = async (pool: Pool) => (await collectOffers(pool)).find(o => o.offerId === OFFER)?.stage;
const transitions = (events: Array<{ event_type: string }>) =>
  events.filter(e => e.event_type === 'commercial_offer_transition');

describe('PAYMENT_PENDING — payment is observed, never promoted', () => {
  it('unpaid job → stays PAYMENT_PENDING, zero transitions written', async () => {
    const { pool, events } = makeStore('PAYMENT_PENDING', {
      job_id: JOB, payment_status: 'pending', job_status: 'created',
      delivery_status: null, stripe_checkout_session_id: 'cs_test_x',
    });
    const r = await new RevenueRuntime(pool).advance({ offerId: OFFER });
    expect(r[0].newStage).toBe('PAYMENT_PENDING');
    expect(r[0].action).toBe('observe');
    expect(transitions(events)).toHaveLength(0);
    expect(await stageOf(pool)).toBe('PAYMENT_PENDING');
  });

  it('webhook-written paid → PAID transition is durable', async () => {
    const { pool, events } = makeStore('PAYMENT_PENDING', {
      job_id: JOB, payment_status: 'paid', job_status: 'queued',
      delivery_status: null, stripe_checkout_session_id: 'cs_test_x',
    });
    const r = await new RevenueRuntime(pool).advance({ offerId: OFFER });
    expect(r[0].newStage).toBe('PAID');
    expect(r[0].action).toBe('payment_confirmed');
    expect(await stageOf(pool)).toBe('PAID');
    expect(transitions(events)).toHaveLength(1);
  });
});

describe('CHECKOUT_READY — live-mode payment authorization binding', () => {
  const OLD = { KEY: process.env.STRIPE_SECRET_KEY, ALLOW: process.env.ALLOW_LIVE_STRIPE };
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_probekey';
    process.env.ALLOW_LIVE_STRIPE = 'true';
  });
  afterEach(() => {
    if (OLD.KEY === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = OLD.KEY;
    if (OLD.ALLOW === undefined) delete process.env.ALLOW_LIVE_STRIPE; else process.env.ALLOW_LIVE_STRIPE = OLD.ALLOW;
  });

  const deps = () => ({
    createJob: async () => ({ jobId: JOB }),
    createCheckoutSession: async () => ({ sessionId: 'cs_live_probe', url: 'http://x' }),
    linkCheckoutSession: async () => { },
    pendingLiveAuthorizations: () => [
      { customerEmail: 'customer-a@example.com', amountCents: 2900, currency: 'usd' },
    ],
  });

  it('no matching authorization → AUTHORIZATION_REQUIRED, job/checkout never created', async () => {
    const { pool, calls } = makeStore('CHECKOUT_READY', null);
    const d = deps();
    const spy = { ...d, createJob: async () => { calls.createJob++; return { jobId: JOB }; } };
    const r = await new RevenueRuntime(pool, spy).advance({
      offerId: OFFER, customerEmail: 'customer-b@example.com',
    });
    expect(r[0].newStage).toBe('AUTHORIZATION_REQUIRED');
    expect(r[0].boundary).toBe('human_authorization');
    expect(calls.createJob).toBe(0);
  });

  it('authorization for a different amount does not authorize this offer', async () => {
    const { pool } = makeStore('CHECKOUT_READY', null);
    const d = deps();
    const r = await new RevenueRuntime(pool, {
      ...d,
      pendingLiveAuthorizations: () => [{ customerEmail: 'customer-a@example.com', amountCents: 100, currency: 'usd' }],
    }).advance({ offerId: OFFER, customerEmail: 'customer-a@example.com' });
    expect(r[0].newStage).toBe('AUTHORIZATION_REQUIRED');
  });

  it('authorization for a different currency does not authorize this offer', async () => {
    const { pool } = makeStore('CHECKOUT_READY', null);
    const d = deps();
    const r = await new RevenueRuntime(pool, {
      ...d,
      pendingLiveAuthorizations: () => [{ customerEmail: 'customer-a@example.com', amountCents: 2900, currency: 'eur' }],
    }).advance({ offerId: OFFER, customerEmail: 'customer-a@example.com' });
    expect(r[0].newStage).toBe('AUTHORIZATION_REQUIRED');
  });

  it('exact customer+amount+currency match → PAYMENT_PENDING via injected deps', async () => {
    const { pool, calls } = makeStore('CHECKOUT_READY', null);
    const d = deps();
    let created = 0;
    const r = await new RevenueRuntime(pool, {
      ...d,
      createJob: async () => { created++; return { jobId: JOB }; },
    }).advance({ offerId: OFFER, customerEmail: 'customer-a@example.com' });
    expect(r[0].newStage).toBe('PAYMENT_PENDING');
    expect(r[0].action).toBe('checkout_created');
    expect(created).toBe(1);
    expect(calls.jobWrites).toBe(0);
  });

  it('the hosted checkout URL is bound to the job — a session id alone cannot take a customer to the payment page', async () => {
    const { pool } = makeStore('CHECKOUT_READY', null);
    const d = deps();
    const links: Array<[string, string, string | undefined]> = [];
    await new RevenueRuntime(pool, {
      ...d,
      linkCheckoutSession: async (jobId, sessionId, url) => { links.push([jobId, sessionId, url]); },
    }).advance({ offerId: OFFER, customerEmail: 'customer-a@example.com' });
    expect(links).toEqual([[JOB, 'cs_live_probe', 'http://x']]);
  });
});

describe('job creation is offer-bound and idempotent', () => {
  it('existing job for the offer → idempotent_resume, no second job/checkout', async () => {
    const OLD_KEY = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = 'sk_test_probekey'; // test mode — reaches the job check
    try {
      const { pool } = makeStore('CHECKOUT_READY', {
        job_id: JOB, payment_status: 'pending', job_status: 'created',
        delivery_status: null, stripe_checkout_session_id: 'cs_test_existing',
      });
      let created = 0;
      const r = await new RevenueRuntime(pool, {
        createJob: async () => { created++; return { jobId: 'job_other' }; },
        createCheckoutSession: async () => ({ sessionId: 'cs_test_other', url: 'http://x' }),
      }).advance({ offerId: OFFER, customerEmail: 'c@example.com' });
      expect(r[0].action).toBe('idempotent_resume');
      expect(r[0].jobId).toBe(JOB);
      expect(created).toBe(0);
    } finally {
      if (OLD_KEY === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = OLD_KEY;
    }
  });
});

describe('terminal honesty — the runtime never asserts proof', () => {
  it('RECONCILED offer → noop; REVENUE_PROVEN is ProofEngine\u2019s verdict, not a transition', async () => {
    const { pool, events } = makeStore('RECONCILED', {
      job_id: JOB, payment_status: 'paid', job_status: 'delivered',
      delivery_status: 'delivered', stripe_checkout_session_id: 'cs_test_x',
    });
    const r = await new RevenueRuntime(pool).advance({ offerId: OFFER });
    expect(r[0].action).toBe('noop');
    expect(transitions(events)).toHaveLength(0);
    expect(await stageOf(pool)).toBe('RECONCILED');
  });

  it('ProofEngine refuses revenue claims outright in non-live mode', async () => {
    const OLD_KEY = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = 'sk_test_probekey';
    try {
      const dummy = { query: async () => { throw new Error('must not query — mode gate first'); } } as unknown as Pool;
      const engine = new ProofEngine(dummy);
      for (const claim of ['revenue_verified', 'revenue_proven']) {
        const v = await engine.evaluate(claim);
        expect(v.verdict).toBe('REFUSED');
        expect(v.gap).toMatch(/test mode/);
      }
    } finally {
      if (OLD_KEY === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = OLD_KEY;
    }
  });
});
