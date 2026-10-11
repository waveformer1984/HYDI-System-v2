'use strict';

/**
 * Shared harness for the billing acceptance scenarios. Builds a real
 * BillingService on either the in-memory store (hermetic, Tier 1) or a real
 * Postgres with the billing migration applied (Tier 2), wired to the fake
 * provider, which emits Stripe-shaped HMAC-signed webhooks. All data is
 * synthetic; no network, no real payment provider.
 */

const { BillingService } = require('../../../lib/billing/service');
const { MemoryBillingStore } = require('../../../lib/billing/stores/memory-store');
const { FakeBillingProvider } = require('../../../lib/billing/providers/fake-provider');
const { loadPolicy } = require('../../../lib/billing/policy');

const OPERATOR = { type: 'operator', id: 'test-operator' };
const DAY = 86400000;

const BILLING_TABLES = [
  'billing_audit_events', 'billing_refunds', 'billing_provider_cost_records', 'billing_usage_events',
  'billing_payments', 'billing_entitlements', 'billing_subscriptions', 'billing_checkout_intents',
  'billing_webhook_events', 'billing_price_versions', 'billing_plans', 'billing_products', 'billing_tenants',
];

async function makeStore(kind) {
  if (kind === 'memory') return new MemoryBillingStore();
  const { PgBillingStore } = require('../../../lib/billing/stores/pg-store');
  const store = new PgBillingStore({ connectionString: process.env.BILLING_TEST_DATABASE_URL || undefined });
  // The append-only trigger blocks DELETE on audit rows; TRUNCATE is the
  // test-only reset path and is not available to the application role.
  await store.query(`TRUNCATE ${BILLING_TABLES.map((t) => `public.${t}`).join(', ')} CASCADE`);
  return store;
}

async function createHarness(kind, policyOverrides = {}) {
  const clock = { t: new Date('2026-10-01T12:00:00Z') };
  const now = () => new Date(clock.t.getTime());
  const store = await makeStore(kind);
  const provider = new FakeBillingProvider({ secret: 'test_webhook_secret', clock: now });
  const policy = loadPolicy({ graceDays: 7, renewalSlackHours: 24, ...policyOverrides });
  const logger = { error() {}, warn() {}, info() {}, log() {} };
  const service = new BillingService({ store, provider, policy, clock: now, appUrl: 'https://hydi.test', rateCard: null, logger });

  const product = await service.createProduct({ product_key: 'hydi_ai', name: 'Hydi AI', revenue_stream: 'hydi_platform' }, OPERATOR);
  const plan = await service.createPlan({
    product_id: product.product_id, plan_key: 'starter', name: 'Starter',
    features: ['ai_completions', 'api_access'], limits: { ai_completions: 5, seats: 1 },
  }, OPERATOR);
  const providerPriceId = provider.registerPrice({ unitAmountMinor: 2900, currency: 'usd', interval: 'month' });
  const price = await service.createPriceVersion({
    plan_id: plan.plan_id, currency: 'usd', unit_amount_minor: 2900, billing_interval: 'month', provider_price_id: providerPriceId,
  }, OPERATOR);
  await service.publishPriceVersion(price.price_version_id, { confirm: true, reason: 'launch starter plan' }, OPERATOR);
  await service.setCatalogStatus('plan', plan.plan_id, 'published', { reason: 'launch starter plan' }, OPERATOR);
  await service.setCatalogStatus('product', product.product_id, 'published', { reason: 'launch hydi ai' }, OPERATOR);

  let keySeq = 0;
  const h = {
    kind, clock, now, store, provider, service, product, plan, price, OPERATOR,
    advance(ms) { clock.t = new Date(clock.t.getTime() + ms); },
    advanceDays(d) { h.advance(d * DAY); },
    key(prefix = 'k') { keySeq += 1; return `${prefix}-${String(keySeq).padStart(6, '0')}`; },
    async tenant(name = 'Acme') {
      return service.createTenant({ name, email: `${name.toLowerCase().replace(/\W/g, '')}@example.test` }, OPERATOR);
    },
    /** Verify + store + process, exactly like the webhook route. */
    async deliver(event, opts) {
      const { rawBody, headers } = provider.deliver(event, opts);
      const stored = await service.receiveWebhook(rawBody, headers);
      if (stored.duplicate) return { duplicate: true };
      const r = await service.processWebhookEvent(stored.eventRowId);
      return { duplicate: false, eventRowId: stored.eventRowId, ...r };
    },
    async deliverAll(events) {
      const out = [];
      for (const e of events) out.push(await h.deliver(e));
      return out;
    },
    /** Starts checkout and completes it at the provider; returns emitted events (not yet delivered). */
    async checkout(tenant, { paymentSucceeds = true, priceVersionId } = {}) {
      const started = await service.startCheckout(tenant.tenant_id, { priceVersionId: priceVersionId || price.price_version_id, idempotencyKey: h.key('co') });
      const intent = await store.findOne('billing_checkout_intents', { intent_id: started.intent_id });
      const completed = provider.completeCheckout(intent.provider_session_id, { paymentSucceeds });
      return { started, intent, ...completed };
    },
    async subscribe(tenant, opts) {
      const c = await h.checkout(tenant, opts);
      await h.deliverAll(c.events);
      const sub = await store.findOne('billing_subscriptions', { provider_subscription_id: c.subscriptionId });
      return { ...c, sub };
    },
    async use(tenant, key, opts = {}) {
      return service.runMetered({
        tenantId: tenant.tenant_id, featureKey: opts.feature || 'ai_completions', units: opts.units || 1,
        idempotencyKey: key || h.key('use'),
        operation: opts.operation || (async () => ({ result: 'ok', costs: [{ provider: 'ollama', model: 'llama3', inputUnits: 10, outputUnits: 20 }] })),
      });
    },
    async close() { await store.close(); },
  };
  return h;
}

module.exports = { createHarness, OPERATOR, DAY };
