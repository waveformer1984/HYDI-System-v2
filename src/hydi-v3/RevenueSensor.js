'use strict';

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

function toTimestamp(value) {
  if (!value) return Date.now();
  if (typeof value === 'number') return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? Date.now() : d.getTime();
}

class JSONLedgerAdapter {
  constructor(config = {}) {
    this.path = config.path;
    this.amountKey = config.amountKey || 'amount';
    this.currencyKey = config.currencyKey || 'currency';
    this.idKey = config.idKey || 'id';
    this.dateKey = config.dateKey || 'date';
    this.descriptionKey = config.descriptionKey || 'description';
    this.typeKey = config.typeKey || 'type';
    this.precision = config.precision ?? 0.01;
    this.ledger = config.path || 'json-ledger';
  }

  async read() {
    const text = await fs.readFile(this.path, 'utf8');
    const parsed = JSON.parse(text);
    const records = Array.isArray(parsed) ? parsed : (parsed.records || []);
    return records.map((r, i) => {
      const raw = r[this.amountKey];
      const amount = (raw === undefined || raw === null) ? null : Number(raw);
      return {
        id: r[this.idKey] || `json-${i}`,
        amount: Number.isFinite(amount) ? amount : null,
        currency: r[this.currencyKey] || 'USD',
        at: toTimestamp(r[this.dateKey]),
        description: r[this.descriptionKey] || 'JSON ledger entry',
        ledger: this.ledger,
        precision: this.precision,
        type: r[this.typeKey] || undefined,
      };
    });
  }
}

class CSVLedgerAdapter {
  constructor(config = {}) {
    this.path = config.path;
    this.delimiter = config.delimiter || ',';
    this.columns = config.columns || null;
    this.precision = config.precision ?? 0.01;
    this.ledger = config.path || 'csv-ledger';
  }

  async read() {
    const text = await fs.readFile(this.path, 'utf8');
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length < 2) return [];
    const headers = this.columns || lines[0].split(this.delimiter).map((h) => h.trim());
    const body = this.columns ? lines : lines.slice(1);
    return body.map((line, i) => {
      const cells = line.split(this.delimiter).map((c) => c.trim());
      const row = {};
      headers.forEach((h, idx) => { row[h] = cells[idx]; });
      const raw = row.amount !== undefined && row.amount !== '' ? row.amount : row.value;
      const parsed = Number(raw);
      const amount = Number.isFinite(parsed) ? parsed : null;
      return {
        id: row.id || `csv-${i}`,
        amount,
        currency: row.currency || 'USD',
        at: toTimestamp(row.date || row.timestamp),
        description: row.description || 'CSV ledger entry',
        ledger: this.ledger,
        precision: this.precision,
        type: row.type || undefined,
      };
    });
  }
}

class MockRevenueAdapter {
  constructor(config = {}) {
    this.transactions = config.transactions || [];
    this.ledger = config.ledger || 'mock-ledger';
    this.precision = config.precision ?? 0.01;
    this._returned = false;
  }

  async read() {
    if (this._returned) return [];
    this._returned = true;
    return this.transactions.map((t) => ({
      ...t,
      ledger: t.ledger || this.ledger,
      precision: t.precision || this.precision,
    }));
  }
}

class RevenueSensor extends EventEmitter {
  constructor(config = {}) {
    super();
    this.eventBus = config.eventBus || null;
    this.logger = config.logger || console;
    this.adapters = [];
    this.pollMs = config.pollMs || 0;
    this.seen = new Set();
    this._timer = null;
    this._started = false;
    this._destroyed = false;
    for (const a of config.adapters || []) {
      this.registerAdapter(a);
    }
    this._registerEventTypes();
  }

  _registerEventTypes() {
    if (!this.eventBus || !this.eventBus.registry) return;
    const types = [
      'RevenueReceived', 'RevenueRefunded', 'InvoicePaid', 'InvoiceOverdue',
      'SubscriptionStarted', 'SubscriptionCancelled',
    ];
    const schema = {
      fields: ['id', 'amount', 'currency', 'at', 'description', 'ledger', 'customer', 'project', 'type'],
    };
    for (const type of types) {
      this.eventBus.registry.register(type, 'RevenueSensor', {
        domain: 'financial',
        source: 'RevenueSensor',
        measurement: 'quantitative',
        strategicObjective: 'revenue',
        schema,
      });
    }
  }

  registerAdapter(adapter) {
    if (!adapter || typeof adapter.read !== 'function') {
      throw new Error('Revenue adapter must have a read() method');
    }
    this.adapters.push(adapter);
    return this;
  }

  start() {
    if (this._destroyed) throw new Error('RevenueSensor has been destroyed');
    if (this._started) return this;
    this._started = true;
    this.scan();
    if (this.pollMs > 0) {
      this._timer = setInterval(() => this.scan(), this.pollMs);
    }
    this.logger.log('[RevenueSensor] started');
    return this;
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._started = false;
    return this;
  }

  destroy() {
    if (this._destroyed) return this;
    this.stop();
    this.adapters = [];
    this.seen.clear();
    this.removeAllListeners();
    this._destroyed = true;
    return this;
  }

  async scan() {
    if (this._destroyed) return [];
    const emitted = [];
    for (const adapter of this.adapters) {
      try {
        const transactions = await adapter.read();
        for (const tx of transactions) {
          if (!Number.isFinite(tx.amount)) continue;
          const fingerprint = tx.id || this._fingerprint(tx);
          if (this.seen.has(fingerprint)) continue;
          this.seen.add(fingerprint);
          emitted.push(tx);
          this._emit(tx);
        }
      } catch (error) {
        await this._handleCorrupt(adapter, error);
      }
    }
    return emitted;
  }

  _emit(tx, eventType) {
    const type = eventType || tx.eventType || tx.type || 'RevenueReceived';
    this.emit('revenue', tx, type);
    if (this.eventBus) {
      this.eventBus.emit(type, tx, 'RevenueSensor');
    }
  }

  _fingerprint(tx) {
    const payload = JSON.stringify({
      amount: tx.amount,
      currency: tx.currency,
      at: tx.at,
      description: tx.description,
      ledger: tx.ledger,
      type: tx.type,
    });
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  healthCheck() {
    return {
      ok: !this._destroyed && this._started,
      adapterCount: this.adapters.length,
      seenCount: this.seen.size,
      polling: this.pollMs > 0,
    };
  }

  async _handleCorrupt(adapter, error) {
    if (adapter && adapter.path) {
      try {
        const corruptPath = `${adapter.path}.corrupt.${Date.now()}`;
        await fs.rename(adapter.path, corruptPath);
      } catch (e) {
        // ignore
      }
    }
    this.logger.error('[RevenueSensor] corrupt ledger', { error: error instanceof Error ? error.message : String(error), path: adapter && adapter.path });
    this.emit('ledger-corrupt', { adapter, error: error instanceof Error ? error.message : String(error) });
  }
}

module.exports = { RevenueSensor, JSONLedgerAdapter, CSVLedgerAdapter, MockRevenueAdapter };
