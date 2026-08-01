const { Store, defaultTables, SCHEMA_VERSION } = require('./store');

class MemoryStore extends Store {
  constructor(initial = {}) {
    super();
    this.state = { schemaVersion: SCHEMA_VERSION };
    for (const [k, v] of Object.entries(defaultTables)) {
      this.state[k] = initial[k] ? [...initial[k]] : [];
    }
  }

  async init() { return true; }

  create(table, record) {
    if (!this.state[table]) this.state[table] = [];
    this.state[table].push(record);
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
    if (idx >= 0) arr[idx] = record;
  }

  delete(table, id) {
    const arr = this.state[table] || [];
    const idx = arr.findIndex(r => r.id === id);
    if (idx >= 0) arr.splice(idx, 1);
  }

  load() {
    return JSON.parse(JSON.stringify(this.state));
  }
}

function createStore(options = {}) {
  return new MemoryStore(options.initial || {});
}

module.exports = { MemoryStore, createStore };
