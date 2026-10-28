#!/usr/bin/env node
'use strict';

/**
 * Frank storage guard: the always-on half of docs/STORAGE_PROGRAM.md.
 *
 * Every 15 minutes it:
 *   1. measures free space on the repo's volume and records it
 *      (.runtime/storage/history.jsonl, 30 days kept);
 *   2. removes only what this system itself regenerates, in tiers that get
 *      wider as space gets tighter (see CLEANUP below);
 *   3. writes .runtime/storage/status.json (level, trend, days left,
 *      what it cleaned) for the health surfaces and Heidi;
 *   4. posts to Forge Board #alerts once per level change, and a weekly
 *      storage report to #ops.
 *
 * It never touches user files, Docker volumes or images in use, the Recycle
 * Bin, or the Docker disk image itself. Compacting that disk needs Docker
 * stopped and an admin shell, so it stays a human step in the monthly
 * checklist. HYDI_STORAGE_AUTOCLEAN=off turns cleanup off; measuring,
 * status and alerts keep running.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const disk = require('../lib/storage/disk');

const APP_NAME = 'frank-storage-guard';
const INTERVAL_MS = 15 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const HISTORY_KEEP_MS = 30 * DAY;
const REPORT_EVERY_MS = 7 * DAY;
const ORPHAN_WORKTREE_AGE_MS = 6 * HOUR;
const CI_LOG_AGE_MS = 14 * DAY;
const DEPLOY_LOCK_FRESH_MS = 45 * 60 * 1000;
// local-ci's throwaway worktrees: mkdtemp(`hydi-ci-<7-char sha>-`) + 6 chars.
const CI_WORKTREE_RE = /^hydi-ci-[0-9a-f]{7}-[A-Za-z0-9]{6}$/;
const CI_LOG_DIR_RE = /^[0-9a-f]{7}$/;
// Stale %TEMP%: anything at the top of the temp folder untouched for 2 days.
// On 2026-10-27 8.6 GB of old temp files took C: to 0.6 GB free while every
// tier above had nothing left to clear.
const STALE_TEMP_AGE_MS = 2 * DAY;
// Left alone: local-ci's own entries (their tiers handle them) and virtual
// disks (WSL's swap file lives in %TEMP% and is in use while Docker runs).
const TEMP_KEEP_RE = /^hydi-ci-|^hydi-local-ci$|\.vhdx?$/i;
// A folder with more entries than this is treated as in use and skipped
// rather than walked every pass.
const TEMP_SCAN_LIMIT = 20000;

function commandFor(name, platform) {
  return platform === 'win32' && (name === 'npm' || name === 'pm2') ? `${name}.cmd` : name;
}

function execResult(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(file, args, {
      cwd: options.cwd,
      timeout: options.timeout || 10 * 60 * 1000,
      windowsHide: true,
      shell: /\.cmd$/i.test(file),
      maxBuffer: 4 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

/** Directory entries in `dir` that match `re`, are real directories (not links) and are older than `ageMs`. */
function staleDirs(dir, re, ageMs, now) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!re.test(name)) continue;
    const full = path.join(dir, name);
    let st;
    try { st = fs.lstatSync(full); } catch { continue; }
    if (!st.isDirectory() || st.isSymbolicLink()) continue;
    if (now - st.mtimeMs < ageMs) continue;
    out.push(full);
  }
  return out;
}

/**
 * Newest mtime anywhere under `full` (links are not followed), or Infinity
 * when the walk is cut short, so an oversized or unreadable folder counts as
 * fresh and is kept.
 */
function newestMtime(full, limit = TEMP_SCAN_LIMIT) {
  let newest = 0;
  let seen = 0;
  const stack = [full];
  while (stack.length) {
    const cur = stack.pop();
    let st;
    try { st = fs.lstatSync(cur); } catch { return Infinity; }
    seen += 1;
    if (seen > limit) return Infinity;
    newest = Math.max(newest, st.mtimeMs);
    if (st.isSymbolicLink() || !st.isDirectory()) continue;
    let names;
    try { names = fs.readdirSync(cur); } catch { return Infinity; }
    for (const name of names) stack.push(path.join(cur, name));
  }
  return newest;
}

/** Top-level entries of the temp folder whose newest content is older than `ageMs`. */
function staleTempEntries(dir, ageMs, now) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (TEMP_KEEP_RE.test(name)) continue;
    const full = path.join(dir, name);
    let st;
    try { st = fs.lstatSync(full); } catch { continue; }
    if (st.isSymbolicLink()) continue; // never follow or remove links/junctions
    const newest = st.isDirectory() ? newestMtime(full) : st.mtimeMs;
    if (now - newest >= ageMs) out.push(full);
  }
  return out;
}

function removeDirs(dirs) {
  const removed = [];
  const errors = [];
  for (const dir of dirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 2 });
      removed.push(dir);
    } catch (error) {
      errors.push(`${path.basename(dir)}: ${error instanceof Error ? error.message : 'remove failed'}`);
    }
  }
  return { removed, errors };
}

function deployInProgress(root, now) {
  try {
    const st = fs.statSync(path.join(root, '.runtime', 'frank-auto-deploy.lock'));
    return now - st.mtimeMs < DEPLOY_LOCK_FRESH_MS;
  } catch {
    return false;
  }
}

/**
 * Cleanup tiers. Each entry: the minimum level that runs it, and what it
 * removes. Everything here is regenerated by the system on demand.
 */
const CLEANUP = Object.freeze([
  { id: 'ci-orphan-worktrees', minLevel: 'OK', what: 'local-ci worktrees left behind by a crashed run (>6h old)' },
  { id: 'ci-old-logs', minLevel: 'OK', what: 'local-ci logs older than 14 days' },
  { id: 'git-worktree-prune', minLevel: 'OK', what: 'git records of worktrees that no longer exist' },
  { id: 'stale-temp', minLevel: 'WATCH', what: '%TEMP% entries untouched for 2+ days (Windows only; links and virtual disks skipped)' },
  { id: 'npm-cache', minLevel: 'LOW', what: 'npm download cache (refilled by the next install)' },
  { id: 'next-build-cache', minLevel: 'LOW', what: '.next/cache (rebuilt by the next build; skipped during a deploy)' },
  { id: 'docker-build-cache', minLevel: 'LOW', what: 'Docker build cache (not images, containers or volumes)' },
  { id: 'docker-dangling-images', minLevel: 'CRITICAL', what: 'untagged Docker images no container uses' },
  { id: 'pm2-logs', minLevel: 'CRITICAL', what: 'PM2 log contents (pm2 flush)' },
]);

async function runCleanup({ level, root, tmpdir, run, platform, now }) {
  const sev = disk.severity(level);
  const due = CLEANUP.filter((step) => sev >= disk.severity(step.minLevel));
  const actions = [];
  for (const step of due) {
    const action = { id: step.id, ok: true, detail: '' };
    try {
      if (step.id === 'ci-orphan-worktrees') {
        const r = removeDirs(staleDirs(tmpdir, CI_WORKTREE_RE, ORPHAN_WORKTREE_AGE_MS, now));
        action.detail = `${r.removed.length} removed`;
        if (r.errors.length) { action.ok = false; action.detail += `; ${r.errors.join('; ')}`; }
      } else if (step.id === 'ci-old-logs') {
        const r = removeDirs(staleDirs(path.join(tmpdir, 'hydi-local-ci'), CI_LOG_DIR_RE, CI_LOG_AGE_MS, now));
        action.detail = `${r.removed.length} removed`;
        if (r.errors.length) { action.ok = false; action.detail += `; ${r.errors.join('; ')}`; }
      } else if (step.id === 'stale-temp') {
        if (platform !== 'win32') {
          action.detail = 'skipped: Windows only';
        } else {
          const r = removeDirs(staleTempEntries(tmpdir, STALE_TEMP_AGE_MS, now));
          // Files another program holds open refuse to go; that is expected.
          action.detail = `${r.removed.length} removed${r.errors.length ? `, ${r.errors.length} in use` : ''}`;
        }
      } else if (step.id === 'git-worktree-prune') {
        const r = await run('git', ['worktree', 'prune'], { cwd: root });
        action.ok = r.code === 0;
      } else if (step.id === 'npm-cache') {
        const r = await run(commandFor('npm', platform), ['cache', 'clean', '--force'], { cwd: root });
        action.ok = r.code === 0;
      } else if (step.id === 'next-build-cache') {
        if (deployInProgress(root, now)) {
          action.detail = 'skipped: deploy in progress';
        } else {
          const r = removeDirs([path.join(root, '.next', 'cache')].filter((d) => fs.existsSync(d)));
          action.detail = r.removed.length ? 'removed' : 'absent';
          if (r.errors.length) { action.ok = false; action.detail = r.errors.join('; '); }
        }
      } else if (step.id === 'docker-build-cache') {
        const r = await run('docker', ['builder', 'prune', '--force'], { cwd: root });
        action.ok = r.code === 0;
        if (!action.ok) action.detail = 'docker unavailable or refused';
      } else if (step.id === 'docker-dangling-images') {
        const r = await run('docker', ['image', 'prune', '--force'], { cwd: root });
        action.ok = r.code === 0;
        if (!action.ok) action.detail = 'docker unavailable or refused';
      } else if (step.id === 'pm2-logs') {
        const r = await run(commandFor('pm2', platform), ['flush'], { cwd: root });
        action.ok = r.code === 0;
      }
    } catch (error) {
      action.ok = false;
      action.detail = error instanceof Error ? error.message : 'failed';
    }
    actions.push(action);
  }
  return actions;
}

function readHistory(file) {
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  return raw.split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter((p) => p && typeof p.at === 'number' && typeof p.freeBytes === 'number');
}

function writeHistory(file, points) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, points.map((p) => JSON.stringify(p)).join('\n') + (points.length ? '\n' : ''));
  fs.renameSync(tmp, file);
}

/**
 * Net change in free space per day over the last 24h, from points measured
 * before cleanup (so the guard's own cleanup doesn't hide the burn rate).
 * Negative means the disk is filling. null without at least 1h of data.
 */
function trendGbPerDay(points, now) {
  const recent = points.filter((p) => now - p.at <= DAY).sort((a, b) => a.at - b.at);
  if (recent.length < 2) return null;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const span = last.at - first.at;
  if (span < HOUR) return null;
  // Space the guard itself freed between the two points isn't the disk
  // getting better; take it out so the trend shows the real burn rate.
  const freedBetween = recent.filter((p) => p.at < last.at).reduce((sum, p) => sum + (p.freedBytes || 0), 0);
  const net = last.freeBytes - first.freeBytes - freedBetween;
  return Math.round(((net / disk.GIB) / (span / DAY)) * 10) / 10;
}

function daysUntilCritical(freeBytes, trend, env) {
  if (trend === null || trend >= 0 || typeof freeBytes !== 'number') return null;
  const margin = freeBytes / disk.GIB - disk.thresholds(env).criticalGb;
  if (margin <= 0) return 0;
  return Math.round((margin / -trend) * 10) / 10;
}

function dockerDiskGb(env, platform) {
  const base = platform === 'win32' ? env.LOCALAPPDATA : null;
  if (!base) return null;
  try {
    return disk.gb(fs.statSync(path.join(base, 'Docker', 'wsl', 'disk', 'docker_data.vhdx')).size);
  } catch {
    return null;
  }
}

function postSucceeded(result) {
  return Boolean(result && result.ok !== false && !result.skipped);
}

const HUMAN_STEPS = 'Human steps: docs/STORAGE_PROGRAM.md → "When the guard alerts".';

function gates(status) {
  const f = status.gateFloors;
  if (!f || status.freeGb === null) return '';
  const paused = [];
  if (status.freeGb < f.deployGb) paused.push(`auto-deploy (needs ${f.deployGb} GB)`);
  if (status.freeGb < f.localCiGb) paused.push(`local CI (needs ${f.localCiGb} GB)`);
  return paused.length ? ` Paused: ${paused.join(', ')}.` : '';
}

function alertText(status) {
  const free = status.freeGb === null ? 'unreadable' : `${status.freeGb} GB free`;
  const trend = status.trendGbPerDay === null ? '' : ` Trend ${status.trendGbPerDay} GB/day.`;
  const freed = status.freedGb > 0 ? ` Guard freed ${status.freedGb} GB this pass.` : '';
  if (status.level === 'UNKNOWN') return `Frank storage UNKNOWN: free space unreadable. ${HUMAN_STEPS}`;
  if (status.level === 'CRITICAL') {
    return `Frank storage CRITICAL: ${free}.${gates(status)}${freed}${trend} ${HUMAN_STEPS}`;
  }
  if (status.level === 'LOW') return `Frank storage LOW: ${free}.${gates(status)}${freed}${trend} ${HUMAN_STEPS}`;
  return `Frank storage trend: ${free}, about ${status.daysToCritical} days until CRITICAL at the current rate.${trend} ${HUMAN_STEPS}`;
}

function reportText(status, history, now) {
  const week = history.filter((p) => now - p.at <= 7 * DAY).sort((a, b) => a.at - b.at);
  const weekDelta = week.length >= 2 ? disk.gb(week[week.length - 1].freeBytes - week[0].freeBytes) : null;
  const lines = [
    `Weekly storage report — Frank: ${status.level}, ${status.freeGb} GB free of ${status.totalGb} GB.`,
    weekDelta === null ? 'Week change: not enough data yet.' : `Week change: ${weekDelta >= 0 ? '+' : ''}${weekDelta} GB.`,
    status.trendGbPerDay === null ? null : `Last 24h trend: ${status.trendGbPerDay} GB/day.`,
    status.dockerDiskGb === null ? null : `Docker disk image: ${status.dockerDiskGb} GB (compact monthly; see docs/STORAGE_PROGRAM.md).`,
    `Guard cleanup this week: ${status.freedWeekGb} GB.`,
  ];
  return lines.filter(Boolean).join('\n');
}

async function runStoragePass(overrides = {}) {
  const root = overrides.root || path.resolve(__dirname, '..');
  const env = overrides.env || process.env;
  const platform = overrides.platform || process.platform;
  const now = (overrides.now || Date.now)();
  const run = overrides.run || execResult;
  const tmpdir = overrides.tmpdir || os.tmpdir();
  const measure = overrides.measure || (() => disk.measure(disk.defaultVolume(root)));
  const post = overrides.post || ((channel, body) => require('../lib/forge-board/sdk').post(channel, body, null, { sender: 'hydi-daemon' }));
  const dir = overrides.storageDir || path.join(root, '.runtime', 'storage');
  const statusPath = path.join(dir, 'status.json');
  const statePath = path.join(dir, 'state.json');
  const historyPath = path.join(dir, 'history.jsonl');
  const autoclean = String(env.HYDI_STORAGE_AUTOCLEAN || 'on').toLowerCase() !== 'off';

  const before = measure();
  const levelBefore = disk.levelFor(before ? before.freeBytes : null, env);
  const actions = autoclean && before
    ? await runCleanup({ level: levelBefore, root, tmpdir, run, platform, now })
    : [];
  const after = actions.length ? measure() : before;
  const level = disk.levelFor(after ? after.freeBytes : null, env);
  const freedBytes = before && after ? Math.max(0, after.freeBytes - before.freeBytes) : 0;

  const history = readHistory(historyPath).filter((p) => now - p.at <= HISTORY_KEEP_MS);
  if (before) history.push({ at: now, freeBytes: before.freeBytes, freedBytes });
  try { writeHistory(historyPath, history); } catch { /* status still written below */ }

  const trend = trendGbPerDay(history, now);
  const state = readJson(statePath, {});
  const freedWeekBytes = history.filter((p) => now - p.at <= 7 * DAY).reduce((sum, p) => sum + (p.freedBytes || 0), 0);

  const status = {
    at: new Date(now).toISOString(),
    level,
    freeGb: after ? disk.gb(after.freeBytes) : null,
    totalGb: after ? disk.gb(after.totalBytes) : null,
    trendGbPerDay: trend,
    daysToCritical: daysUntilCritical(after ? after.freeBytes : null, trend, env),
    autoclean,
    actions,
    freedGb: disk.gb(freedBytes),
    freedWeekGb: disk.gb(freedWeekBytes),
    dockerDiskGb: dockerDiskGb(env, platform),
    thresholds: disk.thresholds(env),
    gateFloors: disk.gateFloors(env),
  };
  try { writeJsonAtomic(statusPath, status); } catch { /* best effort */ }

  // Alert once per distinct condition; post a recovery once when it clears.
  let alertKey = null;
  if (disk.severity(level) >= disk.severity('LOW')) alertKey = level;
  else if (status.daysToCritical !== null && status.daysToCritical < 3) alertKey = 'TREND';

  let posted = null;
  if (alertKey && state.alertKey !== alertKey) {
    if (postSucceeded(await post('alerts', alertText(status)))) {
      state.alertKey = alertKey;
      posted = alertKey;
    }
  } else if (!alertKey && state.alertKey) {
    if (postSucceeded(await post('alerts', `Frank storage recovered: ${level}, ${status.freeGb} GB free. Deploys and local CI resume.`))) {
      delete state.alertKey;
      posted = 'RECOVERED';
    }
  }

  if (after && (!state.lastReportAt || now - state.lastReportAt >= REPORT_EVERY_MS)) {
    if (postSucceeded(await post('ops', reportText(status, history, now)))) state.lastReportAt = now;
  }
  try { writeJsonAtomic(statePath, state); } catch { /* best effort */ }

  return { ...status, posted };
}

function startGuardLoop({ pass = runStoragePass, intervalMs = INTERVAL_MS, setIntervalFn = setInterval, log = (m) => console.log(m) } = {}) {
  let inFlight = false;
  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const s = await pass();
      const cleaned = s.actions.filter((a) => a.detail && a.detail !== '0 removed').map((a) => `${a.id}:${a.detail}`);
      log(`[${APP_NAME}] ${s.level} ${s.freeGb} GB free${s.freedGb ? `, freed ${s.freedGb} GB` : ''}${cleaned.length ? ` (${cleaned.join(', ')})` : ''}`);
    } catch (error) {
      log(`[${APP_NAME}] pass failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      inFlight = false;
    }
  };
  void tick();
  return { tick, timer: setIntervalFn(tick, intervalMs) };
}

if (require.main === module) {
  require('../lib/runtime/board-env').loadBoardEnv(path.resolve(__dirname, '..'));
  if (process.argv.includes('--once')) {
    runStoragePass().then((s) => console.log(JSON.stringify(s, null, 2)));
  } else {
    require('../lib/runtime/provenance').recordProcessProvenance(APP_NAME).catch(() => null).then(() => startGuardLoop());
  }
}

module.exports = {
  APP_NAME,
  INTERVAL_MS,
  CLEANUP,
  CI_WORKTREE_RE,
  STALE_TEMP_AGE_MS,
  staleDirs,
  staleTempEntries,
  newestMtime,
  runCleanup,
  trendGbPerDay,
  daysUntilCritical,
  alertText,
  reportText,
  runStoragePass,
  startGuardLoop,
};
