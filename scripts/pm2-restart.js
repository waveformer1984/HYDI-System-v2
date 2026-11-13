#!/usr/bin/env node
'use strict';
/**
 * Restart ONE PM2 app by name. Allowlisted action target — only reachable
 * through the mission approval pipeline (context.allowlist = pm2_restart).
 *
 * Usage: node scripts/pm2-restart.js <pm2-app-name>
 *
 * Safety: the name must look like a PM2 app id/name and the app must exist
 * in `pm2 jlist` before we touch it.
 *
 * `hydi-boot` is special on Windows: `pm2 restart hydi-boot` can leave PM2
 * tracking a dead fork while the live supervisor holds the boot lease. For
 * hydi-boot only this script uses `pm2 delete` + `pm2 start ecosystem.config.js
 * --only hydi-boot`, then polls until the boot-lease pid and PM2's tracked
 * pid agree (up to 60s). Exit non-zero on mismatch.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ECOSYSTEM = path.join(ROOT, 'ecosystem.config.js');
const BOOT_AGENT_APP = 'hydi-boot';
const CONSISTENCY_TIMEOUT_MS = 60000;
const CONSISTENCY_POLL_MS = 2000;

const BOOT_LEASE_PATH = process.env.HYDI_BOOT_LEASE_PATH
  ? path.resolve(process.env.HYDI_BOOT_LEASE_PATH)
  : path.join(ROOT, '.hydi-boot.lock');

function readBootLeasePid() {
  try {
    const lease = JSON.parse(fs.readFileSync(BOOT_LEASE_PATH, 'utf8'));
    return lease && Number.isInteger(lease.pid) ? lease.pid : null;
  } catch { return null; }
}

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

/** @param {unknown[]} apps parsed pm2 jlist */
function readPm2Pid(name, apps) {
  const app = (apps || []).find((p) => p && p.name === name);
  return app && Number.isInteger(app.pid) && app.pid > 0 ? app.pid : null;
}

function parseJlist(stdout) {
  return JSON.parse(stdout);
}

const APP_RE = /^[a-zA-Z0-9:_-]{1,64}$/;

function defaultPm2(args) {
  const cmd = process.platform === 'win32' ? 'pm2.cmd' : 'pm2';
  return spawnSync(cmd, args, { encoding: 'utf8', timeout: 30000, windowsHide: true, cwd: ROOT });
}

/**
 * Poll until consistent, mismatch, or timeout.
 * @param {object} deps
 * @param {() => number|null} deps.readPm2Pid
 * @param {() => number|null} deps.readLeasePid
 * @param {(ms: number) => Promise<void>} deps.sleep
 * @param {number} [timeoutMs]
 */
async function waitForSupervisorConsistency(deps, timeoutMs = CONSISTENCY_TIMEOUT_MS) {
  const { readPm2Pid: readPm2, readLeasePid, sleep } = deps;
  const deadline = Date.now() + timeoutMs;
  let last = checkSupervisorConsistency(readPm2(), readLeasePid());
  while (Date.now() < deadline) {
    if (last.verdict === 'consistent') return { ok: true, last };
    if (last.verdict === 'mismatch') return { ok: false, last };
    await sleep(CONSISTENCY_POLL_MS);
    last = checkSupervisorConsistency(readPm2(), readLeasePid());
  }
  if (last.verdict === 'consistent') return { ok: true, last };
  if (last.verdict === 'mismatch') return { ok: false, last };
  return { ok: false, last, timedOut: true };
}

/**
 * hydi-boot only: delete + start, then consistency poll.
 * @param {object} deps
 * @param {(args: string[]) => {status?: number, error?: Error, stdout?: string, stderr?: string}} deps.pm2Run
 * @param {() => number|null} deps.readLeasePid
 * @param {(ms: number) => Promise<void>} deps.sleep
 */
async function restartHydiBoot(deps) {
  const { pm2Run, readLeasePid, sleep } = deps;
  const del = pm2Run(['delete', BOOT_AGENT_APP]);
  if (del.error || (del.status !== 0 && del.status != null)) {
    return { ok: false, phase: 'delete', detail: (del.stderr || del.error?.message || 'pm2 delete failed').slice(0, 300) };
  }
  const start = pm2Run(['start', ECOSYSTEM, '--only', BOOT_AGENT_APP]);
  if (start.error || start.status !== 0) {
    return { ok: false, phase: 'start', detail: (start.stderr || start.error?.message || 'pm2 start failed').slice(0, 300) };
  }

  const readPm2FromJlist = () => {
    const list = pm2Run(['jlist']);
    if (list.error || list.status !== 0 || !list.stdout) return null;
    try {
      return readPm2Pid(BOOT_AGENT_APP, parseJlist(list.stdout));
    } catch {
      return null;
    }
  };

  const waited = await waitForSupervisorConsistency({
    readPm2Pid: readPm2FromJlist,
    readLeasePid,
    sleep,
  });
  return { ...waited, phase: 'consistency' };
}

function listApps(pm2Run) {
  const list = pm2Run(['jlist']);
  if (list.error || list.status !== 0) {
    throw new Error(`pm2 jlist failed: ${(list.stderr || list.error?.message || 'unknown').slice(0, 300)}`);
  }
  try {
    return parseJlist(list.stdout);
  } catch {
    throw new Error('pm2 jlist returned non-JSON');
  }
}

async function main() {
  const app = process.argv[2];
  if (!app || !APP_RE.test(app)) {
    console.error('usage: node scripts/pm2-restart.js <pm2-app-name>');
    process.exit(2);
  }
  const pm2Run = defaultPm2;
  let apps;
  try {
    apps = listApps(pm2Run);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const names = new Set((apps || []).flatMap((a) => [a.name, String(a.pm_id)]));
  if (!names.has(app)) {
    console.error(`no PM2 app named '${app}'. Known: ${[...names].slice(0, 30).join(', ')}`);
    process.exit(1);
  }

  if (app === BOOT_AGENT_APP) {
    const result = await restartHydiBoot({
      pm2Run,
      readLeasePid: readBootLeasePid,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    });
    if (!result.ok) {
      const label = result.last?.verdict || result.phase;
      console.error(`hydi-boot restart failed (${label}): ${result.detail || result.last?.detail || 'unknown'}`);
      process.exit(1);
    }
    console.log(`restarted ${app} — ${result.last.detail}`);
    process.exit(0);
  }

  const r = pm2Run(['restart', app]);
  if (r.error || r.status !== 0) {
    console.error(`pm2 restart ${app} failed: ${(r.stderr || r.error?.message || 'unknown').slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`restarted ${app}`);
  process.exit(0);
}

module.exports = {
  checkSupervisorConsistency,
  readBootLeasePid,
  readPm2Pid,
  parseJlist,
  waitForSupervisorConsistency,
  restartHydiBoot,
  BOOT_LEASE_PATH,
  BOOT_AGENT_APP,
  ECOSYSTEM,
  CONSISTENCY_TIMEOUT_MS,
  CONSISTENCY_POLL_MS,
};

if (require.main === module) {
  main().catch((e) => {
    console.error(`pm2-restart failed: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
