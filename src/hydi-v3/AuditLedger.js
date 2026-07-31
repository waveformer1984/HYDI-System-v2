'use strict';

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const PERSISTENCE_VERSION = 1;

function generateId() {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function hashRecord(payload, previousHash) {
  const data = JSON.stringify({ payload, previousHash });
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * AuditLedger is an append-only, immutable, hash-chained event log.
 *
 * Every record includes:
 * - id
 * - timestamp
 * - category (action, recommendation, decision, rollback, etc.)
 * - actor
 * - subjectId
 * - payload
 * - previousHash
 * - hash
 *
 * Once written, a record is never modified. Tampering with any record breaks
 * the chain and is detected by verify().
 */
class AuditLedger extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      dataPath: config.dataPath || path.resolve(__dirname, '../../data'),
      persistDebounceMs: config.persistDebounceMs ?? 50,
      logger: config.logger || console,
      ...config,
    };

    this.records = [];
    this._persistTimer = null;
    this._persistPending = false;
    this._started = false;
    this._destroyed = false;

    this.storePath = path.join(this.config.dataPath, 'audit-ledger.json');
  }

  async start() {
    if (this._destroyed) throw new Error('AuditLedger has been destroyed');
    if (this._started) return;

    await this._ensureDataDir();
    await this._load();
    this._started = true;
    this.config.logger.log('[AuditLedger] started');
  }

  stop() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    this._started = false;
    this.config.logger.log('[AuditLedger] stopped');
  }

  async flush() {
    return this._flush();
  }

  async destroy() {
    if (this._destroyed) return;
    this.stop();
    await this._flush();
    this.records = [];
    this.removeAllListeners();
    this._destroyed = true;
  }

  record({ category, actor, subjectId, payload }) {
    if (this._destroyed) throw new Error('AuditLedger has been destroyed');
    if (!this._started) throw new Error('AuditLedger has not been started');
    if (!category) throw new Error('Audit record must have a category');

    const previousHash = this.records.length ? this.records[this.records.length - 1].hash : null;
    const record = {
      id: generateId(),
      at: Date.now(),
      category,
      actor: actor || 'system',
      subjectId: subjectId || null,
      payload: payload || {},
      previousHash,
      hash: null,
    };
    record.hash = hashRecord(record.payload, previousHash);

    this.records.push(record);
    this._persist();
    this.emit('record', record);
    return record;
  }

  getEvents(query = {}) {
    let out = [...this.records];
    if (query.category) out = out.filter((r) => r.category === query.category);
    if (query.actor) out = out.filter((r) => r.actor === query.actor);
    if (query.subjectId) out = out.filter((r) => r.subjectId === query.subjectId);
    if (query.since) out = out.filter((r) => r.at >= query.since);
    if (query.limit) out = out.slice(-query.limit);
    return out;
  }

  latest() {
    return this.records[this.records.length - 1] || null;
  }

  verify() {
    for (let i = 0; i < this.records.length; i += 1) {
      const r = this.records[i];
      const expectedPrevious = i > 0 ? this.records[i - 1].hash : null;
      if (r.previousHash !== expectedPrevious) return { ok: false, failedAt: i, reason: 'previous-hash-mismatch' };
      const expectedHash = hashRecord(r.payload, r.previousHash);
      if (r.hash !== expectedHash) return { ok: false, failedAt: i, reason: 'record-hash-mismatch' };
    }
    return { ok: true, count: this.records.length };
  }

  async _ensureDataDir() {
    try {
      await fs.mkdir(this.config.dataPath, { recursive: true });
    } catch (e) {
      this.config.logger.error('[AuditLedger] data dir error', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  async _load() {
    try {
      const raw = await fs.readFile(this.storePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.records)) {
        this.records = parsed.records;
      } else {
        throw new Error('invalid snapshot');
      }
    } catch (e) {
      if (e.code === 'ENOENT') {
        this.records = [];
      } else {
        this.config.logger.error('[AuditLedger] load error, starting fresh', { error: e instanceof Error ? e.message : String(e) });
        this.records = [];
      }
    }
  }

  _persist() {
    if (this._destroyed) return;
    this._persistPending = true;
    if (this._persistTimer) return;
    this._persistTimer = setTimeout(() => this._flush(), this.config.persistDebounceMs);
    if (this._persistTimer.unref) this._persistTimer.unref();
  }

  async _flush() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    if (!this._persistPending) return;
    this._persistPending = false;

    const snapshot = {
      version: PERSISTENCE_VERSION,
      updatedAt: Date.now(),
      records: this.records,
    };
    const temp = `${this.storePath}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(snapshot, null, 2));
      await fs.rename(temp, this.storePath);
    } catch (e) {
      this.config.logger.error('[AuditLedger] persist error', { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

module.exports = AuditLedger;
