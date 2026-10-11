'use strict';

/**
 * Dashboard calculations reconcile with seeded source records. Every number
 * asserted here is computed by hand from the rows inserted below.
 */

const { BillingService } = require('../../../lib/billing/service');
const { MemoryBillingStore } = require('../../../lib/billing/stores/memory-store');
const { buildRevenueReport, METRIC_DEFINITIONS } = require('../../../lib/billing/reporting');

const T = (s) => new Date(s);

async function seed() {
  const store = new MemoryBillingStore();
  const service = new BillingService({ store, provider: null, clock: () => T('2026-10-20T00:00:00Z'), rateCard: null, logger: { error() {} } });
  const ins = (t, r) => store.insert(t, r);

  const product = await ins('billing_products', { product_key: 'hydi_ai', name: 'Hydi AI', revenue_stream: 'hydi_platform', status: 'published' });
  const starter = await ins('billing_plans', { product_id: product.product_id, plan_key: 'starter', name: 'Starter', features: ['ai_completions'], status: 'published' });
  const pro = await ins('billing_plans', { product_id: product.product_id, plan_key: 'pro', name: 'Pro', features: ['ai_completions'], status: 'published' });
  const pvStarter = await ins('billing_price_versions', { plan_id: starter.plan_id, version: 1, currency: 'usd', unit_amount_minor: 2900, billing_interval: 'month', provider_price_id: 'p1', status: 'published' });
  const pvProYear = await ins('billing_price_versions', { plan_id: pro.plan_id, version: 1, currency: 'usd', unit_amount_minor: 99900, billing_interval: 'year', provider_price_id: 'p2', status: 'published' });
  const pvEur = await ins('billing_price_versions', { plan_id: starter.plan_id, version: 2, currency: 'eur', unit_amount_minor: 2500, billing_interval: 'month', provider_price_id: 'p3', status: 'published' });

  const tenants = [];
  for (let i = 0; i < 6; i++) tenants.push(await ins('billing_tenants', { name: `T${i}`, email: `t${i}@example.test` }));
  const sub = (tenant, pv, status, created) => ins('billing_subscriptions', {
    tenant_id: tenant.tenant_id, price_version_id: pv.price_version_id, provider_subscription_id: `sub_${tenant.name}_${created.getTime()}`,
    status, provider_state_at: created, created_at: created,
  });
  const s0 = await sub(tenants[0], pvStarter, 'active', T('2026-10-01'));
  const s1 = await sub(tenants[1], pvProYear, 'past_due', T('2026-10-02'));
  await sub(tenants[2], pvStarter, 'trialing', T('2026-10-03'));
  await sub(tenants[3], pvStarter, 'canceled', T('2026-09-01'));
  const s4 = await sub(tenants[4], pvEur, 'active', T('2026-10-04'));
  await sub(tenants[5], pvStarter, 'canceled', T('2026-08-01'));
  await sub(tenants[5], pvStarter, 'incomplete', T('2026-10-05')); // latest for T5

  const pay = (tenant, s, inv, status, amount, currency, at, extra = {}) => ins('billing_payments', {
    tenant_id: tenant.tenant_id, subscription_id: s ? s.subscription_id : null, provider_invoice_id: inv, status,
    currency, amount_minor: amount, occurred_at: at, ...extra,
  });
  const p0 = await pay(tenants[0], s0, 'in_0', 'partially_refunded', 2900, 'usd', T('2026-10-01T10:00:00Z'), { amount_refunded_minor: 900, tax_minor: 200 });
  await pay(tenants[1], s1, 'in_1', 'succeeded', 99900, 'usd', T('2026-10-02T10:00:00Z'));
  await pay(tenants[1], s1, 'in_1b', 'failed', 99900, 'usd', T('2026-10-15T10:00:00Z'));
  await pay(tenants[4], s4, 'in_4', 'disputed', 2500, 'eur', T('2026-10-04T10:00:00Z'), { amount_disputed_minor: 2500, tax_minor: 400 });
  await pay(tenants[3], null, 'in_3', 'succeeded', 2900, 'usd', T('2026-09-01T10:00:00Z')); // outside window
  await pay(tenants[0], null, 'in_x', 'succeeded', 500, 'usd', T('2026-10-31T23:59:59Z')); // unattributed, in window

  await ins('billing_refunds', { payment_id: p0.payment_id, tenant_id: tenants[0].tenant_id, provider_refund_id: 're_1', amount_minor: 900, currency: 'usd', status: 'succeeded', occurred_at: T('2026-10-06') });
  await ins('billing_refunds', { payment_id: p0.payment_id, tenant_id: tenants[0].tenant_id, provider_refund_id: 're_old', amount_minor: 100, currency: 'usd', status: 'succeeded', occurred_at: T('2026-09-30T23:59:59Z') });

  const intent = (status, at) => ins('billing_checkout_intents', { tenant_id: tenants[0].tenant_id, price_version_id: pvStarter.price_version_id, idempotency_key: `key-${Math.random().toString(36).slice(2, 12)}`, status, created_at: at });
  await intent('completed', T('2026-10-01'));
  await intent('completed', T('2026-10-02'));
  await intent('expired', T('2026-10-03'));
  await intent('open', T('2026-10-04'));
  await intent('completed', T('2026-09-15')); // outside window

  const ent = await ins('billing_entitlements', { tenant_id: tenants[0].tenant_id, feature_key: 'ai_completions', source_type: 'subscription', source_id: s0.subscription_id, period_start: T('2026-10-01'), period_end: T('2026-11-01'), access_until: T('2026-11-02'), status: 'active' });
  const recordUsage = (key, status, units, at) => ins('billing_usage_events', {
    tenant_id: tenants[0].tenant_id, entitlement_id: ent.entitlement_id, feature_key: 'ai_completions', idempotency_key: key,
    units_reserved: units, units_committed: status === 'committed' ? units : 0, status, period_start: T('2026-10-01'),
    reserved_at: at, expires_at: at, finalized_at: at,
  });
  const u1 = await recordUsage('use-0001', 'committed', 3, T('2026-10-05'));
  await recordUsage('use-0002', 'committed', 2, T('2026-10-06'));
  await recordUsage('use-0003', 'released', 4, T('2026-10-07'));
  const cost = (micros, status, succeeded) => ins('billing_provider_cost_records', {
    tenant_id: tenants[0].tenant_id, usage_id: u1.usage_id, job_ref: 'job', provider: 'anthropic', model: 'm',
    cost_micros: micros, cost_status: status, succeeded, created_at: T('2026-10-05'),
  });
  await cost(120000, 'estimated', true);
  await cost(30000, 'confirmed', false);
  await cost(null, 'unpriced', true);

  return { service, store };
}

describe('revenue report reconciles with seeded source records', () => {
  let report;
  beforeAll(async () => {
    const { service } = await seed();
    report = await buildRevenueReport(service, { from: T('2026-10-01T00:00:00Z'), to: T('2026-11-01T00:00:00Z') });
  });

  it('gross collected counts captured cash in the window, per currency', () => {
    // usd: 2900 (partially refunded) + 99900 + 500 ; failed and September excluded. eur: 2500 (disputed).
    expect(report.metrics.gross_collected).toEqual({ usd: 103300, eur: 2500 });
  });

  it('refunds are windowed by refund date', () => {
    expect(report.metrics.refunds).toEqual({ usd: 900 });
  });

  it('open disputes are a snapshot', () => {
    expect(report.metrics.open_disputes).toEqual({ eur: 2500 });
  });

  it('tax and fees report unknowns instead of zeros', () => {
    expect(report.metrics.tax_collected).toEqual({ amounts: { usd: 200, eur: 400 }, tax_unknown_count: 2 });
    expect(report.metrics.processing_fees).toEqual({ amounts: null, fee_unknown_count: 4 });
  });

  it('net collections = gross − refunds (fees unknown, so not deducted)', () => {
    expect(report.metrics.net_collections).toEqual({ amounts: { usd: 102400, eur: 2500 }, fees_deducted: false });
  });

  it('MRR normalizes yearly plans, counts active + past_due, excludes trialing', () => {
    // usd: 2900 (active monthly) + round(99900 / 12) = 8325 (past_due yearly) ; eur: 2500
    expect(report.metrics.mrr).toEqual({ usd: 11225, eur: 2500 });
  });

  it('customers are counted once, by their latest subscription', () => {
    expect(report.metrics.subscribers_by_status).toEqual({ active: 2, past_due: 1, trialing: 1, canceled: 1, incomplete: 1 });
  });

  it('revenue by plan attributes through the subscription', () => {
    expect(report.metrics.revenue_by_plan).toEqual({
      'hydi_platform/starter': { usd: 2900, eur: 2500 },
      'hydi_platform/pro': { usd: 99900 },
      unattributed: { usd: 500 },
    });
  });

  it('checkout conversion uses intents started in the window', () => {
    expect(report.metrics.checkout_conversion).toEqual({ started: 4, completed: 2, rate: 0.5 });
  });

  it('usage and variable cost; margin is an explicitly labelled estimate', () => {
    const u = report.metrics.usage_and_cost;
    expect(u.units_by_feature).toEqual({ ai_completions: 5 });
    expect(u.cost_micros).toEqual({ usd: 150000 });
    expect(u.cost_records).toEqual({ estimated: 1, confirmed: 1, unpriced: 1 });
    // usd: 102400 minor × 10,000 − 150,000 micros ; eur has no cost data → no margin
    expect(u.contribution_margin_micros_estimate).toEqual({ usd: 1023850000 });
  });

  it('never sums currencies and declares what it does not compute', () => {
    expect(Object.keys(report.metrics.not_computed)).toEqual(expect.arrayContaining(['recognized_revenue', 'cac_ltv', 'retention_cohorts']));
    expect(report.window.timezone).toBe('UTC');
  });

  it('every metric has a complete definition', () => {
    for (const d of METRIC_DEFINITIONS) {
      for (const field of ['formula', 'source', 'window', 'currency', 'included', 'excluded', 'refresh', 'limitations']) {
        expect(typeof d[field]).toBe('string');
        expect(d[field].length).toBeGreaterThan(2);
      }
      expect(report.metrics).toHaveProperty(d.key);
    }
  });
});
