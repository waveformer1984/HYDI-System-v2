#!/usr/bin/env node
'use strict';

/**
 * Sandbox setup for the Revenue Streams Module. TEST MODE ONLY.
 *
 * Creates (idempotently, by key) a draft→published product, plan and price in
 * the billing catalog, creates the matching Stripe test-mode Price, and
 * optionally onboards a synthetic tenant and prints its customer access link.
 *
 *   node scripts/billing-sandbox-setup.js \
 *     --amount-minor 2900 --currency usd --interval month \
 *     --ai-limit 500 --tenant-name "Sandbox Co" --tenant-email sandbox@example.test
 *
 * Refuses to run with a live Stripe key. Prints the customer token once —
 * it is a credential; do not paste it into tickets or chat.
 */

require('dotenv').config();
const { getBillingService } = require('../lib/billing/http');
const { issueCustomerToken } = require('../lib/billing/customer-auth');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const key = process.env.STRIPE_SECRET_KEY || '';
  if (process.env.BILLING_PROVIDER !== 'fake' && !(key.startsWith('sk_test_') || key.startsWith('rk_test_'))) {
    throw new Error('refusing: STRIPE_SECRET_KEY must be a TEST-mode key (sk_test_/rk_test_) for sandbox setup');
  }
  const actor = { type: 'operator', id: 'sandbox-setup-script' };
  const service = getBillingService();
  const amount = Number(arg('amount-minor', '2900'));
  const currency = arg('currency', 'usd');
  const interval = arg('interval', 'month');
  const aiLimit = Number(arg('ai-limit', '500'));

  const catalog = await service.listCatalogAdmin();
  let product = catalog.products.find((p) => p.product_key === 'hydi_ai');
  if (!product) product = await service.createProduct({ product_key: 'hydi_ai', name: 'Hydi(ai)', description: 'AI operations assistant', revenue_stream: 'hydi_platform' }, actor);
  let plan = catalog.plans.find((p) => p.plan_key === 'starter');
  if (!plan) {
    plan = await service.createPlan({ product_id: product.product_id, plan_key: 'starter', name: 'Starter', description: 'For small teams getting started', features: ['ai_completions', 'api_access'], limits: { ai_completions: aiLimit, seats: 3 } }, actor);
  }
  let price = catalog.prices.find((p) => p.plan_id === plan.plan_id && p.status === 'published' && p.unit_amount_minor === amount && p.currency === currency && p.billing_interval === interval);
  if (!price) {
    const draft = await service.createPriceVersion({ plan_id: plan.plan_id, currency, unit_amount_minor: amount, billing_interval: interval }, actor);
    price = await service.publishPriceVersion(draft.price_version_id, { createInProvider: true, confirm: true, reason: 'sandbox setup script' }, actor);
  }
  if (plan.status === 'draft') await service.setCatalogStatus('plan', plan.plan_id, 'published', { reason: 'sandbox setup script' }, actor);
  if (product.status === 'draft') await service.setCatalogStatus('product', product.product_id, 'published', { reason: 'sandbox setup script' }, actor);
  console.log(`catalog ready: product=${product.product_key} plan=${plan.plan_key} price_version=${price.price_version_id} provider_price=${price.provider_price_id}`);

  const tenantName = arg('tenant-name');
  if (tenantName) {
    const tenant = await service.createTenant({ name: tenantName, email: arg('tenant-email', 'sandbox@example.test') }, actor);
    const { token, expires_at } = issueCustomerToken(tenant.tenant_id);
    const base = (process.env.BILLING_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
    console.log(`tenant ${tenant.tenant_id} created. Customer link (expires ${expires_at}):`);
    console.log(`${base}/pricing?token=${token}`);
  }
  await service.store.close();
}

main().catch((err) => {
  console.error(`sandbox setup failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  process.exit(1);
});
