'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

function computeHash(fingerprint, eventType, payload) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ fingerprint, event_type: eventType, payload }))
    .digest('hex');
}

function loadRecords() {
  const f = file('raw-ledger.json');
  if (!fs.existsSync(f)) return [];
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    console.warn('[LocalLedgerStore] failed to parse raw-ledger.json:', e instanceof Error ? e.message : e);
    return [];
  }
}

function saveRecords(records) {
  atomicWrite(file('raw-ledger.json'), JSON.stringify(records, null, 2) + '\n');
}

class LocalLedgerStore {
  constructor(dataDir) {
    if (dataDir) process.env.HYDI_PROTOFORGE_DATA_DIR = dataDir;
  }

  async append(event) {
    const records = loadRecords();
    const existing = records.find((r) => r.fingerprint === event.fingerprint);
    if (existing) {
      return { record: existing, duplicate: true };
    }

    const record = {
      id: crypto.randomUUID(),
      fingerprint: event.fingerprint,
      event_type: event.event_type,
      payload: event.payload,
      hash: computeHash(event.fingerprint, event.event_type, event.payload),
      created_at: new Date().toISOString(),
    };
    records.push(record);
    saveRecords(records);
    return { record, duplicate: false };
  }

  async get(fingerprint) {
    const records = loadRecords();
    return records.find((r) => r.fingerprint === fingerprint) || null;
  }

  async list(options = {}) {
    const records = loadRecords();
    let filtered = records;

    if (options.since) {
      filtered = filtered.filter((r) => r.created_at >= options.since);
    }
    if (options.fromTimestamp) {
      filtered = filtered.filter((r) => r.created_at >= options.fromTimestamp);
    }
    if (options.eventType) {
      filtered = filtered.filter((r) => r.event_type === options.eventType);
    }

    const offset = Math.max(0, parseInt(options.offset, 10) || 0);
    const limit = Math.min(1000, Math.max(1, parseInt(options.limit, 10) || 100));
    const total = filtered.length;
    const page = filtered.slice(offset, offset + limit);

    return {
      events: page,
      total,
      offset,
      limit,
      hasMore: offset + page.length < total,
    };
  }

  async health() {
    try {
      const records = loadRecords();
      return { ok: true, connected: true, events: records.length };
    } catch (err) {
      return { ok: false, connected: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }
}

module.exports = LocalLedgerStore;
