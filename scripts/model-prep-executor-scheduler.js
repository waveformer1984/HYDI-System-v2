/**
 * Model Prep Executor Scheduler
 *
 * Continuously drains the existing customer_jobs 'queued' state into the
 * Model Prep execution pipeline (JobExecutor.processNextJob). This is the
 * ONLY thing it does — it never approves, delivers, touches payment, or
 * creates authorization.
 *
 * Duplicate safety: CLAIM_NEXT_QUEUED_JOB_SQL uses FOR UPDATE SKIP LOCKED,
 * so the queued -> executing claim is atomic. Exactly one PM2 instance.
 *
 * Supervision contract (lib/revenue/model-prep-loop.js): the process never
 * exits on a dependency error — it backs off exponentially and reports
 * 'degraded' on .model-prep-executor-status.json until the dependency
 * recovers. Only SIGINT/SIGTERM (or --once) end it.
 *
 * Usage:
 *   node scripts/model-prep-executor-scheduler.js            # continuous
 *   node scripts/model-prep-executor-scheduler.js --once     # single cycle
 *   MODEL_PREP_INTERVAL_MS=10000 node scripts/model-prep-executor-scheduler.js
 */

require('./babel-register');
require('dotenv').config({ path: '.env.local' });

const path = require('path');
const { processNextJob, recoverStaleJobs, sweepAwaitingReview } = require('../lib/revenue/JobExecutor');
const {
  runSchedulerLoop,
  runOnce,
  writeModelPrepStatus,
  interruptibleSleep,
} = require('../lib/revenue/model-prep-loop');

const ROOT = path.resolve(__dirname, '..');
const INTERVAL_MS = parseInt(process.env.MODEL_PREP_INTERVAL_MS || '30000', 10);
const ONCE = process.argv.includes('--once');

let stopping = false;
const isStopping = () => stopping;

async function cycle() {
  // Recover jobs orphaned mid-execution (e.g. after a restart) before
  // claiming new work — same bounded path the executor already defines.
  try {
    const r = await recoverStaleJobs();
    if (r.recovered || r.failed) {
      console.log(`[model-prep-executor] stale recovery: ${r.recovered} recovered, ${r.failed} failed`);
    }
  } catch (e) {
    console.error('[model-prep-executor] recovery error:', e instanceof Error ? e.message : e);
  }

  // Deliver pending-review jobs that already satisfy autonomous QA —
  // covers jobs paid before the gate existed or whose delivery pass
  // was interrupted by a restart.
  try {
    const s = await sweepAwaitingReview();
    if (s.delivered || s.escalated) {
      console.log(`[model-prep-executor] delivery sweep: ${s.delivered} delivered, ${s.escalated} escalated`);
    }
  } catch (e) {
    console.error('[model-prep-executor] sweep error:', e instanceof Error ? e.message : e);
  }

  const result = await processNextJob();
  if (result) {
    console.log(`[model-prep-executor] job ${result.jobId}: ${result.success ? 'completed -> awaiting_review' : `FAILED (${result.error})`}`);
  }
}

let processProvenance = null;
const writeStatus = (snapshot) =>
  writeModelPrepStatus(ROOT, { pid: process.pid, ...snapshot, provenance: processProvenance });

const log = (m) => console.log(`[model-prep-executor] ${m}`);

async function main() {
  const { recordProcessProvenance } = require('../lib/runtime/provenance');
  processProvenance = await recordProcessProvenance('hydi-model-prep-executor', { root: ROOT });
  log(`started — interval ${INTERVAL_MS}ms`);

  if (ONCE) {
    const r = await runOnce({ cycle });
    writeStatus({
      state: r.ok ? 'ok' : 'degraded',
      consecutiveFailures: r.ok ? 0 : 1,
      lastError: r.ok ? null : r.error,
      lastSuccessAt: r.ok ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString(),
    });
    if (!r.ok) console.error(`[model-prep-executor] cycle error: ${r.error}`);
    return r.ok ? 0 : 1;
  }

  await runSchedulerLoop({
    cycle,
    isStopping,
    writeStatus,
    log,
    intervalMs: INTERVAL_MS,
    sleep: interruptibleSleep(isStopping),
  });
  log('stopped');
  return 0;
}

if (require.main === module) {
  process.on('SIGINT', () => { stopping = true; });
  process.on('SIGTERM', () => { stopping = true; });
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      // Only reachable for a defect in the loop machinery itself — a cycle
      // error is degraded state, never a fatal exit.
      console.error('[model-prep-executor] fatal:', e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
