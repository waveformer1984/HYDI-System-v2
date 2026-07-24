'use strict';

const fs = require('fs').promises;
const path = require('path');

/**
 * MemoryBus is the unified memory interface for HYDI.
 *
 * It supports multiple namespaces (semantic, conversation, project, execution,
 * failure, learning) and is backed by a pluggable adapter. Adapters must
 * implement get, set, delete, search, and optionally backup/restore.
 */
class MemoryBus {
  constructor(kernel, options = {}) {
    this.kernel = kernel;
    this.config = {
      defaultNamespace: options.defaultNamespace || 'working',
      ...options,
    };
    this.adapter = options.adapter || new InMemoryAdapter();
    this.namespaces = new Map();
    this.namespaces.set('working', this.adapter);
  }

  async initialize() {
    if (typeof this.adapter.initialize === 'function') {
      await this.adapter.initialize();
    }
  }

  namespace(name) {
    return new MemoryNamespace(this, name);
  }

  async set(key, value, options = {}) {
    const ns = options.namespace || this.config.defaultNamespace;
    return this._adapterFor(ns).set(this._key(ns, key), value, options);
  }

  async get(key, options = {}) {
    const ns = options.namespace || this.config.defaultNamespace;
    return this._adapterFor(ns).get(this._key(ns, key));
  }

  async delete(key, options = {}) {
    const ns = options.namespace || this.config.defaultNamespace;
    return this._adapterFor(ns).delete(this._key(ns, key));
  }

  async search(query, options = {}) {
    const ns = options.namespace || this.config.defaultNamespace;
    const results = await this._adapterFor(ns).search(query, options);
    return results.map((r) => ({ ...r, namespace: ns }));
  }

  async backup(destination) {
    if (typeof this.adapter.backup === 'function') return this.adapter.backup(destination);
    return { skipped: true };
  }

  async restore(source) {
    if (typeof this.adapter.restore === 'function') return this.adapter.restore(source);
    return { skipped: true };
  }

  _adapterFor(ns) {
    return this.namespaces.get(ns) || this.adapter;
  }

  _key(ns, key) {
    return `${ns}:${key}`;
  }
}

class MemoryNamespace {
  constructor(bus, name) {
    this.bus = bus;
    this.name = name;
  }

  set(key, value, options) {
    return this.bus.set(key, value, { namespace: this.name, ...options });
  }

  get(key, options) {
    return this.bus.get(key, { namespace: this.name, ...options });
  }

  delete(key, options) {
    return this.bus.delete(key, { namespace: this.name, ...options });
  }

  search(query, options) {
    return this.bus.search(query, { namespace: this.name, ...options });
  }
}

class InMemoryAdapter {
  constructor() {
    this.store = new Map();
  }

  async set(key, value) {
    this.store.set(key, value);
    return true;
  }

  async get(key) {
    return this.store.get(key);
  }

  async delete(key) {
    return this.store.delete(key);
  }

  async search(query) {
    const results = [];
    for (const [k, v] of this.store) {
      const str = JSON.stringify(v);
      if (str.includes(query)) {
        results.push({ key: k, value: v, score: 1 });
      }
    }
    return results;
  }
}

class JsonFileAdapter {
  constructor(options = {}) {
    this.filePath = options.filePath || path.resolve(__dirname, '../../data/memory-bus.json');
    this.store = new Map();
  }

  async initialize() {
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      this.store = new Map(Object.entries(data));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  async set(key, value) {
    this.store.set(key, value);
    await this._save();
    return true;
  }

  async get(key) {
    return this.store.get(key);
  }

  async delete(key) {
    const removed = this.store.delete(key);
    if (removed) await this._save();
    return removed;
  }

  async search(query) {
    const results = [];
    for (const [k, v] of this.store) {
      const str = JSON.stringify(v);
      if (str.includes(query)) results.push({ key: k, value: v, score: 1 });
    }
    return results;
  }

  async backup(destination) {
    await fs.writeFile(destination, JSON.stringify(Object.fromEntries(this.store), null, 2));
    return { backedUp: true };
  }

  async restore(source) {
    const data = JSON.parse(await fs.readFile(source, 'utf8'));
    this.store = new Map(Object.entries(data));
    await this._save();
    return { restored: true };
  }

  async _save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(Object.fromEntries(this.store), null, 2));
  }
}

class SqliteMemoryAdapter {
  constructor(options = {}) {
    this.filePath = options.filePath || path.resolve(__dirname, '../../data/memory-bus.sqlite');
    this.db = null;
  }

  async initialize() {
    let sqlite3;
    try {
      sqlite3 = require('sqlite3').verbose();
    } catch {
      throw new Error('sqlite3 is required for SqliteMemoryAdapter; install it or use InMemoryAdapter/JsonFileAdapter');
    }
    this.db = new sqlite3.Database(this.filePath);
    await this._run('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)');
    await this._run('CREATE INDEX IF NOT EXISTS idx_kv_value ON kv(value)');
  }

  async set(key, value) {
    await this._run('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
    return true;
  }

  async get(key) {
    const row = await this._get('SELECT value FROM kv WHERE key = ?', [key]);
    return row ? JSON.parse(row.value) : undefined;
  }

  async delete(key) {
    const info = await this._run('DELETE FROM kv WHERE key = ?', [key]);
    return info?.changes > 0;
  }

  async search(query) {
    const like = `%${query.replace(/[%_]/g, (c) => `\\${c}`)}%`;
    const rows = await this._all('SELECT key, value FROM kv WHERE value LIKE ? ESCAPE "\\"', [like]);
    return rows.map((r) => ({ key: r.key, value: JSON.parse(r.value), score: 1 }));
  }

  async backup(destination) {
    await this._run('VACUUM');
    await fs.copyFile(this.filePath, destination);
    return { backedUp: true };
  }

  async restore(source) {
    await fs.copyFile(source, this.filePath);
    await this.initialize();
    return { restored: true };
  }

  close() {
    return new Promise((resolve, reject) => {
      if (!this.db) return resolve();
      this.db.close((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  _run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve({ changes: this.changes });
      });
    });
  }

  _get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
  }

  _all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  }
}

MemoryBus.InMemoryAdapter = InMemoryAdapter;
MemoryBus.JsonFileAdapter = JsonFileAdapter;
MemoryBus.SqliteMemoryAdapter = SqliteMemoryAdapter;

module.exports = MemoryBus;
