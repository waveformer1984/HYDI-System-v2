import { EventBus } from '../../lib/event-bus/EventBus';
import * as eventBusModule from '../../lib/event-bus';
import { ProjectionEngine } from '../../lib/commercial/projections/projection-engine';
import { createRevenueProjection } from '../../lib/commercial/projections/revenue-projection';
import { adaptRezonateNftSale } from '../../lib/commercial/ingress-adapter';
import { syncRezonateNftRevenue } from '../../lib/commercial/rezonate-nft-bridge';

const TX = '0x' + 'ab'.repeat(32);

const VERIFIED_SALE = {
  id: 'sale-1',
  asset_id: 'nft-1',
  listing_id: 'lst-1',
  transaction_hash: TX,
  seller_wallet: '0x' + '1'.repeat(40),
  buyer_wallet: '0x' + '2'.repeat(40),
  price_eth: 0.1,
  platform_fee_wei: '2500000000000000',
  creator_proceeds_wei: '97500000000000000',
  status: 'sale_confirmed',
  revenue_status: 'CHAIN_VERIFIED',
  verified_at: '2026-10-06T00:00:00Z',
  chain_mode: 'local',
};

const CHAIN_STATUS = {
  ok: true,
  chain: { nft: '0x' + 'a'.repeat(40), market: '0x' + 'b'.repeat(40), mode: 'local', chainId: 31337 },
};

function makeFetch(sales: any[], posts: Array<{ url: string; body: any }> = []) {
  return async (url: string, init?: any) => {
    if (init?.method === 'POST') {
      posts.push({ url, body: JSON.parse(init.body) });
      // simulate the durable mark so the second sync sees commercial_event_id
      const m = url.match(/\/nft\/sales\/([^/]+)\/commercial-event/);
      if (m) {
        const s = sales.find((x) => x.id === m[1]);
        if (s) { s.commercial_event_id = (JSON.parse(init.body) as any).event_id; s.revenue_status = 'COMMERCIAL_EVENT_CREATED'; }
      }
      const r = url.match(/\/nft\/sales\/([^/]+)\/revenue-recorded/);
      if (r) {
        const s = sales.find((x) => x.id === r[1]);
        if (s) s.revenue_status = 'REVENUE_RECORDED';
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    if (url.endsWith('/nft/sales')) return { ok: true, status: 200, json: async () => ({ sales }) };
    if (url.endsWith('/nft/status')) return { ok: true, status: 200, json: async () => CHAIN_STATUS };
    const am = url.match(/\/nft\/assets\/(.+)$/);
    if (am) return { ok: true, status: 200, json: async () => ({ mint: { contract_address: CHAIN_STATUS.chain.nft, token_id: '7' } }) };
    return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
  };
}

describe('adaptRezonateNftSale', () => {
  it('produces a rezonate.nft_sale event keyed by transaction hash', () => {
    const { type, payload, source, correlationId } = adaptRezonateNftSale(VERIFIED_SALE, {
      chainId: 31337, contractAddress: CHAIN_STATUS.chain.nft!, tokenId: '7', mode: 'local',
    });
    expect(type).toBe('rezonate.nft_sale');
    expect(source).toBe('rezonate-nft-bridge');
    expect(correlationId).toBe(TX);
    expect(payload).toMatchObject({
      rezonate_sale_id: 'sale-1', chain: 'evm', network: 'local', chain_id: 31337,
      token_id: '7', transaction_hash: TX, gross_amount: 0.1, currency: 'ETH',
      platform_fee: 0.0025, creator_proceeds: 0.0975,
      revenue_stream: 'rezonate_nft', chain_mode: 'local',
    });
  });

  it('refuses to bridge a sale without a real transaction hash', () => {
    expect(() => adaptRezonateNftSale({ ...VERIFIED_SALE, transaction_hash: 'pending' } as any, {
      chainId: 31337, contractAddress: '0x0', tokenId: '7', mode: 'local',
    })).toThrow(/transaction hash/);
  });
});

describe('syncRezonateNftRevenue', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus({ maxHistory: 100, logToConsole: false });
    jest.spyOn(eventBusModule, 'getEventBus').mockReturnValue(bus);
  });

  afterEach(() => { bus.clear(); jest.restoreAllMocks(); });

  it('publishes one commercial event per verified sale and marks it back', async () => {
    const sale = { ...VERIFIED_SALE };
    const posts: Array<{ url: string; body: any }> = [];
    const result = await syncRezonateNftRevenue({ baseUrl: 'http://x', fetchImpl: makeFetch([sale], posts) as any });

    expect(result.available).toBe(true);
    expect(result.synced).toBe(1);
    const events = bus.getHistory({ type: 'rezonate.nft_sale' });
    expect(events).toHaveLength(1);
    expect(events[0].correlationId).toBe(TX);
    expect(posts.map((p) => p.url)).toEqual([
      'http://x/nft/sales/sale-1/commercial-event',
      'http://x/nft/sales/sale-1/revenue-recorded',
    ]);
    expect(posts[0].body.event_id).toBe(events[0].id);
  });

  it('is idempotent — replaying the sync never double-counts revenue', async () => {
    const sale = { ...VERIFIED_SALE };
    const posts: Array<{ url: string; body: any }> = [];
    const fetchImpl = makeFetch([sale], posts) as any;

    const engine = new ProjectionEngine(bus);
    const projection = createRevenueProjection();
    engine.register(projection);
    engine.start();

    await syncRezonateNftRevenue({ baseUrl: 'http://x', fetchImpl });
    const second = await syncRezonateNftRevenue({ baseUrl: 'http://x', fetchImpl });

    expect(bus.getHistory({ type: 'rezonate.nft_sale' })).toHaveLength(1);
    expect(second.synced).toBe(0); // sale already has commercial_event_id

    const stream = projection.getState().streams['rezonate_nft'];
    expect(stream.paymentCount).toBe(1);
    expect(stream.gross).toBeCloseTo(0.1);
    expect(stream.platformFees).toBeCloseTo(0.0025);
    expect(stream.net).toBeCloseTo(0.0975);
    expect(stream.currency).toBe('ETH');
    engine.stop();
  });

  it('skips unverified sales and reports unreachable rezonate honestly', async () => {
    const pending = { ...VERIFIED_SALE, id: 's-p', transaction_hash: null, status: 'purchase_pending', revenue_status: 'SALE_DETECTED' };
    const res1 = await syncRezonateNftRevenue({ baseUrl: 'http://x', fetchImpl: makeFetch([pending]) as any });
    expect(res1.synced).toBe(0);
    expect(bus.getHistory({ type: 'rezonate.nft_sale' })).toHaveLength(0);

    const res2 = await syncRezonateNftRevenue({
      baseUrl: 'http://x', fetchImpl: (async () => { throw new Error('ECONNREFUSED'); }) as any,
    });
    expect(res2.available).toBe(false);
    expect(res2.errors[0]).toMatch(/unreachable/);
  });
});
