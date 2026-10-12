#!/usr/bin/env node
'use strict';

/**
 * Billing background worker (Revenue Streams Module).
 *
 *   - every BILLING_WORKER_INTERVAL_SECONDS (default 30): retry due webhook
 *     events (received/failed past their backoff, or processing with an
 *     expired lock). Events exceeding BILLING_WEBHOOK_MAX_ATTEMPTS are
 *     dead-lettered for operator replay.
 *   - every BILLING_RECONCILE_INTERVAL_MINUTES (default 15): reconcile
 *     non-terminal subscriptions and stale open checkouts with the provider.
 *
 * Usage:
 *   node scripts/billing-worker.js            # loop
 *   node scripts/billing-worker.js --once     # one retry pass + one reconcile, then exit
 *
 * Uses the same env as the web app (BILLING_DATABASE_URL or PG_*,
 * STRIPE_SECRET_KEY, BILLING_STRIPE_WEBHOOK_SECRET). Never logs payloads.
 */

require('dotenv').config();
const { getBillingService } = require('../lib/billing/http');

const once = process.argv.includes('--once');
const retryEveryMs = Math.max(5, Number(process.env.BILLING_WORKER_INTERVAL_SECONDS) || 30) * 1000;
const reconcileEveryMs = Math.max(1, Number(process.env.BILLING_RECONCILE_INTERVAL_MINUTES) || 15) * 60000;

function log(msg, extra) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), component: 'billing-worker', msg, ...extra }));
}

async function retryPass(service) {
  const results = await service.processDueWebhookEvents({ limit: 100 });
  const counts = results.reduce((acc, r) => { acc[r.outcome] = (acc[r.outcome] || 0) + 1; return acc; }, {});
  if (results.length) log('retry pass', { counts });
  return results;
}

async function reconcilePass(service) {
  if (!service.provider) { log('reconcile skipped: no provider configured'); return null; }
  const report = await service.reconcile();
  await service.audit({ type: 'system', id: 'billing-worker' }, 'reconcile.run', { type: 'system', id: 'reconcile' }, { after: report });
  log('reconcile pass', { checked: report.subscriptions_checked, changed: report.subscriptions_changed, checkouts: report.checkouts_checked, errors: report.errors.length });
  return report;
}

async function main() {
  const service = getBillingService();
  if (once) {
    await retryPass(service);
    await reconcilePass(service);
    await service.store.close();
    return;
  }
  let lastReconcile = 0;
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  log('started', { retryEveryMs, reconcileEveryMs });
  while (!stopping) {
    try {
      await retryPass(service);
      if (Date.now() - lastReconcile >= reconcileEveryMs) {
        lastReconcile = Date.now();
        await reconcilePass(service);
      }
    } catch (err) {
      log('pass failed', { error: err instanceof Error ? err.message.slice(0, 300) : 'unknown' });
    }
    await new Promise((r) => setTimeout(r, retryEveryMs));
  }
  await service.store.close();
  log('stopped');
}

main().catch((err) => {
  log('fatal', { error: err instanceof Error ? err.message.slice(0, 300) : 'unknown' });
  process.exit(1);
});
