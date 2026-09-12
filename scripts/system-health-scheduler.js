#!/usr/bin/env node
'use strict';
/**
 * HYDI System Health Scheduler
 * ----------------------------------------------------------------------------
 * Gives `system_health_runs` a producer.
 *
 * Why this exists
 * ---------------
 * `/api/health` reports status:"degraded" with hydi_status:null. That is not a
 * fault being detected — it is the absence of any measurement:
 *
 *   api/health.js:49   isHealthy = dashboard.current_status === 'OK' && ...
 *   system_dashboard   current_status = ( SELECT status FROM system_health_runs
 *                                          ORDER BY run_at DESC LIMIT 1 )
 *   system_health_runs 0 rows  ->  scalar subquery yields NULL  ->  "degraded"
 *
 * The only writer is true-system-health.js, whose own header calls itself a
 * CLI ("Usage: node true-system-health.js [--json]"). Nothing scheduled it:
 * zero references in boot.config.json, ecosystem.config.js and package.json,
 * and the three active pg_cron jobs (billing retry, protoforge calibration,
 * action worker) write other tables. So the dashboard has been a consumer with
 * no producer.
 *
 * Why it spawns rather than imports
 * ---------------------------------
 * true-system-health.js executes on require (no require.main guard) and calls
 * process.exit() with 1 on CRITICAL. Requiring it would take this scheduler
 * down every time the system was unhealthy — the supervisor would treat a
 * correct health verdict as a crash. It runs as a child instead, so a CRITICAL
 * verdict is data, not a scheduler failure.
 *
 * Why it verifies the write
 * -------------------------
 * true-system-health.js persists on a best-effort path that swallows failures:
 *
 *     } catch (persistErr) {
 *       // Silently fail persistence - don't break health check
 *
 * A scheduler that merely ran it and logged "ok" would therefore report success
 * while writing nothing — the exact false-green shape this codebase has been
 * removing. Every cycle here reads system_health_runs back and only reports
 * PERSISTED when the newest run_at actually advanced. If it did not, the cycle
 * is reported as NOT_PERSISTED with the reason.
 *
 * Modes:
 *   node scripts/system-health-scheduler.js          # long-running, polls
 *   node scripts/system-health-scheduler.js --once   # single cycle, then exit
 *
 * Environment:
 *   SUPABASE_URL                 (required)
 *   SUPABASE_SERVICE_ROLE_KEY    (required)
 *   SYSTEM_HEALTH_INTERVAL_MS    (optional) poll interval, default 300000 (5 min)
 *   SYSTEM_HEALTH_TIMEOUT_MS     (optional) per-run timeout, default 120000
 *
 * Log file: logs/system-health-scheduler.log
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const HEALTH_SCRIPT = path.join(ROOT, 'true-system-health.js');
const LOG_FILE = path.join(ROOT, 'logs', 'system-health-scheduler.log');

const ONCE = process.argv.includes('--once');
const INTERVAL_MS = parseInt(process.env.SYSTEM_HEALTH_INTERVAL_MS || '300000', 10);
const RUN_TIMEOUT_MS = parseInt(process.env.SYSTEM_HEALTH_TIMEOUT_MS || '120000', 10);

let shuttingDown = false;

const logsDir = path.join(ROOT, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) { /* logging must never throw */ }
}

/** Lazily created so --help/--once misuse doesn't require credentials up front. */
function getSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  return createClient(url, key);
}

/**
 * Newest run_at in system_health_runs, or null when the table is empty or
 * unreadable. Used as the before/after evidence for a cycle.
 */
async function latestRunAt(supabase) {
  const { data, error } = await supabase
    .from('system_health_runs')
    .select('run_at')
    .order('run_at', { ascending: false })
    .limit(1);
  if (error) return { value: null, error: error.message };
  if (!data || data.length === 0) return { value: null, error: null };
  return { value: data[0].run_at, error: null };
}

/** Run true-system-health.js as a child. Its exit code is a verdict, not a failure. */
function runHealthScript() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HEALTH_SCRIPT, '--json'], {
      cwd: ROOT,
      env: process.env,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    const timer = setTimeout(() => {
      child.kill();
      resolve({ timedOut: true, code: null, stdout, stderr });
    }, RUN_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ timedOut: false, code, stdout, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ timedOut: false, code: null, stdout, stderr: String(err.message) });
    });
  });
}

/**
 * Pull the reported status out of --json output, tolerating leading log noise.
 *
 * `--json` does not suppress the human-readable output, and dotenv prints tips
 * containing braces (`◇ injected env (7) from .env // tip: ... { override: true }`).
 * Taking the FIRST '{' therefore lands on a tip rather than the payload and
 * always fails to parse. The report itself is written with
 * JSON.stringify(health, null, 2), so its opening brace is alone at the start of
 * a line — anchor on that, scanning from the end so trailing output cannot shift
 * the result either.
 *
 * This only affects the logged status label. The PERSISTED/NOT_PERSISTED verdict
 * comes from reading system_health_runs back, never from this parse.
 */
function parseStatus(stdout) {
  if (typeof stdout !== 'string' || stdout.length === 0) return null;

  const candidates = [];
  const re = /^\{/gm;
  let m;
  while ((m = re.exec(stdout)) !== null) candidates.push(m.index);
  // Fall back to the first brace anywhere, for output shapes without a
  // line-anchored object.
  if (candidates.length === 0) {
    const first = stdout.indexOf('{');
    if (first === -1) return null;
    candidates.push(first);
  }

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(stdout.slice(candidates[i]));
      if (parsed && typeof parsed.status === 'string') return parsed.status;
    } catch (_) { /* try the next candidate */ }
  }
  return null;
}

/**
 * Run one cycle.
 *
 * Collaborators are injectable so the persistence guard — the part that stops
 * this from being a false green — can be tested without a database or a child
 * process. Production passes nothing and gets the real ones.
 */
async function runCycle(deps = {}) {
  log('--- Health cycle starting ---');

  const runHealth = deps.runHealthScript || runHealthScript;
  let supabase = deps.supabase;
  if (!supabase) {
    try {
      supabase = getSupabase();
    } catch (e) {
      log(`  CYCLE FAILED: ${e.message}`);
      return { ok: false, persisted: false, reason: e.message };
    }
  }

  const before = await latestRunAt(supabase);
  if (before.error) {
    log(`  WARN: could not read system_health_runs before the run: ${before.error}`);
  }

  const result = await runHealth();

  if (result.timedOut) {
    log(`  CYCLE FAILED: health check exceeded ${RUN_TIMEOUT_MS}ms and was killed`);
    return { ok: false, persisted: false, reason: 'timeout' };
  }

  const status = parseStatus(result.stdout);
  // Exit 1 means CRITICAL, which is a health verdict we want recorded — not a
  // reason to treat the cycle as failed.
  log(`  health check exited ${result.code}, reported status=${status ?? 'unparsed'}`);
  if (result.stderr.trim()) log(`  stderr: ${result.stderr.trim().slice(0, 300)}`);

  // The decisive check: did a row actually land? true-system-health.js swallows
  // persistence errors, so its exit code alone proves nothing about the write.
  const after = await latestRunAt(supabase);
  if (after.error) {
    log(`  NOT_PERSISTED: could not read system_health_runs back: ${after.error}`);
    return { ok: false, persisted: false, status, reason: after.error };
  }

  const advanced = after.value !== null && after.value !== before.value;
  if (!advanced) {
    log(`  NOT_PERSISTED: newest run_at did not advance (before=${before.value ?? 'none'}, after=${after.value ?? 'none'}) ` +
        '— the health check ran but wrote nothing, so system_dashboard.current_status stays NULL');
    return { ok: false, persisted: false, status, reason: 'run_at did not advance' };
  }

  log(`  PERSISTED: system_health_runs newest run_at ${before.value ?? 'none'} -> ${after.value}`);

  // Escalation is recorded HERE, explicitly, after the measurement it is based
  // on has landed.
  //
  // It used to happen inside evaluate_system_escalation(), which system_dashboard
  // calls -- so a plain `SELECT * FROM system_dashboard` performed a write. That
  // made the dashboard unreadable through PostgREST (GET runs in a read-only
  // transaction) and meant every reader of /api/health generated escalation
  // rows. Escalation persistence belongs to a scheduled writer, not a reader.
  const escalation = await recordEscalation(supabase);

  log('--- Health cycle complete ---');
  return { ok: true, persisted: true, status, runAt: after.value, escalation };
}

/**
 * Call the explicit escalation write path.
 *
 * Never fails the cycle: the health measurement is already durable at this
 * point, and failing to record an escalation must not be reported as failing to
 * measure health. It is logged either way so a silent failure is impossible.
 */
async function recordEscalation(supabase) {
  try {
    const { data, error } = await supabase.rpc('record_system_escalation');
    if (error) {
      log(`  ESCALATION NOT RECORDED: ${error.message}`);
      return { recorded: false, error: error.message };
    }
    if (data && data.recorded) {
      log(`  ESCALATION RECORDED: level=${data.level} action=${data.action} reason="${data.reason}"`);
    } else {
      log(`  escalation not required (level=${data?.level ?? 'unknown'}, action=${data?.action ?? 'none'})`);
    }
    return data || { recorded: false };
  } catch (e) {
    log(`  ESCALATION NOT RECORDED: ${e.message}`);
    return { recorded: false, error: e.message };
  }
}

async function main() {
  log(`system-health-scheduler starting (mode=${ONCE ? 'once' : 'continuous'}, interval=${INTERVAL_MS}ms, timeout=${RUN_TIMEOUT_MS}ms)`);

  const first = await runCycle();

  if (ONCE) {
    log('Single cycle complete. Exiting.');
    // Exit non-zero only when the cycle itself failed. A CRITICAL health verdict
    // that was successfully recorded is a successful cycle.
    process.exit(first.persisted ? 0 : 1);
  }

  log(`Next cycle in ${Math.round(INTERVAL_MS / 1000)}s`);
  const interval = setInterval(async () => {
    if (shuttingDown) return;
    await runCycle();
    if (!shuttingDown) log(`Next cycle in ${Math.round(INTERVAL_MS / 1000)}s`);
  }, INTERVAL_MS);

  const stop = (signal) => {
    shuttingDown = true;
    clearInterval(interval);
    log(`${signal} received — shutting down gracefully`);
    process.exit(0);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('message', (msg) => { if (msg === 'shutdown') stop('shutdown'); });
}

module.exports = { runCycle, parseStatus, latestRunAt, recordEscalation };

if (require.main === module) {
  main().catch((e) => {
    log(`FATAL: ${e.message}`);
    process.exit(1);
  });
}
