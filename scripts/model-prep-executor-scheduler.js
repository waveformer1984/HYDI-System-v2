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
 * Usage:
 *   node scripts/model-prep-executor-scheduler.js            # continuous
 *   node scripts/model-prep-executor-scheduler.js --once     # single cycle
 *   MODEL_PREP_INTERVAL_MS=10000 node scripts/model-prep-executor-scheduler.js
 */

require('./babel-register');
require('dotenv').config({ path: '.env.local' });

const { processNextJob, recoverStaleJobs, sweepAwaitingReview } = require('../lib/revenue/JobExecutor');

const INTERVAL_MS = parseInt(process.env.MODEL_PREP_INTERVAL_MS || '30000', 10);
const ONCE = process.argv.includes('--once');

let stopping = false;

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

async function main() {
  console.log(`[model-prep-executor] started — interval ${INTERVAL_MS}ms`);
  await cycle();
  if (ONCE) return;
  while (!stopping) {
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
    if (stopping) break;
    try {
      await cycle();
    } catch (e) {
      console.error('[model-prep-executor] cycle error:', e instanceof Error ? e.message : e);
    }
  }
  console.log('[model-prep-executor] stopped');
}

process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

main().catch((e) => {
  console.error('[model-prep-executor] fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
