'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_LOCK_MS = Number(process.env.HYDI_DISTRIBUTED_LOCK_TIMEOUT_MS || 15_000);
const DEFAULT_STALE_MS = Number(process.env.HYDI_DISTRIBUTED_LOCK_STALE_MS || 60_000);

function lockPath(dir) {
  return path.join(dir, '.state.lock');
}

function readLockMeta(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const [pid, started] = raw.split(':');
    return { pid: Number(pid), started: Number(started) };
  } catch {
    return null;
  }
}

function sleep(ms) {
  const sab = new SharedArrayBuffer(4);
  const ia = new Int32Array(sab);
  Atomics.wait(ia, 0, 0, ms);
}

/**
 * Cross-process exclusive lock for a directory (same host; supports multi-worker on one machine).
 */
function acquireDirLock(dir, { timeoutMs = DEFAULT_LOCK_MS, staleMs = DEFAULT_STALE_MS, now = Date.now } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const file = lockPath(dir);
  const deadline = now + timeoutMs;
  let attempts = 0;

  while (Date.now() < deadline) {
    attempts += 1;
    try {
      const fd = fs.openSync(file, 'wx');
      fs.writeFileSync(fd, `${process.pid}:${Date.now()}`, 'utf8');
      return {
        ok: true,
        file,
        fd,
        release() {
          try {
            fs.closeSync(fd);
          } catch {
            /* empty */
          }
          try {
            fs.unlinkSync(file);
          } catch {
            /* empty */
          }
        },
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const st = fs.statSync(file);
        const age = Date.now() - st.mtimeMs;
        const meta = readLockMeta(file);
        if (age > staleMs) {
          fs.unlinkSync(file);
          continue;
        }
        if (meta && meta.pid) {
          try {
            process.kill(meta.pid, 0);
          } catch {
            fs.unlinkSync(file);
            continue;
          }
        }
      } catch {
        /* empty */
      }
      sleep(Math.min(50, 10 + attempts * 2));
    }
  }
  return { ok: false, error: 'lock_timeout', code: 'LOCK_TIMEOUT' };
}

module.exports = {
  acquireDirLock,
  lockPath,
  DEFAULT_LOCK_MS,
  DEFAULT_STALE_MS,
};