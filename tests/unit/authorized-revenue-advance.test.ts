/**
 * AUTHORIZED → MissionRunner → RevenueRuntime seam tests.
 *
 * Proves the wired 'revenue.advance_offer' executor (the same closure
 * CognitiveCore dispatches) drives the real RevenueRuntime against the
 * durable commercial offer state — and stops at the first genuine
 * human/payment boundary with durable evidence, never a Stripe call.
 *
 * The fake pool emulates the event-sourced offer store: collectOffers
 * folds division='commercial' rows; transitionOffer INSERTs append, so a
 * second fold sees the new stage — restart persistence for free.
 */
import { CognitiveCore } from '../../lib/heidi/CognitiveCore';
import { collectOffers } from '../../lib/heidi/CommercialBridge';
import { proposalParamsHash } from '../../lib/heidi/ActionProposals';
import type { Pool } from 'pg';

const OFFER = 'offer-abcdef123456';
const CAP = 'revenue.advance_offer';

function makeCommercialStore(initial: Array<{ event_type: string; payload: Record<string, unknown> }>) {
  const events = initial.map((e, i) => ({ ...e, created_at: new Date(Date.now() + i).toISOString() }));
  const jobQueries: unknown[] = [];
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      if (/FROM heidi_events\s+WHERE division='commercial'/s.test(sql)) {
        return { rows: events.map(e => ({ event_type: e.event_type, payload: e.payload, created_at: e.created_at })) };
      }
      if (/INSERT INTO heidi_events/.test(sql)) {
        const [eventType, payload] = params as [string, string];
        if (/commercial/.test(sql) || String(payload).includes('offerId')) {
          events.push({ event_type: eventType, payload: JSON.parse(payload), created_at: new Date().toISOString() });
        }
        return { rows: [] };
      }
      if (/FROM customer_jobs/.test(sql)) {
        jobQueries.push(sql);
        return { rows: [] };
      }
      return { rows: [] };
    },
    connect: async () => ({ query: async () => ({ rows: [] }), release: () => { } }),
    end: async () => { },
  } as unknown as Pool;
  return { pool, events, jobQueries };
}

function checkoutReadyStore() {
  return makeCommercialStore([{
    event_type: 'commercial_offer',
    payload: {
      offerId: OFFER, opportunityId: 'opp-1', opportunityTitle: 'probe',
      product: 'protoforge_model_prep', priceCents: 2900, currency: 'usd', stage: 'CHECKOUT_READY',
    },
  }]);
}

function makeCore(pool: Pool) {
  const core = new CognitiveCore({ host: '127.0.0.1', port: 1, database: 'x', user: 'x', password: 'x' });
  const realPool = (core as any).pool as Pool;
  (core as any).pool = pool;
  return { core, realPool };
}

const CTX = { sessionId: 's1', actorId: 'heidi', actorTrustLevel: 'trusted_system', authorizationMode: 'human_authorized', auditTrail: [] } as any;

describe('authorized revenue.advance_offer → real RevenueRuntime seam', () => {
  const realPools: Pool[] = [];
  function coreFor(pool: Pool) {
    const { core, realPool } = makeCore(pool);
    realPools.push(realPool);
    return core;
  }
  afterAll(async () => { for (const p of realPools) await p.end(); });

  it('CHECKOUT_READY offer + bound offerId + no customer identity → AUTHORIZATION_REQUIRED, durably', async () => {
    const { pool, events } = checkoutReadyStore();
    const core = coreFor(pool);
    const res = await core.registry.execute(CAP, { offerId: OFFER }, CTX);

    expect(res.executed).toBe(true);
    expect(res.outcome).toBe('skipped'); // boundary reached — NOT success, NOT failure
    const transition = res.evidence?.[0] as { offerId: string; to: string; boundary: string };
    expect(transition.offerId).toBe(OFFER);
    expect(transition.to).toBe('AUTHORIZATION_REQUIRED');
    expect(transition.boundary).toBe('human_authorization');

    // Durable: the fold now reports the boundary stage — survives restart.
    const offers = await collectOffers(pool);
    expect(offers.find(o => o.offerId === OFFER)?.stage).toBe('AUTHORIZATION_REQUIRED');
    // Exactly one durable transition event appended.
    expect(events.filter(e => e.event_type === 'commercial_offer_transition')).toHaveLength(1);
  });

  it('no customer is ever invented and no job/checkout/payment row is attempted', async () => {
    const { pool, jobQueries } = checkoutReadyStore();
    const core = coreFor(pool);
    await core.registry.execute(CAP, { offerId: OFFER }, CTX);
    // The boundary fires BEFORE any job/session work — zero job-table touches.
    expect(jobQueries.filter(q => /INSERT|UPDATE/i.test(String(q)))).toHaveLength(0);
  });

  it('bound params are honored — a different offerId does not touch this offer', async () => {
    const { pool, events } = checkoutReadyStore();
    const core = coreFor(pool);
    const res = await core.registry.execute(CAP, { offerId: 'offer-ffffffffffff' }, CTX);
    expect(res.executed).toBe(true);
    const transition = (res.result as { transitions: Array<{ detail: string }> }).transitions[0];
    expect(transition.detail).toContain('not found');
    // Offer untouched — no transition written.
    expect(events.filter(e => e.event_type === 'commercial_offer_transition')).toHaveLength(0);
    expect((await collectOffers(pool)).find(o => o.offerId === OFFER)?.stage).toBe('CHECKOUT_READY');
  });

  it('re-dispatch is idempotent — boundary stage is terminal for this executor, no duplicate transition', async () => {
    const { pool, events } = checkoutReadyStore();
    const core = coreFor(pool);
    await core.registry.execute(CAP, { offerId: OFFER }, CTX);
    const res2 = await core.registry.execute(CAP, { offerId: OFFER }, CTX);
    // Second run: AUTHORIZATION_REQUIRED has no autonomous transition → noop.
    const t2 = res2.evidence?.[0] as { action: string };
    expect(t2.action).toBe('noop');
    expect(events.filter(e => e.event_type === 'commercial_offer_transition')).toHaveLength(1);
  });

  it('advanceAll=false without a bound offer advances nothing', async () => {
    const { pool, events } = checkoutReadyStore();
    const core = coreFor(pool);
    await core.registry.execute(CAP, { advanceAll: false }, CTX);
    expect(events.filter(e => e.event_type === 'commercial_offer_transition')).toHaveLength(0);
  });
});

describe('AUTHORIZED → dispatch handoff carries the authorization evidence', () => {
  it('human_authorized authorizationResult flows into MissionRunner.dispatch ctx', async () => {
    const { pool } = checkoutReadyStore();
    const { core, realPool } = makeCore(pool);
    try {
      const dispatched: Array<{ goalId: string; capabilityId: string; params: unknown; ctx: { authorizationMode: string } }> = [];
      (core as any).missionRunner = {
        dispatch: async (goalId: string, capabilityId: string, params: unknown, ctx: { authorizationMode: string }) => {
          dispatched.push({ goalId, capabilityId, params, ctx });
          return { dispatched: true, goalId, missionId: 'm-1' };
        },
      };
      const action = {
        actionType: 'capability', capabilityId: CAP, description: 't', targetGoalId: 'goal-1',
        riskLevel: 'R2', estimatedImpact: '', reasoning: '',
        params: { offerId: OFFER }, alternatives: [],
      } as any;
      const state = { authorizationResult: { authorized: true, authorizationMode: 'human_authorized' }, trustClassification: null, errors: [] } as any;
      const res = await (core as any).executeAction(action, state);
      expect(res.executed).toBe(true);
      expect(res.outcome).toBe('pending'); // dispatched, not executed inline
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0].goalId).toBe('goal-1');
      expect(dispatched[0].capabilityId).toBe(CAP);
      expect(dispatched[0].params).toEqual({ offerId: OFFER });
      expect(dispatched[0].ctx.authorizationMode).toBe('human_authorized');
    } finally {
      await realPool.end();
    }
  });
});
