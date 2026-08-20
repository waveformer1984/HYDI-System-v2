#!/usr/bin/env node
'use strict';
/**
 * HYDI Revenue Scheduler
 * ----------------------------------------------------------------------------
 * Continuously runs the revenue control loop to autonomously advance the
 * commercial pipeline. This is NOT a parallel orchestration system — it
 * reuses the existing HEIDI watchdog/recovery architecture and operates
 * within the same governed-autonomy model.
 *
 * The scheduler:
 *   1. Runs the RevenueControlLoop on a configurable interval
 *   2. Records every action in revenue_events
 *   3. Respects financial guardrails and compliance controls
 *   4. Is idempotent and restart-safe
 *   5. Logs to logs/revenue-scheduler.log
 *
 * Two modes:
 *   node scripts/revenue-scheduler.js          # long-running, polls every 5 min
 *   node scripts/revenue-scheduler.js --once   # single cycle, then exit
 *
 * Environment:
 *   SUPABASE_URL             (required) — local Supabase URL
 *   SUPABASE_SERVICE_ROLE_KEY (required) — Supabase service role key
 *   REVENUE_INTERVAL_MS      (optional) — poll interval, default 300000 (5 min)
 *   REVENUE_DAILY_OUTBOUND_LIMIT (optional) — max outbound per day, default 50
 *
 * Log file: logs/revenue-scheduler.log (created automatically)
 * ---------------------------------------------------------------------------
 */

require('./babel-register');

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOG_FILE = path.join(ROOT, 'logs', 'revenue-scheduler.log');

// Ensure logs directory exists
const logsDir = path.join(ROOT, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const INTERVAL_MS = parseInt(process.env.REVENUE_INTERVAL_MS || '300000', 10);
const ONCE = process.argv.includes('--once');

// Direct database access is used (not PostgREST) so SUPABASE_KEY is not strictly required.
// However, we keep the check for consistency with the rest of the system.
if (!SUPABASE_KEY) {
  console.error('WARN: SUPABASE_SERVICE_ROLE_KEY not set — direct PG access will be used');
}

// Revenue control loop
const { RevenueControlLoop } = require('../lib/revenue/RevenueControlLoop');

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {
    // ignore log write failures
  }
}

// ---------------------------------------------------------------------------
// Revenue Scheduler
// ---------------------------------------------------------------------------

async function runCycle() {
  log('REVENUE  control loop starting');

  try {
    const loop = new RevenueControlLoop();
    const result = await loop.run();

    log(`REVENUE  metrics: prospects=${result.metrics.totalProspects} qualified=${result.metrics.qualifiedLeads} mrr=${result.metrics.mrr} customers=${result.metrics.customerCount} pipeline=${result.metrics.pipelineValue}`);

    if (result.selectedAction) {
      const action = result.selectedAction;
      log(`REVENUE  selected: ${action.actionType} — ${action.reason}`);
      log(`REVENUE  authorization: ${result.authorizationResult.mode} — ${result.authorizationResult.reason}`);

      if (result.executed) {
        log(`REVENUE  executed: ${result.executionResult}`);
        if (result.verified) {
          log(`REVENUE  verified: ${result.verificationResult}`);
        } else {
          log(`REVENUE  verification FAILED: ${result.verificationResult}`);
        }
      } else if (!result.authorizationResult.authorized) {
        log(`REVENUE  NOT AUTHORIZED — action requires ${result.authorizationResult.mode}`);
      }
    } else {
      log(`REVENUE  no action selected — ${result.selectionReason}`);
    }

    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log(`REVENUE  ERROR: ${msg}`);
    return null;
  }
}

async function main() {
  log(`REVENUE  scheduler starting (interval=${INTERVAL_MS}ms, once=${ONCE})`);
  log(`REVENUE  database: direct PG access (host=${process.env.PG_HOST || '127.0.0.1'}:${process.env.PG_PORT || '54322'})`);

  if (ONCE) {
    await runCycle();
    log('REVENUE  scheduler exiting (--once mode)');
    return;
  }

  // Long-running mode
  await runCycle();

  const interval = setInterval(async () => {
    await runCycle();
  }, INTERVAL_MS);

  // Graceful shutdown
  process.on('SIGINT', () => {
    log('REVENUE  scheduler shutting down (SIGINT)');
    clearInterval(interval);
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    log('REVENUE  scheduler shutting down (SIGTERM)');
    clearInterval(interval);
    process.exit(0);
  });

  log('REVENUE  scheduler running — press Ctrl+C to stop');
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : 'Unknown error';
  log(`REVENUE  FATAL: ${msg}`);
  process.exit(1);
});
