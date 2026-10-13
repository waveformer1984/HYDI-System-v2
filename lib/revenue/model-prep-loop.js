'use strict';

/**
 * Model Prep Executor — supervised loop + status surface.
 *
 * Exists because of a measured failure (2026-10-13): the scheduler's first
 * `await cycle()` ran outside any try/catch, so an unreachable database
 * (ECONNREFUSED 127.0.0.1:54322) reached main().catch -> process.exit(1) and
 * PM2 restarted it — tens of thousands of times — while every dependent
 * stayed equally dead. A supervised worker must stay alive on dependency
 * failure, back off, and say it is degraded where an operator can read it.
 *
 * Contract:
 *   - Every cycle is identical, including the first: catch, log, continue.
 *   - Failed cycles back off exponentially from the base interval, capped
 *     at BACKOFF_CAP_MS; the first success resets to the base interval.
 *   - Only a stop request ends the loop — a dependency error never does.
 *   - State transitions are logged once ('degraded: <reason>', then
 *     'recovered after N failures'), not once per failed cycle.
 *   - The status file is written every cycle so consumers can judge both
 *     the verdict and its freshness (updatedAt). state starts at
 *     'starting' and becomes 'ok' only after the first successful cycle —
 *     a verdict must be earned, never assumed.
 *
 * Everything time/IO-facing is injectable ({ cycle, sleep, now,
 * writeStatus, isStopping, log }) so the loop is testable without a
 * database or real timers.
 */

const fs = require('fs');
const path = require('path');

const MODEL_PREP_STATUS_FILE = '.model-prep-executor-status.json';
const BACKOFF_CAP_MS = 5 * 60 * 1000;

/**
 * Atomic write via tmp+rename — a reader never sees a torn snapshot.
 * Same contract as lib/heidi/DaemonStatusSurface.writeDaemonStatus:
 * never throws, returns an error string on failure, null on success.
 */
function writeModelPrepStatus(root, snapshot) {
  try {
    const target = path.join(root, MODEL_PREP_STATUS_FILE);
    const tmp = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(snapshot));
    fs.renameSync(tmp, target);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'status write failed';
  }
}

/** Sleep that stays interruptible — resolves within one poll tick of isStopping(). */
function interruptibleSleep(isStopping, pollMs = 250) {
  return (ms) => new Promise((resolve) => {
    if (isStopping() || ms <= 0) return resolve();
    const deadline = Date.now() + ms;
    const tick = () => {
      const remaining = deadline - Date.now();
      if (isStopping() || remaining <= 0) return resolve();
      setTimeout(tick, Math.min(pollMs, remaining));
    };
    setTimeout(tick, Math.min(pollMs, ms));
  });
}

function computeBackoffMs(consecutiveFailures, intervalMs, capMs = BACKOFF_CAP_MS) {
  // failure 1 -> interval, failure 2 -> 2x, failure 3 -> 4x, ... capped.
  return Math.min(intervalMs * 2 ** Math.max(0, consecutiveFailures - 1), capMs);
}

/**
 * Run one cycle for --once semantics. Returns { ok, error? } — the caller
 * maps that to the process exit code (a one-shot command may exit non-zero;
 * a supervised worker may not exit at all).
 */
async function runOnce({ cycle }) {
  try {
    await cycle();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The supervised loop. Resolves when isStopping() becomes true — including
 * promptly during a backoff wait, since the injected sleep is expected to
 * return early on a stop request.
 */
async function runSchedulerLoop({
  cycle,
  sleep,
  isStopping,
  writeStatus,
  now = () => Date.now(),
  log = (m) => console.log(m),
  intervalMs,
  maxBackoffMs = BACKOFF_CAP_MS,
  pid = process.pid,
}) {
  let consecutiveFailures = 0;
  // 'starting' until the first cycle completes — an 'ok' snapshot written
  // before anything has succeeded would be a false green: a hung first
  // cycle must read as 'starting', not 'ok'.
  let state = 'starting';
  let lastError = null;
  let lastSuccessAt = null;

  const snapshot = () => ({
    pid,
    state,
    consecutiveFailures,
    lastError,
    lastSuccessAt,
    updatedAt: new Date(now()).toISOString(),
  });

  // Report before the first cycle: a hung first cycle leaves an honest
  // 'starting' verdict — never 'ok' — rather than no file at all.
  writeStatus(snapshot());

  while (!isStopping()) {
    try {
      await cycle();
      const recovered = consecutiveFailures > 0;
      if (recovered) {
        log(`recovered after ${consecutiveFailures} failures`);
      }
      consecutiveFailures = 0;
      state = 'ok';
      lastError = null;
      lastSuccessAt = new Date(now()).toISOString();
      writeStatus(snapshot());
      await sleep(intervalMs);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      consecutiveFailures++;
      lastError = msg;
      // Log the transition, not every failure — the status file carries the
      // per-cycle truth; the log carries the state change.
      if (state !== 'degraded') log(`degraded: ${msg}`);
      state = 'degraded';
      writeStatus(snapshot());
      await sleep(computeBackoffMs(consecutiveFailures, intervalMs, maxBackoffMs));
    }
  }
}

module.exports = {
  MODEL_PREP_STATUS_FILE,
  BACKOFF_CAP_MS,
  writeModelPrepStatus,
  interruptibleSleep,
  computeBackoffMs,
  runOnce,
  runSchedulerLoop,
};
