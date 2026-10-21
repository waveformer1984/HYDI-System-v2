'use strict';

const { liveRevenueSummary } = require('../../lib/billing/live-summary');
const { createPhoneRevenueHandler, resetRateLimit } = require('../../lib/billing/phone-revenue-route');

const ROWS = [
  { livemode: true, status: 'processed', received_at: '2026-10-21T10:00:00Z', payload: { type: 'invoice.paid', data: { object: { amount_paid: 4900, currency: 'usd' } } } },
  { livemode: true, status: 'processed', received_at: '2026-10-21T11:00:00Z', payload: { type: 'checkout.session.completed', data: { object: { mode: 'payment', payment_status: 'paid', amount_total: 1500, currency: 'usd' } } } },
  { livemode: true, status: 'processed', received_at: '2026-10-21T12:00:00Z', payload: { type: 'charge.refunded', data: { object: { amount_refunded: 400, currency: 'usd' } } } },
  { livemode: false, status: 'processed', received_at: '2026-10-21T13:00:00Z', payload: { type: 'invoice.paid', data: { object: { amount_paid: 999999, currency: 'usd' } } } },
  { livemode: true, status: 'failed', received_at: '2026-10-21T14:00:00Z', payload: { type: 'invoice.paid', data: { object: { amount_paid: 777, currency: 'usd' } } } },
  { livemode: true, status: 'processed', received_at: '2026-10-21T15:00:00Z', payload: { type: 'checkout.session.completed', data: { object: { mode: 'subscription', payment_status: 'paid', amount_total: 4900, currency: 'usd' } } } },
];

// Ignores the where clause on purpose: the summary must still drop test rows.
const leakyStore = { findMany: jest.fn(async () => ROWS) };
const now = () => new Date('2026-10-21T18:00:00Z');

describe('liveRevenueSummary', () => {
  it('counts only livemode, processed payment events', async () => {
    const s = await liveRevenueSummary(leakyStore, { now });
    expect(leakyStore.findMany).toHaveBeenCalledWith('billing_webhook_events', { livemode: true, status: 'processed' }, expect.any(Object));
    expect(s.livemode_only).toBe(true);
    expect(s.totals).toEqual({ usd: { paid_cents: 6400, refunded_cents: 400, net_cents: 6000, events: 3 } });
    expect(s.last_live_event_at).toBe('2026-10-21T12:00:00.000Z');
  });
});

describe('GET /api/phone/revenue-summary', () => {
  function res() {
    const r = { code: 0, body: null, headers: {} };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.setHeader = (k, v) => { r.headers[k] = v; };
    return r;
  }
  const env = { HYDI_PHONE_READ_TOKEN: 'phone-read-test' };
  beforeEach(() => resetRateLimit());

  it('is 503 when the token is not configured', async () => {
    const r = res();
    await createPhoneRevenueHandler({ env: {}, store: () => leakyStore, now: () => 0 })({ method: 'GET', headers: { authorization: 'Bearer x' } }, r);
    expect(r.code).toBe(503);
  });

  it('rejects a missing or wrong token and never echoes it', async () => {
    const handler = createPhoneRevenueHandler({ env, store: () => leakyStore, now: () => 0 });
    for (const authorization of [undefined, 'Bearer nope', 'phone-read-test']) {
      const r = res();
      await handler({ method: 'GET', headers: { authorization } }, r);
      expect(r.code).toBe(401);
      expect(JSON.stringify(r.body)).not.toContain('phone-read-test');
    }
  });

  it('is GET only', async () => {
    const r = res();
    await createPhoneRevenueHandler({ env, store: () => leakyStore })({ method: 'POST', headers: { authorization: 'Bearer phone-read-test' } }, r);
    expect(r.code).toBe(405);
  });

  it('returns the livemode-only summary for the right token', async () => {
    const r = res();
    await createPhoneRevenueHandler({ env, store: () => leakyStore, now: () => now().getTime() })({ method: 'GET', headers: { authorization: 'Bearer phone-read-test' } }, r);
    expect(r.code).toBe(200);
    expect(r.body.summary.livemode_only).toBe(true);
    expect(r.body.summary.totals.usd.net_cents).toBe(6000);
    expect(r.headers['Cache-Control']).toBe('no-store');
  });

  it('rate-limits', async () => {
    const handler = createPhoneRevenueHandler({ env, store: () => leakyStore, now: () => 1 });
    let last;
    for (let i = 0; i < 21; i += 1) {
      last = res();
      await handler({ method: 'GET', headers: { authorization: 'Bearer phone-read-test' } }, last);
    }
    expect(last.code).toBe(429);
  });
});
