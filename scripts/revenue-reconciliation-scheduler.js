/**
 * Revenue Reconciliation Scheduler
 *
 * Runs the RevenueReconciliationDetector on a recurring schedule.
 * Default interval: daily (86,400,000 ms = 24 hours).
 *
 * This is a READ-ONLY goal — it never modifies financial state.
 * Discrepancies are escalated through EscalationNotifier.
 *
 * Usage:
 *   node scripts/revenue-reconciliation-scheduler.js              # daily, continuous
 *   node scripts/revenue-reconciliation-scheduler.js --once       # single cycle
 *   RECONCILIATION_INTERVAL_MS=43200000 node scripts/revenue-reconciliation-scheduler.js  # every 12h
 *   RECONCILIATION_OBSERVE_ONLY=true node scripts/revenue-reconciliation-scheduler.js     # observe-only
 */

require('./babel-register');

const { createClient } = require('@supabase/supabase-js');
const { RevenueReconciliationDetector } = require('../lib/operational/RevenueReconciliationDetector');

const INTERVAL_MS = parseInt(process.env.RECONCILIATION_INTERVAL_MS || '86400000', 10);
const OBSERVE_ONLY = process.env.RECONCILIATION_OBSERVE_ONLY === 'true';
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

  const detector = new RevenueReconciliationDetector({
    supabase,
    observeOnly: OBSERVE_ONLY,
  });

  try {
    const summary = await detector.detectAndEscalate();
    console.log('--- Reconciliation cycle complete ---');
    console.log(`  Jobs checked: ${summary.totalJobs}`);
    console.log(`  Consistent: ${summary.consistent}`);
    console.log(`  Incomplete: ${summary.incomplete}`);
    console.log(`  Mismatch: ${summary.mismatch}`);
    console.log(`  Blocked: ${summary.blocked}`);
    console.log(`  Unverified ledger entries: ${summary.unverifiedLedgerEntries}`);
    console.log(`  Escalated: ${summary.escalated}`);
    if (summary.mismatches.length > 0) {
      console.log('  Mismatches:');
      summary.mismatches.forEach(m => {
        console.log(`    ${m.jobId}: ${m.violations.length} violations`);
      });
    }
  } catch (err) {
    console.error('Reconciliation cycle failed:', err instanceof Error ? err.message : 'Unknown error');
  }
}

async function main() {
  console.log(`[${new Date().toISOString()}] Revenue Reconciliation Scheduler starting`);
  console.log(`  Interval: ${INTERVAL_MS}ms (${Math.round(INTERVAL_MS / 3600000)} hours)`);
  console.log(`  Observe only: ${OBSERVE_ONLY}`);
  console.log(`  Mode: ${ONCE ? 'single cycle' : 'continuous'}`);
  console.log('');

  if (ONCE) {
    await runCycle();
    process.exit(0);
  }

  // Run immediately, then on interval
  await runCycle();
  console.log(`Next cycle scheduled in ${Math.round(INTERVAL_MS / 3600000)} hours`);

  setInterval(async () => {
    console.log(`\n[${new Date().toISOString()}] --- Reconciliation cycle starting ---`);
    await runCycle();
    console.log(`Next cycle scheduled in ${Math.round(INTERVAL_MS / 3600000)} hours`);
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
