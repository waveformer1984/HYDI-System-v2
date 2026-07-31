const { Store } = require('./store');

const defaultTables = {
  users: [],
  venues: [],
  gigs: [],
  availability: [],
  applications: [],
  messages: [],
  contracts: [],
  payments: [],
  ratings: [],
  audit_log: []
};

class MemoryStore extends Store {
  constructor(initial = {}) {
    super();
    this.state = {};
    Object.keys(defaultTables).forEach(k => { this.state[k] = initial[k] ? [...initial[k]] : []; });
    this.state.schemaVersion = initial.schemaVersion || 1;
    this.state.updatedAt = new Date().toISOString();
  }

  init() { return this.state; }
  load() { return this.state; }
  save() { this.state.updatedAt = new Date().toISOString(); }

  getAll(table) { return (this.state[table] || []).slice(); }
  getById(table, id) { return (this.state[table] || []).find(r => r.id === id); }

  create(table, record) {
    if (!this.state[table]) this.state[table] = [];
    this.state[table].push(record);
    return record;
  }

  update(table, id, record) {
    if (!this.state[table]) return null;
    const idx = this.state[table].findIndex(r => r.id === id);
    if (idx === -1) return null;
    this.state[table][idx] = record;
    return record;
  }

  delete(table, id) {
    if (!this.state[table]) return false;
    const len = this.state[table].length;
    this.state[table] = this.state[table].filter(r => r.id !== id);
    return this.state[table].length !== len;
  }

  reset() {
    Object.keys(defaultTables).forEach(k => { this.state[k] = []; });
    this.state.schemaVersion = 1;
    this.state.updatedAt = new Date().toISOString();
  }
}

module.exports = { MemoryStore };
