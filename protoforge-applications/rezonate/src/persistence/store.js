const SCHEMA_VERSION = 1;

const defaultTables = {
  projects: [],
  tracks: [],
  assets: [],
  processing_jobs: [],
  ownership_records: [],
  rights: [],
  audit_log: []
};

class Store {
  constructor() {}
  async init() {}
  create(table, record) { throw new Error('Not implemented'); }
  getById(table, id) { throw new Error('Not implemented'); }
  getAll(table) { throw new Error('Not implemented'); }
  update(table, id, record) { throw new Error('Not implemented'); }
  delete(table, id) { throw new Error('Not implemented'); }
  load() { throw new Error('Not implemented'); }
}

module.exports = { Store, SCHEMA_VERSION, defaultTables };
