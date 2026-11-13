'use strict';
/**
 * Cross-process recovery mutex for `scripts/hydi-recover.js`.
 *
 * Two watchdog cycles once overlapped `hydi-recover --component=heidi-web`
 * because the first child was still inside its postcondition grace when the
 * next cycle delegated again. This file lock makes the second caller exit
 * "recovery already in progress" instead of running a competing recovery.
 *
 * Lock file: <root>/.runtime/recover-<component>.lock
 *   { pid, component, at, cmd }
 *
 * Reclaim rules: a lock is busy only while its recorded PID is alive.
 * A dead PID (or unreadable/corrupt file) is reclaimed immediately — a dead
 * holder cannot still be recovering. Locks older than STALE_MS whose PID is
 * dead are treated the same way; a live PID blocks regardless of age.
 */
const fs = require('fs');
const path = require('path');

const STALE_MS = 10 * 60 * 1000;

function lockPath(root, component) {
  return path.join(root, '.runtime', `recover-${component}.lock`);
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means the process exists but we can't signal it — still alive.
    return e && e.code === 'EPERM';
  }
}

function readLock(file) {
  try {
    const cur = JSON.parse(fs.readFileSync(file, 'utf8'));
    return cur && typeof cur === 'object' ? cur : null;
  } catch {
    return null;
  }
}

/**
 * Try to take the recovery lock for `component`.
 * @returns {{ ok: true } | { ok: false, holder: object }}
 */
function acquire(root, component, { pid = process.pid, cmd = process.argv.slice(2).join(' ') } = {}) {
  const file = lockPath(root, component);
  const cur = readLock(file);
  if (cur && pidAlive(cur.pid)) {
    return { ok: false, holder: cur };
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Atomic-ish on Windows: write tmp then rename so readers never see a
    // half-written lock.
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ pid, component, at: new Date().toISOString(), cmd }));
    fs.renameSync(tmp, file);
    return { ok: true };
  } catch (e) {
    // If we can't write the lock we still allow recovery — the mutex is a
    // safety improvement, not a new hard dependency.
    return { ok: true, warn: e.message };
  }
}

function release(root, component, { pid = process.pid } = {}) {
  try {
    const cur = readLock(lockPath(root, component));
    if (cur && cur.pid === pid) fs.rmSync(lockPath(root, component), { force: true });
  } catch { /* best effort */ }
}

/** True while another live process holds the component's recovery lock. */
function inProgress(root, component) {
  const cur = readLock(lockPath(root, component));
  return Boolean(cur && pidAlive(cur.pid));
}

/** Age in ms of the lock, or null when absent/unreadable. */
function ageMs(root, component) {
  const cur = readLock(lockPath(root, component));
  if (!cur || !cur.at) return null;
  const t = Date.parse(cur.at);
  return Number.isFinite(t) ? Date.now() - t : null;
}

module.exports = { acquire, release, inProgress, ageMs, lockPath, pidAlive, STALE_MS };
