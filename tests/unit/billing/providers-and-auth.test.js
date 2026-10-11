'use strict';

/**
 * Stripe adapter (offline — the real SDK's signature code, no network),
 * Stripe event normalization for current API shapes, customer tokens and
 * the cost rate card.
 */

const Stripe = require('stripe');
const { StripeBillingProvider } = require('../../../lib/billing/providers/stripe-provider');
const { normalizeStripeEvent } = require('../../../lib/billing/providers/stripe-normalize');
const { issueCustomerToken, verifyCustomerToken, bearerFrom } = require('../../../lib/billing/customer-auth');
const { loadRateCard, estimateCost } = require('../../../lib/billing/cost-rates');
const { computeAccessUntil, hasAccess, compareSnapshot, loadPolicy } = require('../../../lib/billing/policy');

const WHSEC = 'whsec_unit_test_secret_value';

describe('StripeBillingProvider', () => {
  const sdk = new Stripe('sk_test_unit_dummy');
  const provider = new StripeBillingProvider({ secretKey: 'sk_test_unit_dummy', webhookSecret: WHSEC });

  it('accepts a correctly signed event (real Stripe signature scheme)', () => {
    const payload = JSON.stringify({ id: 'evt_1', type: 'invoice.paid', created: 1790000000, livemode: false, data: { object: {} } });
    const header = sdk.webhooks.generateTestHeaderString({ payload, secret: WHSEC });
    const ev = provider.verifyWebhook(Buffer.from(payload), { 'stripe-signature': header });
    expect(ev.id).toBe('evt_1');
    expect(provider.describeEvent(ev)).toMatchObject({ id: 'evt_1', type: 'invoice.paid', livemode: false });
  });

  it('rejects a wrong secret, a modified body and a missing header', () => {
    const payload = JSON.stringify({ id: 'evt_2', type: 'x', created: 1, data: { object: {} } });
    const bad = sdk.webhooks.generateTestHeaderString({ payload, secret: 'whsec_other' });
    expect(() => provider.verifyWebhook(Buffer.from(payload), { 'stripe-signature': bad })).toThrow(expect.objectContaining({ code: 'invalid_signature' }));
    const good = sdk.webhooks.generateTestHeaderString({ payload, secret: WHSEC });
    expect(() => provider.verifyWebhook(Buffer.from(payload.replace('evt_2', 'evt_3')), { 'stripe-signature': good })).toThrow(expect.objectContaining({ code: 'invalid_signature' }));
    expect(() => provider.verifyWebhook(Buffer.from(payload), {})).toThrow(expect.objectContaining({ code: 'invalid_signature' }));
  });

  it('refuses a live key unless ALLOW_LIVE_STRIPE=true', () => {
    const prev = process.env.ALLOW_LIVE_STRIPE;
    delete process.env.ALLOW_LIVE_STRIPE;
    expect(() => new StripeBillingProvider({ secretKey: 'sk_live_dummy', webhookSecret: WHSEC })).toThrow(expect.objectContaining({ code: 'live_mode_not_authorized' }));
    if (prev !== undefined) process.env.ALLOW_LIVE_STRIPE = prev;
  });

  it('refuses to verify webhooks when no billing webhook secret is configured', () => {
    const p = new StripeBillingProvider({ secretKey: 'sk_test_unit_dummy', webhookSecret: '' });
    p.webhookSecret = '';
    expect(() => p.verifyWebhook(Buffer.from('{}'), { 'stripe-signature': 't=1,v1=00' })).toThrow(expect.objectContaining({ code: 'webhook_not_configured', status: 503 }));
  });

  it('maps SDK failures to provider_unavailable / provider_rejected', async () => {
    const client = {
      customers: { create: async () => { throw Object.assign(new Error('socket hang up'), { type: 'StripeConnectionError' }); } },
      subscriptions: { retrieve: async () => { throw Object.assign(new Error('No such subscription'), { type: 'StripeInvalidRequestError' }); } },
    };
    const p = new StripeBillingProvider({ client, webhookSecret: WHSEC });
    await expect(p.createCustomer({ tenantId: 't', name: 'n', email: 'e@x.test', idempotencyKey: 'k' })).rejects.toMatchObject({ code: 'provider_unavailable', status: 503 });
    await expect(p.retrieveSubscription('sub_x')).rejects.toMatchObject({ code: 'provider_rejected', status: 422 });
  });

  it('builds a subscription-mode hosted checkout with tenant metadata and an idempotency key', async () => {
    const calls = [];
    const client = { checkout: { sessions: { create: async (params, opts) => { calls.push({ params, opts }); return { id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }; } } } };
    const p = new StripeBillingProvider({ client, webhookSecret: WHSEC });
    const out = await p.createCheckoutSession({
      providerCustomerId: 'cus_1', providerPriceId: 'price_1', trialDays: 0, successUrl: 'https://a/s', cancelUrl: 'https://a/c',
      metadata: { hydi_tenant_id: 'tenant-1', hydi_price_version_id: 'pv', hydi_checkout_intent_id: 'i' }, idempotencyKey: 'checkout-i',
    });
    expect(out).toEqual({ sessionId: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    expect(calls[0].params).toMatchObject({ mode: 'subscription', customer: 'cus_1', line_items: [{ price: 'price_1', quantity: 1 }], subscription_data: { metadata: { hydi_tenant_id: 'tenant-1' } } });
    expect(calls[0].params).not.toHaveProperty('line_items.0.price_data'); // never a client-supplied amount
    expect(calls[0].opts).toEqual({ idempotencyKey: 'checkout-i' });
  });
});

describe('Stripe event normalization (2025+ API shapes)', () => {
  it('reads subscription periods from items and cancel_at as period-end cancellation', () => {
    const n = normalizeStripeEvent({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at: 1790003600, items: { data: [{ price: { id: 'price_1' }, current_period_start: 1790000000, current_period_end: 1790003600 }] }, metadata: {} } },
    });
    expect(n.kind).toBe('subscription.snapshot');
    expect(n.subscription).toMatchObject({ providerSubscriptionId: 'sub_1', providerPriceId: 'price_1', status: 'active', cancelAtPeriodEnd: true });
    expect(n.subscription.currentPeriodEnd.toISOString()).toBe(new Date(1790003600 * 1000).toISOString());
  });

  it('reads invoice subscription via parent.subscription_details and tax via total_taxes', () => {
    const n = normalizeStripeEvent({
      type: 'invoice.paid',
      data: { object: { id: 'in_1', customer: 'cus_1', currency: 'USD', amount_paid: 2900, amount_due: 2900, total_taxes: [{ amount: 150 }, { amount: 50 }], created: 1790000000, status_transitions: { paid_at: 1790000100 }, parent: { subscription_details: { subscription: 'sub_1' } }, lines: { data: [] } } },
    });
    expect(n.invoice).toMatchObject({ providerSubscriptionId: 'sub_1', currency: 'usd', amountPaidMinor: 2900, taxMinor: 200 });
    expect(n.invoice.occurredAt.toISOString()).toBe(new Date(1790000100 * 1000).toISOString());
  });

  it('ignores unrelated event types', () => {
    expect(normalizeStripeEvent({ type: 'product.created', data: { object: {} } })).toEqual({ kind: 'ignored' });
  });
});

describe('customer tokens', () => {
  const secret = 'x'.repeat(40);
  const tenantId = '11111111-1111-4111-8111-111111111111';

  it('round-trips and binds exactly one tenant', () => {
    const { token } = issueCustomerToken(tenantId, { secret });
    expect(verifyCustomerToken(token, { secret })).toEqual({ valid: true, tenantId });
  });

  it('rejects tampering, the wrong key, expiry and a weak/unset secret', () => {
    const now = new Date('2026-10-01T00:00:00Z');
    const { token } = issueCustomerToken(tenantId, { secret, ttlSeconds: 3600, now });
    const [p, body, sig] = token.split('.');
    const forgedBody = Buffer.from(JSON.stringify({ t: '22222222-2222-4222-8222-222222222222', iat: 1, exp: 9999999999, n: 'x' })).toString('base64url');
    expect(verifyCustomerToken(`${p}.${forgedBody}.${sig}`, { secret, now }).valid).toBe(false);
    expect(verifyCustomerToken(token, { secret: 'y'.repeat(40), now }).valid).toBe(false);
    expect(verifyCustomerToken(token, { secret, now: new Date(now.getTime() + 3601 * 1000) })).toEqual({ valid: false, reason: 'token expired' });
    expect(verifyCustomerToken(`${p}.${body}.${sig}`, { secret: 'short' })).toEqual({ valid: false, reason: 'customer auth not configured' });
    expect(() => issueCustomerToken(tenantId, { secret: 'short' })).toThrow();
  });

  it('reads only a Bearer authorization header', () => {
    expect(bearerFrom({ headers: { authorization: 'Bearer abc.def.123' } })).toBe('abc.def.123');
    expect(bearerFrom({ headers: { authorization: 'Basic abc' } })).toBeNull();
    expect(bearerFrom({ headers: {} })).toBeNull();
  });
});

describe('cost rate card', () => {
  it('records unpriced when no operator rate exists — never a guessed price', () => {
    expect(estimateCost(null, { provider: 'ollama', model: 'llama3', inputUnits: 10, outputUnits: 10 })).toMatchObject({ costMicros: null, costStatus: 'unpriced' });
    expect(loadRateCard('not json')).toBeNull();
  });

  it('estimates with integer rounding-up per component and stamps the rate version', () => {
    const card = loadRateCard(JSON.stringify({ version: 'test-1', rates: { 'acme:*': { input_micros_per_million: 3000000, output_micros_per_million: 15000000 } } }));
    expect(estimateCost(card, { provider: 'acme', model: 'any', inputUnits: 1000, outputUnits: 1 }))
      .toEqual({ costMicros: 3000 + 15, costStatus: 'estimated', rateVersion: 'test-1', costCurrency: 'usd' });
  });
});

describe('access policy', () => {
  const policy = loadPolicy({ graceDays: 7, renewalSlackHours: 24 });
  const end = new Date('2026-11-01T00:00:00Z');

  it.each([
    ['incomplete', false], ['incomplete_expired', false], ['unpaid', false], ['canceled', false], ['paused', false], ['active', true], ['trialing', true],
  ])('status %s → access %s', (status, expected) => {
    expect(hasAccess({ status, current_period_end: end, cancel_at_period_end: false }, policy, new Date('2026-10-15'))).toBe(expected);
  });

  it('an access hold overrides every status', () => {
    expect(computeAccessUntil({ status: 'active', current_period_end: end, access_hold: 'dispute' }, policy)).toBeNull();
  });

  it('active access extends by the renewal slack unless cancelling at period end', () => {
    expect(computeAccessUntil({ status: 'active', current_period_end: end }, policy).toISOString()).toBe('2026-11-02T00:00:00.000Z');
    expect(computeAccessUntil({ status: 'active', current_period_end: end, cancel_at_period_end: true }, policy).toISOString()).toBe(end.toISOString());
  });

  it('orders snapshots: newer applies, older is stale, sub-second differences are re-read', () => {
    const existing = { status: 'active', provider_state_at: new Date('2026-10-10T00:00:10.500Z'), cancel_at_period_end: false, current_period_end: end };
    const snap = { status: 'past_due', cancelAtPeriodEnd: false, currentPeriodEnd: end };
    expect(compareSnapshot(existing, snap, new Date('2026-10-10T00:00:11Z'))).toBe('apply');
    expect(compareSnapshot(existing, snap, new Date('2026-10-10T00:00:09Z'))).toBe('stale');
    expect(compareSnapshot(existing, snap, new Date('2026-10-10T00:00:10Z'))).toBe('ambiguous');
    expect(compareSnapshot({ ...existing, status: 'canceled' }, snap, new Date('2027-01-01'))).toBe('terminal');
  });
});
