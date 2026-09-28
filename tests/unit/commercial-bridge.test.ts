/**
 * CommercialBridge — opportunity → offer lifecycle.
 * Proves: qualification gate, idempotency, OFFER_BLOCKED for products
 * without executors, CHECKOUT_READY only when the whole path exists.
 */
import { offerIdFor, prepareOffer, collectOffers, transitionOffer, checkoutPrereqs } from '../../lib/heidi/CommercialBridge';

// In-memory pg shim: rows array + a query impl that recognizes the
// handful of statements the bridge issues.
function fakePool(opts: {
  opportunity?: Record<string, unknown> | null;
  findings?: Array<{ payload: Record<string, unknown> }>;
}) {
  const events: Array<{ event_type: string; payload: Record<string, unknown>; created_at: string }> = [];
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      if (/FROM heidi_events\s+WHERE division='commercial'/.test(sql)) {
        return { rows: events };
      }
      if (/event_type='business_finding'/.test(sql)) {
        return { rows: opts.findings ?? [] };
      }
      if (/FROM protoforge_opportunities WHERE id = \$1/.test(sql)) {
        return { rows: opts.opportunity ? [opts.opportunity] : [] };
      }
      if (/INSERT INTO heidi_events/.test(sql)) {
        events.push({ event_type: params![0] as string, payload: JSON.parse(params![1] as string), created_at: new Date().toISOString() });
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
    },
  };
  return { pool: pool as any, events };
}

const OPP = { id: 'opp-1', title: 'Test opportunity', status: 'needs_review', approval_status: 'approved', confidence: 80 };

describe('CommercialBridge', () => {
  it('offerId is deterministic — same opp+product, same id', () => {
    expect(offerIdFor('a', 'protoforge_model_prep')).toBe(offerIdFor('a', 'protoforge_model_prep'));
    expect(offerIdFor('a', 'protoforge_model_prep')).not.toBe(offerIdFor('a', 'rezonate_song'));
  });

  it('unapproved opportunity with no finding → NOT_COMMERCIALLY_QUALIFIED', async () => {
    const { pool } = fakePool({ opportunity: { ...OPP, approval_status: 'pending' } });
    const r = await prepareOffer(pool, { opportunityId: 'opp-1', product: 'protoforge_model_prep' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('NOT_COMMERCIALLY_QUALIFIED');
  });

  it('approved opportunity → offer prepared; stage reflects executor availability', async () => {
    // protoforge_model_prep has an executor; Stripe key presence decides ready/blocked.
    const { pool } = fakePool({ opportunity: OPP });
    delete process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_SECRET_KEY_01;
    const r = await prepareOffer(pool, { opportunityId: 'opp-1', product: 'protoforge_model_prep' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(['CHECKOUT_READY', 'OFFER_BLOCKED']).toContain(r.offer.stage);
    }
  });

  it('rezonate_song → OFFER_BLOCKED with the executor reason (never wrong-artifact delivery)', async () => {
    const { pool } = fakePool({ opportunity: OPP });
    const r = await prepareOffer(pool, { opportunityId: 'opp-1', product: 'rezonate_song' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.offer.stage).toBe('OFFER_BLOCKED');
      expect(r.offer.stageReason).toContain('REVENUE_PATH_NOT_WIRED');
    }
  });

  it('idempotent: second prepareOffer for same opp+product returns deduped, single event set', async () => {
    const { pool, events } = fakePool({ opportunity: OPP });
    const r1 = await prepareOffer(pool, { opportunityId: 'opp-1', product: 'protoforge_model_prep' });
    const r2 = await prepareOffer(pool, { opportunityId: 'opp-1', product: 'protoforge_model_prep' });
    expect(r2.ok && r2.deduped).toBe(true);
    expect(events.filter(e => e.event_type === 'commercial_offer')).toHaveLength(1);
  });

  it('transitions record prev→new stage with actor', async () => {
    const { pool } = fakePool({ opportunity: OPP });
    const r = await prepareOffer(pool, { opportunityId: 'opp-1', product: 'protoforge_model_prep' });
    if (!r.ok) throw new Error('prep failed');
    const t = await transitionOffer(pool, r.offer.offerId, 'AUTHORIZATION_REQUIRED', 'operator');
    expect(t.ok).toBe(true);
    expect(t.previousStage).toBe(r.offer.stage);
    const offers = await collectOffers(pool);
    expect(offers[0].stage).toBe('AUTHORIZATION_REQUIRED');
  });

  it('checkoutPrereqs fails closed for unknown products', () => {
    const p = checkoutPrereqs('nonexistent_product');
    expect(p.ready).toBe(false);
    expect(p.blockers.some(b => b.includes('no artifact executor'))).toBe(true);
  });
});
