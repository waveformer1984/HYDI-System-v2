/**
 * Job Executor Poller
 *
 * Closes the gap between "customer paid" and "artifacts get generated" in
 * the qualified revenue path (see docs/REVENUE_PATH_BOUNDARY.md and
 * docs/HYDI_REVENUE_PROOF_REPORT.md, step 8: "HEIDI picks up queued job ->
 * starts execution").
 *
 * Prior to this script, nothing in the live boot sequence called
 * JobExecutor.processNextJob()/recoverStaleJobs() -- only qualification
 * tests and scripts (tests/qualification/*, scripts/first-real-customer-
 * readiness.ts, scripts/qualify-stripe-e2e-production-path.ts) invoked
 * them directly. That meant a real customer could pay via
 * POST /api/revenue/jobs, the webhook would confirm payment and move the
 * job to 'queued' (lib/revenue/JobWebhookBridge.js), and it would then
 * sit in 'queued' forever with nothing to advance it to 'executing' /
 * 'awaiting_review'.
 *
 * This script is a standalone polling loop, run as its own boot module
 * (see boot.config.json's "job-executor-poller" entry) rather than
 * folded into HYDISystem.js, because JobExecutor.ts/JobManager.ts are
 * ESM TypeScript modules -- the existing convention in this repo
 * (lib/revenue/JobWebhookBridge.js's header comment, and the
 * "heidi:qualify"/"heidi:fail" package.json scripts) is to run this kind
 * of module via `npx tsx`, not via a synchronous require() from a plain
 * Node process.
 *
 * Scope, deliberately narrow:
 *   - Only acts on jobs that are already in 'queued' status, which only
 *     happens after a real Stripe payment has been confirmed by the
 *     webhook (JobWebhookBridge.processJobPaymentConfirmation). This
 *     script never creates jobs, never touches payment, and never
 *     fabricates synthetic/autonomous demand.
 *   - Execution takes a job from 'queued' to 'awaiting_review' at most.
 *     The human approval gate (POST /api/revenue/jobs/:jobId/approve,
 *     JobManager.approveForDelivery()) is untouched -- this script has
 *     no path to 'delivered' and cannot bypass human review.
 *   - On startup, recovers any jobs stuck in 'executing' from a prior
 *     crash/restart (JobExecutor.recoverStaleJobs()), matching the
 *     "Restart recovery" behavior JobExecutor.ts already documents but
 *     that nothing previously called on boot.
 */

import { processNextJob, recoverStaleJobs } from '../lib/revenue/JobExecutor';

const POLL_INTERVAL_MS = Number(process.env.JOB_EXECUTOR_POLL_INTERVAL_MS) || 15000;
const ERROR_BACKOFF_MS = Number(process.env.JOB_EXECUTOR_ERROR_BACKOFF_MS) || 30000;
const ENABLED = process.env.JOB_EXECUTOR_POLLER_ENABLED !== 'false';

let shuttingDown = false;

function log(msg: string) {
  console.log(`[job-executor-poller] ${new Date().toISOString()} ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a single poll iteration: try to pick up and execute the next queued
 * job. Exported for unit testing with a mocked JobExecutor.
 */
export async function runOnce(): Promise<{ workDone: boolean }> {
  const result = await processNextJob();
  if (!result) {
    return { workDone: false };
  }
  if (result.success) {
    log(`job ${result.jobId} executed successfully in ${result.durationMs}ms, ${result.artifacts.length} artifact(s) -> awaiting_review`);
  } else {
    log(`job ${result.jobId} execution FAILED after ${result.durationMs}ms: ${result.error}`);
  }
  return { workDone: true };
}

export interface MainLoopOptions {
  /** Returns true once the loop should exit. Defaults to the shuttingDown flag set by SIGTERM/SIGINT. */
  shouldStop?: () => boolean;
  /** Injectable sleep, so tests can run the loop without real delays. */
  sleepFn?: (ms: number) => Promise<void>;
  /** Injectable poll/backoff intervals, so tests can assert on them without waiting. */
  pollIntervalMs?: number;
  errorBackoffMs?: number;
}

/**
 * The poll loop: recover any jobs stuck 'executing' from a prior crash,
 * then repeatedly call runOnce() until shouldStop() returns true. Exported
 * (with injectable options) for unit testing bounded iteration counts.
 */
export async function mainLoop(options: MainLoopOptions = {}) {
  const shouldStop = options.shouldStop || (() => shuttingDown);
  const sleepFn = options.sleepFn || sleep;
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const errorBackoffMs = options.errorBackoffMs ?? ERROR_BACKOFF_MS;

  log('starting: recovering stale executing jobs from any prior crash/restart...');
  try {
    const recovery = await recoverStaleJobs();
    log(`recovery complete: ${recovery.recovered} recovered, ${recovery.failed} failed`);
  } catch (err) {
    // Non-fatal: log and continue into the poll loop. A DB connectivity
    // problem here will also surface on the next processNextJob() call
    // below, which is handled with its own backoff.
    log(`recoverStaleJobs() threw during startup (continuing anyway): ${err instanceof Error ? err.message : err}`);
  }

  log(`entering poll loop (interval=${pollIntervalMs}ms, error backoff=${errorBackoffMs}ms)`);

  while (!shouldStop()) {
    try {
      const { workDone } = await runOnce();
      // Drain the queue immediately if there was work; only sleep once
      // the queue is empty, so a burst of paid jobs doesn't wait out
      // the full poll interval between each one.
      if (!workDone) {
        await sleepFn(pollIntervalMs);
      }
    } catch (err) {
      // A thrown error here means something below processNextJob()'s own
      // per-job try/catch failed -- most likely a DB/infra problem
      // (executeJob() already catches and records per-job failures via
      // jobManager.failExecution(), so this is not the "job's model
      // generation failed" case). Back off longer than the normal poll
      // interval so a persistent outage doesn't spin/log tightly.
      log(`poll iteration error, backing off ${errorBackoffMs}ms: ${err instanceof Error ? err.stack || err.message : err}`);
      await sleepFn(errorBackoffMs);
    }
  }

  log('shutdown requested, exiting poll loop');
}

function handleShutdown(signal: string) {
  log(`received ${signal}, will exit after current iteration`);
  shuttingDown = true;
}

// Only wire up signals and auto-start the loop when this file is run
// directly (`npx tsx scripts/job-executor-poller.ts`, as boot.config.json
// does). When imported by a test, none of this side-effecting code runs.
if (require.main === module) {
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));

  if (!ENABLED) {
    log('JOB_EXECUTOR_POLLER_ENABLED=false -- exiting without starting the poll loop');
    process.exit(0);
  } else {
    mainLoop().catch((err) => {
      console.error('[job-executor-poller] fatal error in main loop:', err);
      process.exit(1);
    });
  }
}
