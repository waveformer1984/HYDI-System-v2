#!/usr/bin/env node
'use strict';
/**
 * HYDI Mission Scheduler -- protoforge.daily_opportunity_scan
 * ----------------------------------------------------------------------------
 * Runs scripts/missions/protoforge-daily-opportunity-scan.js on a daily
 * cadence and verifies the write actually happened, mirroring
 * scripts/system-health-scheduler.js's "prove persistence by reading it
 * back, don't trust the exit code" pattern -- the same false-green class
 * of defect this codebase has spent real effort eliminating elsewhere
 * must not get reintroduced here.
 *
 * Why it spawns rather than requires: the mission script calls
 * process.exit() on completion when run as a CLI (see its own
 * `require.main === module` guard) and performs real outbound network
 * calls; running it as a child keeps this scheduler's own process
 * lifecycle independent of the mission's.
 *
 * Modes:
 *   node scripts/protoforge-opportunity-scheduler.js          # long-running, polls
 *   node scripts/protoforge-opportunity-scheduler.js --once   # single cycle, then exit
 *
 * Environment:
 *   PROTOFORGE_SCOUT_INTERVAL_MS   (optional) poll interval, default 86400000 (24h)
 *   PROTOFORGE_SCOUT_TIMEOUT_MS    (optional) per-run timeout, default 60000
 *   PROTOFORGE_SCOUT_LOCK_PATH     (optional) lock file path -- test seam only,
 *                                   mirrors HYDI_BOOT_LEASE_PATH's role in
 *                                   scripts/boot-instance-lease.js. Production
 *                                   never sets it.
 *   PROTOFORGE_SCOUT_LOG_PATH      (optional) log file path -- test seam only,
 *                                   same reasoning as PROTOFORGE_SCOUT_LOCK_PATH.
 *                                   Production never sets it.
 *
 * Singleton protection: see scripts/mission-run-lock.js. `runCycle()`
 * acquires the lock before spawning the mission child and releases it in a
 * `finally` regardless of outcome, so an overlapping invocation (a manual
 * `--once` run racing the continuous scheduler, or a PM2 restart racing an
 * in-flight cycle whose orphaned child is still running -- see that file's
 * header for why the child can outlive this process) is skipped rather
 * than run concurrently, and a lock left behind by a hard kill is
 * reclaimable by age rather than permanently blocking future cycles.
 *
 * Log file: logs/protoforge-opportunity-scheduler.log
 * ----------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { MissionRunLock } = require('./mission-run-lock');

const ROOT = path.resolve(__dirname, '..');
const MISSION_SCRIPT = path.join(ROOT, 'scripts', 'missions', 'protoforge-daily-opportunity-scan.js');
// PROTOFORGE_SCOUT_LOG_PATH is a test seam, mirroring PROTOFORGE_SCOUT_LOCK_PATH
// below: tests/unit/protoforge-opportunity-scheduler.test.js calls log()
// directly (it's not behind an injectable dep, since it's also used by
// module-level code in main() that runs outside any single runCycle()).
// Before this existed, those test runs appended real-looking but fake
// cycle lines (fabricated timestamps, pid=424242, "SUPABASE_URL...
// required", etc.) straight into the production log file, indistinguishable
// from genuine scheduler activity without reading the PM2-captured log
// (logs/pm2-protoforge-scout.out.log) as the tiebreaker. Production never
// sets this env var, so its own log file is untouched by any test.
const LOG_FILE = process.env.PROTOFORGE_SCOUT_LOG_PATH
  ? path.resolve(process.env.PROTOFORGE_SCOUT_LOG_PATH)
  : path.join(ROOT, 'logs', 'protoforge-opportunity-scheduler.log');
const LOCK_PATH = process.env.PROTOFORGE_SCOUT_LOCK_PATH
  ? path.resolve(process.env.PROTOFORGE_SCOUT_LOCK_PATH)
  : path.join(ROOT, '.protoforge-scout.lock');

const ONCE = process.argv.includes('--once');
const INTERVAL_MS = parseInt(process.env.PROTOFORGE_SCOUT_INTERVAL_MS || '86400000', 10);
const RUN_TIMEOUT_MS = parseInt(process.env.PROTOFORGE_SCOUT_TIMEOUT_MS || '60000', 10);

const lock = new MissionRunLock(LOCK_PATH);
let shuttingDown = false;
let activeChild = null; // the currently-spawned mission child, if any -- so shutdown can stop it rather than orphan it.

const logsDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) { /* logging must never throw */ }
}

function getSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  return createClient(url, key);
}

async function latestRunAt(supabase) {
  const { data, error } = await supabase
    .from('protoforge_mission_runs')
    .select('run_at')
    .order('run_at', { ascending: false })
    .limit(1);
  if (error) return { value: null, error: error.message };
  if (!data || data.length === 0) return { value: null, error: null };
  return { value: data[0].run_at, error: null };
}

/** taskkill /T /F on Windows (kills the whole tree); SIGTERM elsewhere. Mirrors boot-agent.js's own shutdown() -- a plain child.kill() does not reliably stop a Windows child tree. */
function killChildTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32' && child.pid) {
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
    } else {
      child.kill('SIGKILL');
    }
  } catch (_) { /* already gone */ }
}

function runMissionScript() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [MISSION_SCRIPT, '--json'], {
      cwd: ROOT,
      env: process.env,
      windowsHide: true,
    });
    activeChild = child;
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => {
      killChildTree(child);
      resolve({ timedOut: true, code: null, stdout, stderr });
    }, RUN_TIMEOUT_MS);
    child.on('close', (code) => { clearTimeout(timer); activeChild = null; resolve({ timedOut: false, code, stdout, stderr }); });
    child.on('error', (err) => { clearTimeout(timer); activeChild = null; resolve({ timedOut: false, code: null, stdout, stderr: String(err.message) }); });
  });
}

/**
 * Run one cycle. Collaborators injectable for hermetic testing:
 *   deps.runMissionScript, deps.supabase, deps.lock (a MissionRunLock-shaped
 *   object -- {isActive, acquire, release}).
 */
async function runCycle(deps = {}) {
  const runLock = deps.lock || lock;

  const claim = runLock.acquire({ mission: 'protoforge.daily_opportunity_scan' });
  if (!claim.acquired) {
    const holder = claim.holder || {};
    log(`--- Mission cycle SKIPPED: another run is already active (pid=${holder.pid}, started=${holder.startedAt}) ---`);
    return { ok: true, skipped: true, persisted: false, reason: 'overlap', holder };
  }
  if (claim.reclaimedStale) {
    log('  reclaimed a stale lock left behind by a prior run that did not shut down cleanly');
  }

  log('--- Mission cycle starting ---');
  try {
    const runMission = deps.runMissionScript || runMissionScript;
    let supabase = deps.supabase;
    if (!supabase) {
      try { supabase = getSupabase(); } catch (e) {
        log(`  CYCLE FAILED: ${e.message}`);
        return { ok: false, persisted: false, reason: e.message };
      }
    }

    const before = await latestRunAt(supabase);
    const result = await runMission();

    if (result.timedOut) {
      log(`  CYCLE FAILED: mission exceeded ${RUN_TIMEOUT_MS}ms and was killed`);
      return { ok: false, persisted: false, reason: 'timeout' };
    }

    log(`  mission exited ${result.code}`);
    if (result.stderr.trim()) log(`  stderr: ${result.stderr.trim().slice(0, 300)}`);

    const after = await latestRunAt(supabase);
    if (after.error) {
      log(`  NOT_PERSISTED: could not read protoforge_mission_runs back: ${after.error}`);
      return { ok: false, persisted: false, reason: after.error };
    }
    const advanced = after.value !== null && after.value !== before.value;
    if (!advanced) {
      log(`  NOT_PERSISTED: newest run_at did not advance (before=${before.value ?? 'none'}, after=${after.value ?? 'none'}) -- the mission ran but wrote nothing`);
      return { ok: false, persisted: false, reason: 'run_at did not advance' };
    }

    log(`  PERSISTED: protoforge_mission_runs newest run_at ${before.value ?? 'none'} -> ${after.value}`);
    log('--- Mission cycle complete ---');
    return { ok: true, persisted: true, runAt: after.value };
  } finally {
    // Always release, success or failure or thrown exception -- a lock that
    // only gets released on the happy path is a lock that permanently wedges
    // the scheduler the first time a cycle errors.
    runLock.release();
  }
}

async function main() {
  log(`protoforge-opportunity-scheduler starting (mode=${ONCE ? 'once' : 'continuous'}, interval=${INTERVAL_MS}ms, timeout=${RUN_TIMEOUT_MS}ms)`);
  const first = await runCycle();
  if (ONCE) {
    log('Single cycle complete. Exiting.');
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
    if (activeChild) {
      log(`${signal} received mid-cycle -- stopping the active mission child (pid=${activeChild.pid}) rather than orphaning it`);
      killChildTree(activeChild);
    }
    lock.release();
    log(`${signal} received -- shutting down gracefully`);
    process.exit(0);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

module.exports = { runCycle, latestRunAt, lock, LOCK_PATH, killChildTree };

if (require.main === module) {
  main().catch((e) => { log(`FATAL: ${e.message}`); process.exit(1); });
}
