'use strict';

const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');

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
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, filePath);
}

function emptyState() {
  return {
    version: 1,
    tasks: [],
    workers: [],
    history: [],
    budgets: { tasksThisHour: 0, hourKey: null, paidUsdToday: 0, dayKey: null },
    updated_at: new Date().toISOString(),
  };
}

class DistributedCloudStore {
  constructor(opts = {}) {
    this.dir = opts.dir || defaultDir();
    this.stateFile = path.join(this.dir, 'state.json');
    this.now = opts.now || Date.now;
    this.createId = opts.createId || (() => randomBytes(12).toString('hex'));
  }

  load() {
    if (!fs.existsSync(this.stateFile)) {
      const s = emptyState();
      this.save(s);
      return s;
    }
    try {
      return JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
    } catch {
      const s = emptyState();
      this.save(s);
      return s;
    }
  }

  save(state) {
    state.updated_at = new Date(this.now()).toISOString();
    atomicWrite(this.stateFile, JSON.stringify(state, null, 2) + '\n');
    return state;
  }

  mutate(fn) {
    const state = this.load();
    const out = fn(state);
    this.save(state);
    return out;
  }
}

module.exports = { DistributedCloudStore, defaultDir, repoRoot, emptyState, atomicWrite };