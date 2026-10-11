'use strict';

/**
 * Revenue reporting. Every metric is computed from billing_* source rows on
 * request (refresh = on read; no cache), per currency, with no currency
 * conversion. METRIC_DEFINITIONS is the contract: the admin dashboard renders
 * it next to the numbers, and tests/unit/billing/reporting.test.js
 * reconciles each formula against seeded rows.
 *
 * Cash collected, MRR and recognized revenue are different things and are
 * never presented as each other. Recognized revenue, CAC, LTV and retention
 * cohorts are NOT computed: there is not yet enough underlying data.
 */

const { sumByCurrency } = require('./money');

/** Currencies whose minor unit is 1/100 — the only ones margin is estimated for. */
const TWO_DECIMAL = ['usd', 'eur', 'gbp', 'cad', 'aud', 'nzd', 'chf'];
const MICROS_PER_MINOR = 10000; // 1 cent = 10,000 micro-dollars

const COLLECTED_STATUSES = ['succeeded', 'partially_refunded', 'refunded', 'disputed'];

const METRIC_DEFINITIONS = [
  {
    key: 'gross_collected',
    label: 'Gross payments collected',
    formula: 'Σ billing_payments.amount_minor',
    source: 'billing_payments',
    window: 'occurred_at ∈ [from, to), UTC',
    currency: 'per currency; never summed across currencies',
    included: 'status ∈ {succeeded, partially_refunded, refunded, disputed} (cash was captured)',
    excluded: 'status = failed',
    refresh: 'computed on each request',
    limitations: 'Provider-reported invoice amount_paid; includes tax when tax is collected.',
  },
  {
    key: 'refunds',
    label: 'Refunds',
    formula: 'Σ billing_refunds.amount_minor',
    source: 'billing_refunds',
    window: 'refund occurred_at ∈ [from, to), UTC — may relate to payments outside the window',
    currency: 'per currency',
    included: 'all refunds reported by charge.refunded webhooks',
    excluded: 'refunds requested but not yet confirmed by the provider',
    refresh: 'computed on each request',
    limitations: 'Depends on webhook delivery; run reconciliation if webhooks were down.',
  },
  {
    key: 'open_disputes',
    label: 'Open disputes (snapshot)',
    formula: 'Σ billing_payments.amount_disputed_minor where status = disputed',
    source: 'billing_payments',
    window: 'point-in-time at request (not windowed)',
    currency: 'per currency',
    included: 'disputes opened and not won',
    excluded: 'won disputes',
    refresh: 'computed on each request',
    limitations: 'Lost disputes stay counted here; dispute fees are not tracked.',
  },
  {
    key: 'tax_collected',
    label: 'Tax collected',
    formula: 'Σ billing_payments.tax_minor (non-null) over collected payments',
    source: 'billing_payments',
    window: 'occurred_at ∈ [from, to), UTC',
    currency: 'per currency',
    included: 'collected payments with a known tax amount',
    excluded: 'payments where the provider reported no tax figure (counted in tax_unknown_count)',
    refresh: 'computed on each request',
    limitations: 'Hydi does not calculate tax; figures are whatever the provider invoice reports.',
  },
  {
    key: 'processing_fees',
    label: 'Payment-processing fees',
    formula: 'Σ billing_payments.fee_minor (non-null)',
    source: 'billing_payments',
    window: 'occurred_at ∈ [from, to), UTC',
    currency: 'per currency',
    included: 'payments with a known fee',
    excluded: 'payments without fee data (fee_unknown_count)',
    refresh: 'computed on each request',
    limitations: 'NOT YET POPULATED: fees need the provider balance transaction, which slice 1 does not fetch. Shown as unknown, never as zero.',
  },
  {
    key: 'net_collections',
    label: 'Net collections',
    formula: 'gross_collected − refunds (− processing_fees only when every fee is known)',
    source: 'derived',
    window: 'same as inputs',
    currency: 'per currency',
    included: 'see inputs',
    excluded: 'open disputes are not deducted until lost',
    refresh: 'computed on each request',
    limitations: 'Cash basis. Not recognized revenue.',
  },
  {
    key: 'mrr',
    label: 'Monthly recurring revenue (snapshot)',
    formula: 'Σ over subscriptions of round(unit_amount_minor / months_in_interval), months = interval_count (month) or 12·interval_count (year)',
    source: 'billing_subscriptions ⋈ billing_price_versions',
    window: 'point-in-time at request',
    currency: 'per currency',
    included: 'status ∈ {active, past_due}, including ones scheduled to cancel at period end',
    excluded: 'trialing, incomplete, unpaid, paused, canceled, incomplete_expired; discounts/coupons are not netted',
    refresh: 'computed on each request',
    limitations: 'List-price MRR from the agreed price version; ignores coupons, tax and proration.',
  },
  {
    key: 'subscribers_by_status',
    label: 'Customers by subscription status',
    formula: 'count(distinct tenant_id) per latest-subscription status',
    source: 'billing_subscriptions',
    window: 'point-in-time at request',
    currency: 'n/a',
    included: 'each tenant counted once, by its most recently created subscription',
    excluded: 'tenants that never subscribed',
    refresh: 'computed on each request',
    limitations: 'Reflects the last applied provider state; run reconciliation for certainty.',
  },
  {
    key: 'revenue_by_plan',
    label: 'Gross collected by plan and revenue stream',
    formula: 'gross_collected grouped by plan_key and product.revenue_stream',
    source: 'billing_payments → billing_subscriptions → billing_price_versions → billing_plans → billing_products',
    window: 'occurred_at ∈ [from, to), UTC',
    currency: 'per currency',
    included: 'collected payments linked to a subscription',
    excluded: 'payments not linked to a subscription are grouped as "unattributed"',
    refresh: 'computed on each request',
    limitations: 'Attributed to the price version the subscription holds now, not at payment time.',
  },
  {
    key: 'checkout_conversion',
    label: 'Checkout conversion',
    formula: 'completed / started checkout intents',
    source: 'billing_checkout_intents',
    window: 'created_at ∈ [from, to), UTC',
    currency: 'n/a',
    included: 'all intents started in the window',
    excluded: 'nothing',
    refresh: 'computed on each request',
    limitations: 'Completed checkout ≠ paid: payment confirmation is tracked by subscription status.',
  },
  {
    key: 'usage_and_cost',
    label: 'Usage, variable provider cost, contribution margin (estimate)',
    formula: 'units = Σ committed usage; cost = Σ cost_micros by cost_currency; margin = net_collections·10,000 − cost_micros (two-decimal currency only)',
    source: 'billing_usage_events, billing_provider_cost_records',
    window: 'finalized_at / created_at ∈ [from, to), UTC',
    currency: 'cost in cost_currency micro-units; margin only where payment and cost currency match',
    included: 'estimated and confirmed costs; failed attempts included (they cost money)',
    excluded: 'unpriced costs (counted separately), shared infrastructure (not allocated)',
    refresh: 'computed on each request',
    limitations: 'ESTIMATE. Costs come from the operator rate card; shared infrastructure is not allocated.',
  },
];

function inWindow(value, from, to) {
  if (!value) return false;
  const t = new Date(value).getTime();
  return t >= from.getTime() && t < to.getTime();
}

function monthsIn(pv) {
  return pv.billing_interval === 'year' ? 12 * pv.interval_count : pv.interval_count;
}

/**
 * @param {import('./service').BillingService} service
 * @param {{ from: Date, to: Date }} window
 */
async function buildRevenueReport(service, { from, to }) {
  const store = service.store;
  const [payments, refunds, subs, prices, plans, products, intents, usage, costs] = await Promise.all([
    store.findMany('billing_payments', {}),
    store.findMany('billing_refunds', { occurred_at: { gte: from } }),
    store.findMany('billing_subscriptions', {}),
    store.findMany('billing_price_versions', {}),
    store.findMany('billing_plans', {}),
    store.findMany('billing_products', {}),
    store.findMany('billing_checkout_intents', { created_at: { gte: from } }),
    store.findMany('billing_usage_events', { status: 'committed' }),
    store.findMany('billing_provider_cost_records', { created_at: { gte: from } }),
  ]);
  const pvById = new Map(prices.map((p) => [p.price_version_id, p]));
  const planById = new Map(plans.map((p) => [p.plan_id, p]));
  const productById = new Map(products.map((p) => [p.product_id, p]));
  const subById = new Map(subs.map((s) => [s.subscription_id, s]));

  const collected = payments.filter((p) => COLLECTED_STATUSES.includes(p.status) && inWindow(p.occurred_at, from, to));
  const windowRefunds = refunds.filter((r) => inWindow(r.occurred_at, from, to));

  const gross = sumByCurrency(collected, (p) => p.amount_minor, (p) => p.currency);
  const refundTotals = sumByCurrency(windowRefunds, (r) => r.amount_minor, (r) => r.currency);
  const openDisputes = sumByCurrency(payments.filter((p) => p.status === 'disputed'), (p) => p.amount_disputed_minor, (p) => p.currency);
  const tax = sumByCurrency(collected, (p) => p.tax_minor, (p) => p.currency);
  const fees = sumByCurrency(collected, (p) => p.fee_minor, (p) => p.currency);
  const taxUnknown = collected.filter((p) => p.tax_minor === null || p.tax_minor === undefined).length;
  const feeUnknown = collected.filter((p) => p.fee_minor === null || p.fee_minor === undefined).length;

  const currencies = [...new Set([...Object.keys(gross), ...Object.keys(refundTotals)])].sort();
  const net = {};
  for (const c of currencies) {
    net[c] = (gross[c] || 0) - (refundTotals[c] || 0) - (feeUnknown === 0 ? (fees[c] || 0) : 0);
  }

  const mrr = {};
  const mrrSubs = subs.filter((s) => s.status === 'active' || s.status === 'past_due');
  for (const s of mrrSubs) {
    const pv = pvById.get(s.price_version_id);
    if (!pv) continue;
    mrr[pv.currency] = (mrr[pv.currency] || 0) + Math.round(pv.unit_amount_minor / monthsIn(pv));
  }

  const latestByTenant = new Map();
  for (const s of subs) {
    const prev = latestByTenant.get(s.tenant_id);
    if (!prev || new Date(s.created_at).getTime() > new Date(prev.created_at).getTime()) latestByTenant.set(s.tenant_id, s);
  }
  const byStatus = {};
  for (const s of latestByTenant.values()) byStatus[s.status] = (byStatus[s.status] || 0) + 1;

  const byPlan = {};
  for (const p of collected) {
    const sub = p.subscription_id ? subById.get(p.subscription_id) : null;
    const pv = sub ? pvById.get(sub.price_version_id) : null;
    const plan = pv ? planById.get(pv.plan_id) : null;
    const product = plan ? productById.get(plan.product_id) : null;
    const key = plan ? `${product.revenue_stream}/${plan.plan_key}` : 'unattributed';
    byPlan[key] = byPlan[key] || {};
    byPlan[key][p.currency] = (byPlan[key][p.currency] || 0) + p.amount_minor;
  }

  const windowIntents = intents.filter((i) => inWindow(i.created_at, from, to));
  const completed = windowIntents.filter((i) => i.status === 'completed').length;

  const windowUsage = usage.filter((u) => inWindow(u.finalized_at, from, to));
  const unitsByFeature = {};
  for (const u of windowUsage) unitsByFeature[u.feature_key] = (unitsByFeature[u.feature_key] || 0) + u.units_committed;
  const windowCosts = costs.filter((c) => inWindow(c.created_at, from, to));
  const priced = windowCosts.filter((c) => c.cost_micros !== null && c.cost_micros !== undefined);
  const costMicros = sumByCurrency(priced, (c) => c.cost_micros, (c) => c.cost_currency);
  const margin = {};
  for (const c of currencies) {
    if (TWO_DECIMAL.includes(c) && costMicros[c] !== undefined) margin[c] = net[c] * MICROS_PER_MINOR - costMicros[c];
  }

  return {
    window: { from: from.toISOString(), to: to.toISOString(), timezone: 'UTC' },
    generated_at: service.now().toISOString(),
    definitions: METRIC_DEFINITIONS,
    metrics: {
      gross_collected: gross,
      refunds: refundTotals,
      open_disputes: openDisputes,
      tax_collected: { amounts: tax, tax_unknown_count: taxUnknown },
      processing_fees: { amounts: feeUnknown === 0 ? fees : null, fee_unknown_count: feeUnknown },
      net_collections: { amounts: net, fees_deducted: feeUnknown === 0 },
      mrr,
      subscribers_by_status: byStatus,
      revenue_by_plan: byPlan,
      checkout_conversion: { started: windowIntents.length, completed, rate: windowIntents.length ? completed / windowIntents.length : null },
      usage_and_cost: {
        units_by_feature: unitsByFeature,
        cost_micros: costMicros,
        cost_records: { estimated: priced.filter((c) => c.cost_status === 'estimated').length, confirmed: priced.filter((c) => c.cost_status === 'confirmed').length, unpriced: windowCosts.length - priced.length },
        contribution_margin_micros_estimate: margin,
      },
      not_computed: {
        recognized_revenue: 'requires revenue-recognition schedule (deferred)',
        cac_ltv: 'insufficient acquisition-cost and churn history',
        retention_cohorts: 'insufficient history; revisit after 3+ billing periods',
        credit_liabilities: 'no prepaid credits in this slice',
      },
    },
  };
}

module.exports = { buildRevenueReport, METRIC_DEFINITIONS };
