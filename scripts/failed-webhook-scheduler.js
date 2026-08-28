/**
 * Failed Webhook Retry Scheduler
 *
 * Runs the FailedWebhookDetector on a recurring schedule.
 * Default interval: every 30 minutes (1,800,000 ms).
 *
 * Bounded recovery: retries failed webhooks ONCE, then escalates
 * persistent failures. Stale 'processing' webhooks are escalated
 * (not auto-reset) to avoid duplicate processing.
 *
 * Usage:
 *   node scripts/failed-webhook-scheduler.js              # every 30min, continuous
 *   node scripts/failed-webhook-scheduler.js --once       # single cycle
 *   WEBHOOK_RETRY_INTERVAL_MS=3600000 node scripts/failed-webhook-scheduler.js  # hourly
 *   WEBHOOK_RETRY_OBSERVE_ONLY=true node scripts/failed-webhook-scheduler.js    # observe-only
 */

require('./babel-register');
require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');
const { FailedWebhookDetector } = require('../lib/operational/FailedWebhookDetector');

const INTERVAL_MS = parseInt(process.env.WEBHOOK_RETRY_INTERVAL_MS || '1800000', 10);
const OBSERVE_ONLY = process.env.WEBHOOK_RETRY_OBSERVE_ONLY === 'true';
const STALE_THRESHOLD_MS = parseInt(process.env.WEBHOOK_STALE_THRESHOLD_MS || '3600000', 10);
const ONCE = process.argv.includes('--once');

function createSupabase() {
  const url = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not set');
    return null;
  }
  return createClient(url, key);
}

async function runCycle() {
  const supabase = createSupabase();
  if (!supabase) return;

  const detector = new FailedWebhookDetector({
    supabase,
    observeOnly: OBSERVE_ONLY,
    staleThresholdMs: STALE_THRESHOLD_MS,
  });

  try {
    const summary = await detector.detectAndRecover();
    console.log('--- Webhook retry cycle complete ---');
    console.log(`  Failed webhooks: ${summary.totalFailed}`);
    console.log(`  Stale processing: ${summary.totalStale}`);
    console.log(`  Retried: ${summary.retried}`);
    console.log(`  Escalated: ${summary.escalated}`);
    console.log(`  Skipped: ${summary.skipped}`);
    if (summary.details.length > 0) {
      console.log('  Details:');
      summary.details.forEach(d => {
        console.log(`    ${d.eventId}: ${d.action} — ${d.reason}`);
      });
    }
  } catch (err) {
    console.error('Webhook retry cycle failed:', err instanceof Error ? err.message : 'Unknown error');
  }
}

async function main() {
  console.log(`[${new Date().toISOString()}] Failed Webhook Retry Scheduler starting`);
  console.log(`  Interval: ${INTERVAL_MS}ms (${Math.round(INTERVAL_MS / 60000)} minutes)`);
  console.log(`  Stale processing threshold: ${STALE_THRESHOLD_MS}ms (${Math.round(STALE_THRESHOLD_MS / 60000)} minutes)`);
  console.log(`  Observe only: ${OBSERVE_ONLY}`);
  console.log(`  Mode: ${ONCE ? 'single cycle' : 'continuous'}`);
  console.log('');

  if (ONCE) {
    await runCycle();
    process.exit(0);
  }

  // Run immediately, then on interval
  await runCycle();
  console.log(`Next cycle scheduled in ${Math.round(INTERVAL_MS / 60000)} minutes`);

  setInterval(async () => {
    console.log(`\n[${new Date().toISOString()}] --- Webhook retry cycle starting ---`);
    await runCycle();
    console.log(`Next cycle scheduled in ${Math.round(INTERVAL_MS / 60000)} minutes`);
  }, INTERVAL_MS);

  console.log('Scheduler is running. Press Ctrl+C to stop.');

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nReceived SIGINT, shutting down...');
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    console.log('\nReceived SIGTERM, shutting down...');
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal error:', err instanceof Error ? err.message : 'Unknown error');
  process.exit(1);
});
