'use strict';

/**
 * Billing API routes, exercised through the real Next.js handlers with an
 * injected service (memory store + fake provider). Covers authentication,
 * tenant binding from the token, the webhook endpoint and the metered AI
 * endpoint. The local model client is stubbed — no network.
 */

const { createHmac, randomBytes } = require('crypto');

jest.mock('../../../api/local-model', () => {
  const state = { fail: false, calls: 0 };
  class LocalModelClient {
    constructor() { this.provider = 'ollama'; this.model = 'stub-model'; }
    async generate(prompt) {
      state.calls += 1;
      if (state.fail) throw new Error('ECONNREFUSED');
      return { text: `echo: ${prompt}`, model: 'stub-model', prompt_eval_count: 7, eval_count: 11 };
    }
  }
  return { LocalModelClient, __state: state };
});

const modelState = require('../../../api/local-model').__state;
const { createHarness } = require('./harness');
const { setBillingService } = require('../../../lib/billing/http');
const { issueCustomerToken } = require('../../../lib/billing/customer-auth');
const { hasPermission } = require('../../../lib/auth/rbac');

const checkoutRoute = require('../../../pages/api/billing/checkout').default;
const accountRoute = require('../../../pages/api/billing/account').default;
const webhookRoute = require('../../../pages/api/billing/webhook').default;
const catalogRoute = require('../../../pages/api/billing/catalog').default;
const subscriptionRoute = require('../../../pages/api/billing/subscription').default;
const aiRoute = require('../../../pages/api/billing/ai/complete').default;
const revenueRoute = require('../../../pages/api/billing/admin/revenue').default;
const tenantsRoute = require('../../../pages/api/billing/admin/tenants').default;

const SECRET = 'route-test-customer-token-secret-0123456789';
let ipSeq = 0;

function req({ method = 'POST', headers = {}, body, query = {} } = {}) {
  ipSeq += 1;
  return { method, headers: { 'x-forwarded-for': `10.9.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`, ...headers }, body, query, socket: {} };
}

function res() {
  const r = { statusCode: 200, headers: {}, body: undefined };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.send = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  return r;
}

async function call(route, opts) {
  const r = res();
  await route(req(opts), r);
  return r;
}

const bearer = (tenant) => ({ authorization: `Bearer ${issueCustomerToken(tenant.tenant_id, { secret: SECRET }).token}` });

function serviceToken() {
  const ts = Date.now();
  const id = randomBytes(4).toString('hex');
  const sig = createHmac('sha256', process.env.HYDI_SERVICE_SECRET).update(`${ts}:${id}:billing-test`).digest('hex');
  return `${ts}.${id}.billing-test.${sig}`;
}

describe('billing routes', () => {
  let h;
  const env = {};
  const SCRUB = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  beforeAll(() => {
    // Keep the operator audit write on the no-op client: CI exports a local
    // Supabase URL, and this suite must stay hermetic.
    env.scrubbed = SCRUB.map((k) => [k, process.env[k]]);
    SCRUB.forEach((k) => delete process.env[k]);
    env.secret = process.env.BILLING_CUSTOMER_TOKEN_SECRET;
    env.service = process.env.HYDI_SERVICE_SECRET;
    process.env.BILLING_CUSTOMER_TOKEN_SECRET = SECRET;
    process.env.HYDI_SERVICE_SECRET = 'route-test-service-secret';
  });
  afterAll(() => {
    env.scrubbed.forEach(([k, v]) => { if (v !== undefined) process.env[k] = v; });
    process.env.BILLING_CUSTOMER_TOKEN_SECRET = env.secret;
    process.env.HYDI_SERVICE_SECRET = env.service;
    if (env.secret === undefined) delete process.env.BILLING_CUSTOMER_TOKEN_SECRET;
    if (env.service === undefined) delete process.env.HYDI_SERVICE_SECRET;
  });
  beforeEach(async () => {
    h = await createHarness('memory');
    setBillingService(h.service);
    modelState.fail = false;
    modelState.calls = 0;
  });
  afterEach(() => setBillingService(null));

  it('catalog is public and lists only published offers', async () => {
    const r = await call(catalogRoute, { method: 'GET' });
    expect(r.statusCode).toBe(200);
    expect(r.body.products[0].plans[0]).toMatchObject({ plan_key: 'starter', features: ['ai_completions', 'api_access'] });
    expect(r.body.products[0].plans[0].prices[0]).toMatchObject({ unit_amount_minor: 2900, currency: 'usd' });
  });

  it('checkout requires a customer token', async () => {
    const r = await call(checkoutRoute, { body: { price_version_id: h.price.price_version_id, idempotency_key: 'abcdefgh-1' } });
    expect(r.statusCode).toBe(401);
    const forged = await call(checkoutRoute, { headers: { authorization: 'Bearer hbc1.e30.00' }, body: {} });
    expect(forged.statusCode).toBe(401);
  });

  it('checkout binds the tenant from the token, never from the body', async () => {
    const a = await h.tenant('Alpha');
    const b = await h.tenant('Beta');
    const r = await call(checkoutRoute, {
      headers: bearer(a),
      body: { price_version_id: h.price.price_version_id, idempotency_key: 'abcdefgh-2', tenant_id: b.tenant_id, unit_amount_minor: 1 },
    });
    expect(r.statusCode).toBe(200);
    const intent = await h.store.findOne('billing_checkout_intents', { intent_id: r.body.intent_id });
    expect(intent.tenant_id).toBe(a.tenant_id);
  });

  it('webhook endpoint: rejects bad signatures, processes valid events once', async () => {
    const a = await h.tenant();
    const c = await h.checkout(a);
    const ev = c.events.find((e) => e.type === 'checkout.session.completed');
    const { rawBody, headers } = h.provider.deliver(ev);

    const bad = await call(webhookRoute, { body: rawBody, headers: { 'x-fake-billing-signature': '00' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.body.error).toBe('invalid_signature');

    const ok = await call(webhookRoute, { body: rawBody, headers });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toMatchObject({ received: true, duplicate: false, outcome: 'processed' });
    const dup = await call(webhookRoute, { body: rawBody, headers });
    expect(dup.body).toMatchObject({ received: true, duplicate: true });

    const acct = await call(accountRoute, { method: 'GET', headers: bearer(a) });
    expect(acct.body.subscription).toMatchObject({ status: 'active', has_access: true });
  });

  it('account returns only the caller’s data', async () => {
    const a = await h.tenant('Alpha');
    const b = await h.tenant('Beta');
    await h.subscribe(a);
    const rb = await call(accountRoute, { method: 'GET', headers: bearer(b) });
    expect(rb.statusCode).toBe(200);
    expect(rb.body.tenant.tenant_id).toBe(b.tenant_id);
    expect(rb.body.subscription).toBeNull();
    expect(rb.body.payments).toEqual([]);
  });

  it('subscription route cannot cancel another tenant’s subscription', async () => {
    const a = await h.tenant('Alpha');
    const b = await h.tenant('Beta');
    const { sub } = await h.subscribe(a);
    const r = await call(subscriptionRoute, { headers: bearer(b), body: { action: 'cancel', subscription_id: sub.subscription_id } });
    expect(r.statusCode).toBe(404);
    const own = await call(subscriptionRoute, { headers: bearer(a), body: { action: 'cancel', subscription_id: sub.subscription_id } });
    expect(own.statusCode).toBe(200);
    expect(own.body.subscription.cancel_at_period_end).toBe(true);
  });

  it('metered AI endpoint: 402 without entitlement, charges once per key, no charge when the model fails', async () => {
    const a = await h.tenant();
    const denied = await call(aiRoute, { headers: bearer(a), body: { prompt: 'hi', idempotency_key: 'ai-key-0001' } });
    expect(denied.statusCode).toBe(402);
    expect(denied.body.error).toBe('not_entitled');
    expect(modelState.calls).toBe(0);

    await h.subscribe(a);
    const ok = await call(aiRoute, { headers: bearer(a), body: { prompt: 'hi', idempotency_key: 'ai-key-0001' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.body.text).toBe('echo: hi');
    const again = await call(aiRoute, { headers: bearer(a), body: { prompt: 'hi', idempotency_key: 'ai-key-0001' } });
    expect(again.body).toMatchObject({ duplicate: true, usage_id: ok.body.usage_id });
    expect(modelState.calls).toBe(1);

    modelState.fail = true;
    const failed = await call(aiRoute, { headers: bearer(a), body: { prompt: 'hi', idempotency_key: 'ai-key-0002' } });
    expect(failed.statusCode).toBe(503);
    expect(failed.body.error).toBe('model_unavailable');
    expect((await h.service.checkEntitlement(a.tenant_id, 'ai_completions')).used_units).toBe(1);

    const costs = await h.store.findMany('billing_provider_cost_records', { tenant_id: a.tenant_id, succeeded: true });
    expect(costs[0]).toMatchObject({ provider: 'ollama', model: 'stub-model', input_units: 7, output_units: 11, cost_status: 'unpriced' });
  });

  it('admin revenue requires operator credentials', async () => {
    const anon = await call(revenueRoute, { method: 'GET' });
    expect(anon.statusCode).toBe(401);
    const ok = await call(revenueRoute, { method: 'GET', headers: { 'x-hydi-service-token': serviceToken() } });
    expect(ok.statusCode).toBe(200);
    expect(ok.body.definitions.length).toBeGreaterThan(5);
  });

  it('admin tenant onboarding issues a working customer token', async () => {
    const r = await call(tenantsRoute, { headers: { 'x-hydi-service-token': serviceToken() }, body: { op: 'create', name: 'Gamma', email: 'gamma@example.test' } });
    expect(r.statusCode).toBe(201);
    expect(r.headers['cache-control']).toBe('no-store');
    const acct = await call(accountRoute, { method: 'GET', headers: { authorization: `Bearer ${r.body.token}` } });
    expect(acct.body.tenant.name).toBe('Gamma');
  });

  it('RBAC: operators see finance and manage catalog; refunds, replay and tenants are owner-only', () => {
    expect(hasPermission('operator', 'billing:finance:view')).toBe(true);
    expect(hasPermission('operator', 'billing:catalog:manage')).toBe(true);
    for (const p of ['billing:refund:request', 'billing:webhook:replay', 'billing:tenants:manage', 'billing:credits:adjust', 'billing:config:manage']) {
      expect(hasPermission('operator', p)).toBe(false);
      expect(hasPermission('owner', p)).toBe(true);
    }
    expect(hasPermission('viewer', 'billing:finance:view')).toBe(false);
    expect(hasPermission('agent', 'billing:finance:view')).toBe(false);
  });
});
