'use strict';

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * EventLedger is an immutable, append-only log of every event.
 *
 * Each entry contains a hash of the previous entry, creating a chain
 * that can be verified. Events can be replayed to reconstruct system state.
 */
class EventLedger {
  constructor(kernel, options = {}) {
    this.kernel = kernel;
    this.config = {
      ledgerPath: options.ledgerPath || path.resolve(__dirname, '../../data/ledger'),
      maxSegmentSize: options.maxSegmentSize || 10000,
      ...options,
    };
    this.entries = [];
    this._lastHash = null;
    this._segment = 0;
  }

  async initialize() {
    await fs.mkdir(this.config.ledgerPath, { recursive: true });
    await this._loadSegment();
  }

  async _loadSegment() {
    const files = await fs.readdir(this.config.ledgerPath).catch(() => []);
    const segments = files.filter((f) => f.endsWith('.json')).sort();
    if (segments.length === 0) return;
    const latest = segments[segments.length - 1];
    const data = JSON.parse(await fs.readFile(path.join(this.config.ledgerPath, latest), 'utf8'));
    this._segment = Number(latest.replace('.json', ''));
    this.entries = data.entries || [];
    this._lastHash = data.lastHash || null;
  }

  async append(event) {
    const entry = this._buildEntry(event);
    this.entries.push(entry);
    if (this.entries.length >= this.config.maxSegmentSize) {
      await this._rotate();
    }
    return entry;
  }

  _buildEntry(event) {
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const payload = JSON.stringify({ ...event, id, timestamp });
    const hash = this._hash(this._lastHash, payload);
    const entry = { id, timestamp, payload: JSON.parse(payload), previousHash: this._lastHash, hash };
    this._lastHash = hash;
    return entry;
  }

  _hash(previous, payload) {
    return crypto.createHash('sha256').update(`${previous || ''}:${payload}`).digest('hex');
  }

  async _rotate() {
    await this._saveSegment();
    this._segment += 1;
    this.entries = [];
    this._lastHash = null;
  }

  async _saveSegment() {
    const file = path.join(this.config.ledgerPath, `${String(this._segment).padStart(8, '0')}.json`);
    await fs.writeFile(file, JSON.stringify({ lastHash: this._lastHash, entries: this.entries }, null, 2));
  }

  async flush() {
    await this._saveSegment();
  }

  getRange(start = 0, end) {
    return this.entries.slice(start, end);
  }

  async replay(handler, options = {}) {
    const filter = options.filter || (() => true);
    const all = this.entries.filter(filter);
    const results = [];
    for (const entry of all) {
      try {
        results.push({ id: entry.id, status: 'ok', result: await handler(entry.payload) });
      } catch (err) {
        results.push({ id: entry.id, status: 'error', error: err.message });
      }
    }
    return results;
  }

  verify() {
    let previousHash = null;
    for (const entry of this.entries) {
      const expected = this._hash(entry.previousHash, JSON.stringify(entry.payload));
      if (entry.hash !== expected) {
        return { valid: false, brokenAt: entry.id, reason: 'hash_mismatch' };
      }
      if (entry.previousHash !== previousHash) {
        return { valid: false, brokenAt: entry.id, reason: 'chain_break' };
      }
      previousHash = entry.hash;
    }
    return { valid: true, count: this.entries.length };
  }

  async dispose() {
    await this.flush();
  }
}

module.exports = EventLedger;
