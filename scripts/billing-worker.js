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
const fs = require('fs');
const path = require('path');
const { getBillingService } = require('../lib/billing/http');

const ROOT = path.resolve(__dirname, '..');
const STATUS_PATH = path.join(ROOT, '.runtime', 'billing', 'worker-status.json');

function writeWorkerStatus(patch) {
  try {
    fs.mkdirSync(path.dirname(STATUS_PATH), { recursive: true });
    let prev = {};
    try { prev = JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8')); } catch { /* first write */ }
    const next = { ...prev, ts: new Date().toISOString(), ...patch };
    const tmp = `${STATUS_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, STATUS_PATH);
  } catch { /* best effort */ }
}

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
  writeWorkerStatus({ lastRetry: { counts, n: results.length } });
  return results;
}

async function reconcilePass(service) {
  if (!service.provider) { log('reconcile skipped: no provider configured'); return null; }
  const report = await service.reconcile();
  await service.audit({ type: 'system', id: 'billing-worker' }, 'reconcile.run', { type: 'system', id: 'reconcile' }, { after: report });
  log('reconcile pass', { checked: report.subscriptions_checked, changed: report.subscriptions_changed, checkouts: report.checkouts_checked, errors: report.errors.length });
  writeWorkerStatus({ lastReconcile: report });
  return report;
}

async function main() {
  if (!once) {
    require('../lib/runtime/provenance').recordProcessProvenance('hydi-billing-worker', { root: ROOT }).catch(() => null);
  }
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
