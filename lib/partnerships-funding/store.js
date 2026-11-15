'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function defaultDir() {
  const configured = process.env.HYDI_PARTNERSHIPS_DIR;
  if (configured) return path.resolve(configured);
  return path.join(process.env.HYDI_REPO_ROOT || path.resolve(__dirname, '..', '..'), '.runtime', 'partnerships-funding');
}

function dedupKey(provider, programName) {
  const raw = `${String(provider).toLowerCase().trim()}::${String(programName).toLowerCase().trim()}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

function atomicWrite(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, filePath);
}

class PartnershipStore {
  constructor(opts = {}) {
    this.dir = opts.dir || defaultDir();
    this.dataFile = path.join(this.dir, 'opportunities.json');
    this.now = opts.now || (() => Date.now());
    this.createId = opts.createId || (() => crypto.randomBytes(10).toString('hex'));
  }

  load() {
    if (!fs.existsSync(this.dataFile)) {
      return { version: 1, opportunities: [], history: [] };
    }
    try {
      return JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
    } catch {
      return { version: 1, opportunities: [], history: [] };
    }
  }

  save(state) {
    state.updated_at = new Date(this.now()).toISOString();
    atomicWrite(this.dataFile, JSON.stringify(state, null, 2) + '\n');
    return state;
  }

  findByDedup(state, key) {
    return state.opportunities.find((o) => o.dedup_key === key) || null;
  }

  upsertOpportunity(state, record) {
    const key = record.dedup_key || dedupKey(record.provider, record.program_name);
    const existing = this.findByDedup(state, key);
    if (existing) {
      const { pipeline_state: _ps, ...refresh } = record;
      Object.assign(existing, refresh, { dedup_key: key, updated_at: new Date(this.now()).toISOString() });
      return { opportunity: existing, created: false };
    }
    const row = {
      id: this.createId(),
      dedup_key: key,
      created_at: new Date(this.now()).toISOString(),
      updated_at: new Date(this.now()).toISOString(),
      pipeline_state: 'discovered',
      ...record,
    };
    state.opportunities.push(row);
    return { opportunity: row, created: true };
  }
}

module.exports = { PartnershipStore, defaultDir, dedupKey, atomicWrite };