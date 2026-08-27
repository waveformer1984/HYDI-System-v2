#!/usr/bin/env node
'use strict';
/**
 * HYDI Stuck Job Scheduler
 * ----------------------------------------------------------------------------
 * Continuously runs the StuckJobDetector on a configurable interval to
 * autonomously detect and recover stuck jobs. This is the first real
 * autonomous operations goal — it runs on a real recurring trigger,
 * not a one-off script someone remembers to run.
 *
 * The scheduler:
 *   1. Runs the StuckJobDetector on every interval (default: hourly)
 *   2. Logs every detection cycle to logs/stuck-job-scheduler.log
 *   3. Records findings in the operator_escalations table (via EscalationNotifier)
 *   4. Is idempotent and restart-safe
 *
 * Two modes:
 *   node scripts/stuck-job-scheduler.js          # long-running, polls every hour
 *   node scripts/stuck-job-scheduler.js --once   # single cycle, then exit
 *
 * Environment:
 *   SUPABASE_URL                (required) — Supabase URL
 *   SUPABASE_SERVICE_ROLE_KEY   (required) — Supabase service role key
 *   STUCK_JOB_INTERVAL_MS       (optional) — poll interval, default 3600000 (1 hour)
 *   STUCK_JOB_EXECUTING_HOURS   (optional) — threshold for executing, default 4
 *   STUCK_JOB_REVIEW_HOURS      (optional) — threshold for awaiting_review, default 48
 *   STUCK_JOB_OBSERVE_ONLY      (optional) — if "true", don't retry or escalate
 *
 * Log file: logs/stuck-job-scheduler.log (created automatically)
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOG_FILE = path.join(ROOT, 'logs', 'stuck-job-scheduler.log');

// Ensure logs directory exists
const logsDir = path.join(ROOT, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n', { encoding: 'utf8' });
  } catch {
    // Log file write failure must not crash the scheduler
  }
}

async function main() {
  const { createClient } = require('@supabase/supabase-js');

  const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const INTERVAL_MS = parseInt(process.env.STUCK_JOB_INTERVAL_MS || '3600000', 10); // 1 hour
  const EXECUTING_HOURS = parseFloat(process.env.STUCK_JOB_EXECUTING_HOURS || '4');
  const REVIEW_HOURS = parseFloat(process.env.STUCK_JOB_REVIEW_HOURS || '48');
  const OBSERVE_ONLY = process.env.STUCK_JOB_OBSERVE_ONLY === 'true';
  const ONCE = process.argv.includes('--once');

  if (!SUPABASE_KEY) {
    log('ERROR: SUPABASE_SERVICE_ROLE_KEY is required');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Load the StuckJobDetector (TypeScript, needs babel-register)
  let StuckJobDetector;
  try {
    // Try loading from compiled output first (production build)
    StuckJobDetector = require('../lib/operational/StuckJobDetector').StuckJobDetector;
  } catch {
    try {
      // Fall back to babel-register (same pattern as other CLI scripts)
      require('./babel-register');
      StuckJobDetector = require('../lib/operational/StuckJobDetector').StuckJobDetector;
    } catch (e) {
      log(`ERROR: Could not load StuckJobDetector: ${e.message}`);
      process.exit(1);
    }
  }

  const config = {
    executingThresholdHours: EXECUTING_HOURS,
    awaitingReviewThresholdHours: REVIEW_HOURS,
    enableRetry: !OBSERVE_ONLY,
    enableEscalation: !OBSERVE_ONLY,
  };

  const detector = new StuckJobDetector(supabase, config);

  log(`Stuck Job Scheduler starting`);
  log(`  Interval: ${INTERVAL_MS}ms (${INTERVAL_MS / 60000} min)`);
  log(`  Executing threshold: ${EXECUTING_HOURS}h`);
  log(`  Awaiting review threshold: ${REVIEW_HOURS}h`);
  log(`  Observe only: ${OBSERVE_ONLY}`);
  log(`  Mode: ${ONCE ? 'single cycle' : 'continuous'}`);

  let shuttingDown = false;

  async function runCycle() {
    if (shuttingDown) return;
    log('--- Detection cycle starting ---');
    try {
      const result = await detector.detectAndRecover();
      log(`  Checked: ${result.checkedJobs}`);
      log(`  Stuck found: ${result.stuckJobsFound}`);
      log(`  Retries attempted: ${result.retriesAttempted}`);
      log(`  Escalations sent: ${result.escalationsSent}`);
      if (result.error) log(`  ERROR: ${result.error}`);
      for (const finding of result.findings) {
        log(`  Job ${finding.jobId}: status=${finding.jobStatus} stuck=${finding.stuckDurationHours}h action=${finding.actionTaken} result=${finding.actionResult}`);
      }
      log('--- Detection cycle complete ---');
      return result;
    } catch (e) {
      log(`  FATAL: Detection cycle threw: ${e.message}`);
      log('--- Detection cycle failed ---');
      return null;
    }
  }

  // Run immediately on start
  await runCycle();

  if (ONCE) {
    log('Single cycle complete. Exiting.');
    process.exit(0);
  }

  // Schedule recurring runs
  log(`Next cycle scheduled in ${INTERVAL_MS / 60000} minutes`);

  const interval = setInterval(async () => {
    if (shuttingDown) return;
    await runCycle();
    if (!shuttingDown) {
      log(`Next cycle scheduled in ${INTERVAL_MS / 60000} minutes`);
    }
  }, INTERVAL_MS);

  // Graceful shutdown
  process.on('SIGINT', () => {
    log('SIGINT received — shutting down gracefully');
    shuttingDown = true;
    clearInterval(interval);
    setTimeout(() => process.exit(0), 1000);
  });

  process.on('SIGTERM', () => {
    log('SIGTERM received — shutting down gracefully');
    shuttingDown = true;
    clearInterval(interval);
    setTimeout(() => process.exit(0), 1000);
  });

  log('Scheduler is running. Press Ctrl+C to stop.');
}

main().catch(e => {
  log(`Fatal error: ${e.message}`);
  process.exit(1);
});
