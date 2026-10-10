#!/usr/bin/env node
/**
 * PM2 Restart Helper for Windows
 *
 * Works around two PM2-on-Windows defects:
 *
 * 1. `pm2 restart <name>` / `pm2 start <name>` fail with "Process N not
 *    found" after a stop — PM2's internal restartProcessId() looks the
 *    process up by PM2 ID, and the ID→pid mapping goes stale.
 *
 * 2. `pm2 restart hydi-boot` has a worse failure mode: it SUCCEEDS while
 *    corrupting bookkeeping. Observed 2026-09-18 (3/3 restarts): PM2 spawns
 *    the replacement fork while the outgoing fork's shutdown is still in
 *    flight, then attributes the outgoing fork's late exit to the new
 *    instance and autorestarts a SECOND fork. HYDI's boot-lease arbitration
 *    correctly stands one fork down (exit 75 → stop_exit_codes), but PM2's
 *    process table then tracks the dead fork: `hydi-boot` reports
 *    "waiting restart" with pid 0 while a live, PM2-spawned but untracked
 *    fork supervises all services. The lease guarantees exactly-one-
 *    supervisor; PM2's record of WHICH fork that is becomes wrong.
 *
 *    HYDI cannot repair PM2's fork attribution. What it CAN do is not
 *    create the second fork in the first place: `pm2 delete` + `pm2 start`
 *    gives PM2 exactly one tracked fork with no outgoing sibling to race.
 *    For hydi-boot this script therefore skips `pm2 restart` entirely.
 *    Simpler single-process apps do not hit the lease race, so they keep
 *    the restart-then-fallback path.
 *
 * After a hydi-boot start, the script verifies bookkeeping consistency:
 * the boot-lease pid (.hydi-boot.lock) and PM2's tracked pid must agree.
 * A mismatch is reported as MISMATCH (not silently ignored) — the safe
 * recovery is to run this script again.
 *
 * Usage:
 *   node scripts/pm2-restart.js [name]     # restart one app (default: hydi-boot)
 *   node scripts/pm2-restart.js all        # restart all apps
 *   node scripts/pm2-restart.js --prod     # restart in production mode
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ECOSYSTEM = path.join(ROOT, 'ecosystem.config.js');
const BOOT_LEASE_PATH = process.env.HYDI_BOOT_LEASE_PATH
  ? path.resolve(process.env.HYDI_BOOT_LEASE_PATH)
  : path.join(ROOT, '.hydi-boot.lock');
const target = process.argv[2] || 'hydi-boot';
const prodFlag = process.argv.includes('--prod') ? ' --env production' : '';

// hydi-boot carries the lease/supervision semantics that make `pm2 restart`
// non-deterministic on Windows (see header). Everything else restarts fine.
const BOOT_AGENT_APP = 'hydi-boot';

function run(cmd) {
  console.log(`> ${cmd}`);
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
  } catch (e) {
    // PM2 commands may return non-zero exit codes even on success
  }
}

/** PID recorded in the HYDI boot lease, or null. */
function readBootLeasePid() {
  try {
    const lease = JSON.parse(fs.readFileSync(BOOT_LEASE_PATH, 'utf8'));
    return lease && Number.isInteger(lease.pid) ? lease.pid : null;
  } catch { return null; }
}

/** PID PM2 currently tracks for `name`, or null. */
function readPm2Pid(name) {
  try {
    const out = execSync('pm2 jlist', { cwd: ROOT, encoding: 'utf8', timeout: 15000 });
    const app = JSON.parse(out).find((p) => p.name === name);
    return app && Number.isInteger(app.pid) && app.pid > 0 ? app.pid : null;
  } catch { return null; }
}

/**
 * Compare the two views of who the boot authority is.
 * consistent  — PM2 record and lease name the same live pid;
 * mismatch    — they disagree (PM2 is tracking a dead/different fork);
 * incomplete  — one side has no answer yet (boot still starting).
 */
function checkSupervisorConsistency(pm2Pid, leasePid) {
  if (pm2Pid == null || leasePid == null) {
    return { verdict: 'incomplete', pm2Pid, leasePid, detail: 'one side has not reported a pid yet' };
  }
  if (pm2Pid === leasePid) {
    return { verdict: 'consistent', pm2Pid, leasePid, detail: 'PM2 record and boot lease agree' };
  }
  return {
    verdict: 'mismatch', pm2Pid, leasePid,
    detail: `PM2 tracks pid ${pm2Pid} but the boot lease names pid ${leasePid} — PM2 bookkeeping lost the surviving fork`,
  };
}

async function verifyHydiBootConsistency(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let last = checkSupervisorConsistency(readPm2Pid(BOOT_AGENT_APP), readBootLeasePid());
  while (last.verdict === 'incomplete' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    last = checkSupervisorConsistency(readPm2Pid(BOOT_AGENT_APP), readBootLeasePid());
  }
  console.log(`supervisor consistency: ${last.verdict.toUpperCase()} — ${last.detail}`);
  return last;
}

async function main() {
  if (target === 'all') {
    // Restart all HYDI apps
    console.log('Restarting all HYDI PM2 processes...');
    run('pm2 delete all');
    run(`pm2 start ecosystem.config.js${prodFlag}`);
    await verifyHydiBootConsistency();
  } else if (target === BOOT_AGENT_APP) {
    // Deterministic path for the lease-bearing supervisor — never `pm2
    // restart`, which provably produces the double-fork bookkeeping race.
    console.log(`Restarting ${target} via delete + start (pm2 restart is unsafe for ${target} on Windows — see header)`);
    run(`pm2 delete ${target}`);
    run(`pm2 start ${ECOSYSTEM} --only ${target}${prodFlag}`);
    await verifyHydiBootConsistency();
  } else {
    // Restart a single non-supervisor app
    console.log(`Restarting ${target}...`);
    try {
      execSync(`pm2 restart ${target}`, { cwd: ROOT, stdio: 'pipe' });
      console.log(`pm2 restart ${target} succeeded`);
      return;
    } catch (e) {
      console.log(`pm2 restart ${target} failed (${e.message.split('\n')[0]}), falling back to delete + start...`);
    }
    run(`pm2 delete ${target}`);
    run(`pm2 start ${ECOSYSTEM} --only ${target}${prodFlag}`);
  }

  console.log('Done. Use `pm2 logs` to check status.');
}

module.exports = { checkSupervisorConsistency, readBootLeasePid, readPm2Pid, BOOT_LEASE_PATH };

if (require.main === module) {
  main().catch((e) => {
    console.error(`pm2-restart failed: ${e.message}`);
    process.exit(1);
  });
}
