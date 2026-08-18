'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_DATA_DIR = path.join(process.cwd(), 'data', 'hydi-local', 'protoforge');

function getDataDir() {
  return process.env.HYDI_PROTOFORGE_DATA_DIR || DEFAULT_DATA_DIR;
}

function ensureDir() {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function file(name) {
  return path.join(ensureDir(), name);
}

function atomicWrite(filePath, data) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, filePath);
}

function loadJson(filePath, defaultValue) {
  if (!fs.existsSync(filePath)) return defaultValue;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.warn(`[LocalPolicyStore] failed to parse ${filePath}:`, e instanceof Error ? e.message : e);
    return defaultValue;
  }
}

class LocalPolicyStore {
  constructor() {
    this._reloadCallbacks = [];
  }

  onReload(cb) {
    this._reloadCallbacks.push(cb);
  }

  async loadPolicy(stream) {
    const db = loadJson(file('policies.json'), { policies: [] });
    const policies = db.policies || [];

    const active = policies.filter((p) => p.is_active);
    const streamMatch = active.find((p) => p.stream === stream);
    if (streamMatch) return streamMatch;

    const globalMatch = active.find((p) => p.stream === null || p.stream === undefined);
    return globalMatch || null;
  }

  async recordDecision(row) {
    const decisions = loadJson(file('decisions.json'), { decisions: {} }).decisions || {};
    decisions[row.id] = { ...row };
    atomicWrite(file('decisions.json'), JSON.stringify({ decisions }, null, 2) + '\n');
    return row.id;
  }

  async recordOutcome(decisionId, outcome, detail = {}) {
    const decisions = loadJson(file('decisions.json'), { decisions: {} }).decisions || {};
    const d = decisions[decisionId];
    if (!d) {
      console.warn(`[LocalPolicyStore] outcome for unknown decision ${decisionId}`);
      return;
    }
    d.outcome = outcome;
    d.outcome_at = new Date().toISOString();
    d.outcome_detail = detail;
    atomicWrite(file('decisions.json'), JSON.stringify({ decisions }, null, 2) + '\n');
  }

  async destroy() {
    // no-op for local file store
  }
}

module.exports = LocalPolicyStore;
