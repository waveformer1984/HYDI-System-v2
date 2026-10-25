#!/usr/bin/env node
'use strict';

/**
 * Frank observer: keeps Frank fully observed and tells Jordan when
 * something is wrong. Read-only — it never restarts, kills or changes
 * anything (cleanup lives in frank-storage-guard).
 *
 * Every 60 seconds:
 *   1. If the observatory sample (.observatory/current.json) is older than
 *      75s, run scripts/observatory/collect.ps1 -Once. A Task Scheduler
 *      job, if one exists, keeps working; this just guarantees a sample.
 *   2. Build the combined snapshot (lib/observation/frank-snapshot.js) and
 *      write .runtime/observation/frank.json.
 *   3. Post to #alerts when a critical issue has held for two passes in a
 *      row (no alert for a one-sample blip), and once more when it clears.
 *      Disk issues are left to frank-storage-guard's own alerts.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { buildFrankSnapshot } = require('../lib/observation/frank-snapshot');

const APP_NAME = 'frank-observer';
const INTERVAL_MS = 60 * 1000;
const SAMPLE_MAX_AGE_MS = 75 * 1000;
const COLLECT_TIMEOUT_MS = 50 * 1000;
const CONFIRM_PASSES = 2;
// Disk alerts belong to frank-storage-guard, which already posts them once
// per level; repeating them here would double every disk alert.
const OWNED_ELSEWHERE = /^(storage-|disk-c-)/;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function sampleAgeMs(root, now) {
  const cur = readJson(path.join(root, '.observatory', 'current.json'), null);
  const t = cur ? Date.parse(cur.ts) : NaN;
  return Number.isFinite(t) ? now - t : Infinity;
}

function runCollector(root) {
  return new Promise((resolve) => {
    execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(root, 'scripts', 'observatory', 'collect.ps1'), '-Once', '-Quiet',
    ], { cwd: root, timeout: COLLECT_TIMEOUT_MS, windowsHide: true }, (error) => {
      resolve(error ? { ok: false, error: error.message } : { ok: true });
    });
  });
}

function postSucceeded(result) {
  return Boolean(result && result.ok !== false && !result.skipped);
}

async function runObservationPass(overrides = {}) {
  const root = overrides.root || path.resolve(__dirname, '..');
  const now = (overrides.now || Date.now)();
  const platform = overrides.platform || process.platform;
  const collect = overrides.collect || runCollector;
  const post = overrides.post || ((channel, body) => require('../lib/forge-board/sdk').post(channel, body, null, { sender: 'hydi-daemon' }));
  const outDir = overrides.outDir || path.join(root, '.runtime', 'observation');
  const statePath = path.join(outDir, 'observer-state.json');

  let collected = { ok: true, skipped: 'sample fresh' };
  if (sampleAgeMs(root, now) > SAMPLE_MAX_AGE_MS) {
    collected = platform === 'win32' ? await collect(root) : { ok: false, skipped: 'collector is Windows-only' };
  }

  // Processes PM2 lost track of (lib/observation/strays.js). null = could
  // not be read this pass, which is not itself an issue.
  let strays = null;
  try {
    const collectStrays = overrides.collectStrays || require('../lib/observation/strays').collectStrays;
    strays = await collectStrays(root, { platform });
  } catch { strays = null; }

  const snapshot = buildFrankSnapshot({ root, now: (overrides.now || Date.now)(), extraIssues: strays || [] });
  snapshot.collector = collected;
  snapshot.straysChecked = strays !== null;
  try { writeJsonAtomic(path.join(outDir, 'frank.json'), snapshot); } catch { /* best effort */ }

  // seen: crit id -> consecutive passes; alerted: crit ids already posted.
  const state = readJson(statePath, { seen: {}, alerted: {} });
  state.seen = state.seen || {};
  state.alerted = state.alerted || {};
  const crit = new Map(snapshot.issues
    .filter((i) => i.severity === 'crit' && !OWNED_ELSEWHERE.test(i.id))
    .map((i) => [i.id, i]));

  const seen = {};
  for (const id of crit.keys()) seen[id] = (state.seen[id] || 0) + 1;
  state.seen = seen;

  const toRaise = [...crit.values()].filter((i) => seen[i.id] >= CONFIRM_PASSES && !state.alerted[i.id]);
  const toClear = Object.keys(state.alerted).filter((id) => !crit.has(id));
  const posted = [];

  if (toRaise.length) {
    const body = [`Frank CRITICAL — ${toRaise.length === 1 ? 'new issue' : `${toRaise.length} new issues`}:`,
      ...toRaise.map((i) => `• ${i.text}`),
      'Ask Heidi "frank status" or check the phone dashboard for the full picture.'].join('\n');
    if (postSucceeded(await post('alerts', body))) {
      for (const i of toRaise) state.alerted[i.id] = state.alerted[i.id] || i.text;
      posted.push('raised');
    }
  }
  if (toClear.length) {
    const body = `Frank recovered: ${toClear.map((id) => state.alerted[id]).join('; ')} — cleared.`;
    if (postSucceeded(await post('alerts', body))) {
      for (const id of toClear) delete state.alerted[id];
      posted.push('cleared');
    }
  }
  try { writeJsonAtomic(statePath, state); } catch { /* best effort */ }

  return { snapshot, posted };
}

function startObserverLoop({ pass = runObservationPass, intervalMs = INTERVAL_MS, setIntervalFn = setInterval, log = (m) => console.log(m) } = {}) {
  let inFlight = false;
  let lastLevel = null;
  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const { snapshot } = await pass();
      if (snapshot.level !== lastLevel) {
        log(`[${APP_NAME}] ${snapshot.level}${snapshot.issues.length ? `: ${snapshot.issues.map((i) => i.id).join(', ')}` : ''}`);
        lastLevel = snapshot.level;
      }
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
    runObservationPass().then(({ snapshot }) => {
      console.log(require('../lib/observation/frank-snapshot').formatFrankSnapshot(snapshot));
    });
  } else {
    require('../lib/runtime/provenance').recordProcessProvenance(APP_NAME).catch(() => null).then(() => startObserverLoop());
  }
}

module.exports = { APP_NAME, INTERVAL_MS, SAMPLE_MAX_AGE_MS, CONFIRM_PASSES, OWNED_ELSEWHERE, runObservationPass, startObserverLoop };
