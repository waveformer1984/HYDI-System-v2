'use strict';

/**
 * In-process billing security checks (memory store + fake provider). Not a substitute for live integration.
 */

const { MemoryBillingStore } = require('./stores/memory-store');
const { BillingService } = require('./service');
const { FakeBillingProvider } = require('./providers/fake-provider');
const { loadPolicy } = require('./policy');
const { setBillingService } = require('./http');
const { issueCustomerToken } = require('./customer-auth');
const { resolveCustomerIdentity } = require('./customer-identity');
const {
  registerTenantOwner,
  bindWalkieOwner,
  revokeWalkieBinding,
  setMembershipStatus,
  getActiveMembershipForUser,
} = require('./identity-service');
const { signDeviceToken } = require('../auth/deviceAuth');

const SECRET = 'hermetic-billing-security-check-secret-32';
const OPERATOR = { type: 'operator', id: 'hermetic-check' };

async function buildHarness() {
  const clock = { t: new Date('2026-10-01T12:00:00Z') };
  const now = () => new Date(clock.t.getTime());
  const store = new MemoryBillingStore();
  const provider = new FakeBillingProvider({ secret: 'test_webhook_secret', clock: now });
  const service = new BillingService({
    store,
    provider,
    policy: loadPolicy({ graceDays: 7, renewalSlackHours: 24 }),
    clock: now,
    appUrl: 'https://hydi.test',
    rateCard: null,
    logger: { error() {}, warn() {}, info() {}, log() {} },
  });
  setBillingService(service);
  const product = await service.createProduct({ product_key: 'hydi_ai', name: 'Hydi AI', revenue_stream: 'hydi_platform' }, OPERATOR);
  const plan = await service.createPlan({
    product_id: product.product_id,
    plan_key: 'starter',
    name: 'Starter',
    features: ['ai_completions', 'api_access'],
    limits: { ai_completions: 5, seats: 1 },
  }, OPERATOR);
  const providerPriceId = provider.registerPrice({ unitAmountMinor: 2900, currency: 'usd', interval: 'month' });
  const price = await service.createPriceVersion({
    plan_id: plan.plan_id,
    currency: 'usd',
    unit_amount_minor: 2900,
    billing_interval: 'month',
    provider_price_id: providerPriceId,
  }, OPERATOR);
  await service.publishPriceVersion(price.price_version_id, { confirm: true, reason: 'launch starter plan' }, OPERATOR);
  await service.setCatalogStatus('plan', plan.plan_id, 'published', { reason: 'launch starter plan' }, OPERATOR);
  await service.setCatalogStatus('product', product.product_id, 'published', { reason: 'launch hydi ai' }, OPERATOR);
  let keySeq = 0;
  return {
    store,
    service,
    provider,
    price,
    key(prefix = 'k') {
      keySeq += 1;
      return `${prefix}-${String(keySeq).padStart(6, '0')}`;
    },
    async tenant(name = 'Acme') {
      return service.createTenant({ name, email: `${name.toLowerCase().replace(/\W/g, '')}@example.test` }, OPERATOR);
    },
    async checkout(tenant, { paymentSucceeds = true } = {}) {
      const started = await service.startCheckout(tenant.tenant_id, {
        priceVersionId: price.price_version_id,
        idempotencyKey: this.key('co'),
      });
      const intent = await store.findOne('billing_checkout_intents', { intent_id: started.intent_id });
      const completed = provider.completeCheckout(intent.provider_session_id, { paymentSucceeds });
      return { started, intent, ...completed };
    },
  };
}

async function runHermeticBillingSecurityChecks() {
  const cases = { webhook: [], crossTenant: [], revocation: [] };
  let webhookOk = true;
  let crossOk = true;
  let revOk = true;

  process.env.BILLING_CUSTOMER_TOKEN_SECRET = SECRET;
  process.env.BILLING_LEGACY_CUSTOMER_TOKEN = 'true';
  process.env.BILLING_SUPABASE_AUTH = 'false';

  const h = await buildHarness();
  const checkoutRoute = require('../../pages/api/billing/checkout').default;
  const webhookRoute = require('../../pages/api/billing/webhook').default;

  function call(handler, { method = 'POST', headers = {}, body } = {}) {
    const req = { method, headers: { 'x-forwarded-for': '10.0.0.1', ...headers }, body, query: {}, socket: {} };
    const r = { statusCode: 200, headers: {}, body: undefined };
    r.status = (c) => { r.statusCode = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.setHeader = () => r;
    return handler(req, r).then(() => r);
  }

  const a = await h.tenant('Alpha');
  const b = await h.tenant('Beta');
  const bearerA = { authorization: `Bearer ${issueCustomerToken(a.tenant_id, { secret: SECRET }).token}` };

  const checkout = await call(checkoutRoute, {
    headers: bearerA,
    body: {
      price_version_id: h.price.price_version_id,
      idempotency_key: 'abcdefgh-hermetic',
      tenant_id: b.tenant_id,
    },
  });
  const intent = await h.store.findOne('billing_checkout_intents', { intent_id: checkout.body.intent_id });
  const bodyForgeryOk = checkout.statusCode === 200 && intent.tenant_id === a.tenant_id;
  cases.crossTenant.push({ name: 'checkout_ignores_body_tenant_id', ok: bodyForgeryOk });
  crossOk = crossOk && bodyForgeryOk;

  const ctxB = await resolveCustomerIdentity(
    { headers: { authorization: `Bearer ${issueCustomerToken(b.tenant_id, { secret: SECRET }).token}` } },
    {},
    { store: h.store },
  );
  cases.crossTenant.push({ name: 'legacy_token_tenant_isolation', ok: ctxB?.tenantId === b.tenant_id });
  crossOk = crossOk && ctxB?.tenantId === b.tenant_id;

  const c = await h.checkout(a);
  const ev = c.events.find((e) => e.type === 'checkout.session.completed');
  const { rawBody, headers: goodHeaders } = h.provider.deliver(ev);
  const bad = await call(webhookRoute, { body: rawBody, headers: { 'x-fake-billing-signature': '00' } });
  cases.webhook.push({ name: 'invalid_signature_rejected', ok: bad.statusCode === 400 && bad.body?.error === 'invalid_signature' });
  webhookOk = webhookOk && bad.statusCode === 400;

  const ok1 = await call(webhookRoute, { body: rawBody, headers: goodHeaders });
  const ok2 = await call(webhookRoute, { body: rawBody, headers: goodHeaders });
  cases.webhook.push({ name: 'duplicate_webhook_idempotent', ok: ok1.statusCode === 200 && ok2.body?.duplicate === true });
  webhookOk = webhookOk && ok2.body?.duplicate === true;

  const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  await registerTenantOwner(h.store, { tenantId: a.tenant_id, authUserId: userId, actor: { type: 'customer', id: userId } });
  await setMembershipStatus(h.store, {
    tenantId: a.tenant_id,
    authUserId: userId,
    status: 'revoked',
    actor: { type: 'operator', id: 'op' },
    reason: 'test revoke',
  });
  cases.revocation.push({ name: 'revoked_membership_not_active', ok: (await getActiveMembershipForUser(h.store, userId)) === null });
  revOk = revOk && (await getActiveMembershipForUser(h.store, userId)) === null;

  const signingKey = 'device-sign-key-hermetic-test-123456';
  await bindWalkieOwner(h.store, {
    deviceId: 'dev-r',
    tenantId: a.tenant_id,
    actor: { type: 'operator', id: 'op' },
    reason: 'bind test',
  });
  await revokeWalkieBinding(h.store, {
    deviceId: 'dev-r',
    tenantId: a.tenant_id,
    actor: { type: 'operator', id: 'op' },
    reason: 'revoke test',
  });
  const token = signDeviceToken('dev-r', signingKey);
  const mockSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { device_id: 'dev-r', role: 'operator', status: 'approved', secret_hash: signingKey },
            error: null,
          }),
        }),
      }),
    }),
  };
  const walkieCtx = await resolveCustomerIdentity(
    { headers: { 'x-hydi-device-token': token } },
    {},
    { store: h.store, supabaseLookupDevice: mockSupabase },
  );
  cases.revocation.push({ name: 'revoked_walkie_binding_denied', ok: walkieCtx === null });
  revOk = revOk && walkieCtx === null;

  return {
    webhook: { ok: webhookOk, cases: cases.webhook },
    crossTenant: { ok: crossOk, cases: cases.crossTenant },
    revocation: { ok: revOk, cases: cases.revocation },
  };
}

module.exports = { runHermeticBillingSecurityChecks };
