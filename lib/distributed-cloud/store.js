'use strict';

const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');
const { acquireDirLock } = require('./lock');

function repoRoot() {
  return process.env.HYDI_REPO_ROOT || path.resolve(__dirname, '..', '..');
}

function defaultDir() {
  const configured = process.env.HYDI_DISTRIBUTED_CLOUD_DIR;
  if (configured) return path.resolve(configured);
  return path.join(repoRoot(), '.runtime', 'distributed-cloud');
}

function atomicWrite(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, filePath);
}

function emptyState() {
  return {
    version: 2,
    tasks: [],
    workers: [],
    history: [],
    budgets: { tasksThisHour: 0, hourKey: null, paidUsdToday: 0, dayKey: null },
    auth_replay_used: {},
    write_seq: 0,
    updated_at: new Date().toISOString(),
  };
}

function loadStateFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

class DistributedCloudStore {
  constructor(opts = {}) {
    this.dir = opts.dir || defaultDir();
    this.stateFile = path.join(this.dir, 'state.json');
    this.now = opts.now || Date.now;
    this.createId = opts.createId || (() => randomBytes(12).toString('hex'));
    this.lockTimeoutMs = opts.lockTimeoutMs;
    this.lockStaleMs = opts.lockStaleMs;
    this.singleWriter = opts.singleWriter === true;
  }

  load() {
    if (!fs.existsSync(this.stateFile)) {
      const s = emptyState();
      return s;
    }
    try {
      const s = loadStateFile(this.stateFile);
      if (!s.auth_replay_used) s.auth_replay_used = {};
      return s;
    } catch {
      const corrupt = path.join(this.dir, `state.corrupt.${Date.now()}.json`);
      try {
        fs.copyFileSync(this.stateFile, corrupt);
      } catch {
        /* empty */
      }
      return emptyState();
    }
  }

  save(state) {
    state.updated_at = new Date(this.now()).toISOString();
    state.write_seq = (state.write_seq || 0) + 1;
    atomicWrite(this.stateFile, JSON.stringify(state, null, 2) + '\n');
    return state;
  }

  withLock(fn) {
    if (this.singleWriter) return fn(null);
    const lock = acquireDirLock(this.dir, {
      timeoutMs: this.lockTimeoutMs,
      staleMs: this.lockStaleMs,
      now: this.now(),
    });
    if (!lock.ok) {
      return { lockError: lock.code || 'LOCK_FAILED', detail: lock.error || 'lock_failed' };
    }
    try {
      return fn(lock);
    } finally {
      lock.release();
    }
  }

  /**
   * Atomic read-modify-write under cross-process lock (same host).
   */
  mutate(fn) {
    const wrapped = this.withLock(() => {
      const state = this.load();
      const out = fn(state);
      this.save(state);
      return out;
    });
    if (wrapped && wrapped.lockError) {
      return { ok: false, error: wrapped.lockError, detail: wrapped.detail };
    }
    return wrapped;
  }

  /** Read-only under lock */
  read(fn) {
    return this.withLock(() => {
      const state = this.load();
      return fn(state);
    });
  }
}

module.exports = {
  DistributedCloudStore,
  defaultDir,
  repoRoot,
  emptyState,
  atomicWrite,
  loadStateFile,
};