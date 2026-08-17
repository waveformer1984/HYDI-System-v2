const fs = require('fs');
const path = require('path');
const { Store, defaultTables, SCHEMA_VERSION } = require('./store');

class JsonStore extends Store {
  constructor({ filePath, dataDir, logger = { warn: () => {}, error: () => {} } } = {}) {
    super();
    this.filePath = filePath || path.join(dataDir || path.join(__dirname, '..', '..', 'data'), 'db.json');
    this.logger = logger;
    this.state = { schemaVersion: SCHEMA_VERSION };
    for (const [k, v] of Object.entries(defaultTables)) this.state[k] = [...v];
  }

  async init() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.state = { ...this.state, ...parsed };
      if (!this.state.schemaVersion || this.state.schemaVersion < SCHEMA_VERSION) this.migrate();
    } catch (err) {
      if (err.code !== 'ENOENT') this.logger.warn('persistence', 'load.warn', err.message);
    }
    this.flush();
    return true;
  }

  migrate() {
    this.state.schemaVersion = SCHEMA_VERSION;
    for (const [k, v] of Object.entries(defaultTables)) {
      if (!Array.isArray(this.state[k])) this.state[k] = [...v];
    }
  }

  flush() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  create(table, record) {
    if (!this.state[table]) this.state[table] = [];
    this.state[table].push(record);
    this.flush();
  }

  getById(table, id) {
    return (this.state[table] || []).find(r => r.id === id) || null;
  }

  getAll(table) {
    return (this.state[table] || []).slice();
  }

  update(table, id, record) {
    const arr = this.state[table] || [];
    const idx = arr.findIndex(r => r.id === id);
    if (idx >= 0) { arr[idx] = record; this.flush(); }
  }

  delete(table, id) {
    const arr = this.state[table] || [];
    const idx = arr.findIndex(r => r.id === id);
    if (idx >= 0) { arr.splice(idx, 1); this.flush(); }
  }

  load() {
    return JSON.parse(JSON.stringify(this.state));
  }
}

function createStore(options = {}) {
  return new JsonStore(options);
}

module.exports = { JsonStore, createStore };
