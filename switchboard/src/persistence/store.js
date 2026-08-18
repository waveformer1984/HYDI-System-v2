class Store {
  async init() { throw new Error('init not implemented'); }
  async load() { throw new Error('load not implemented'); }
  async save(state) { throw new Error('save not implemented'); }

  getAll(table) { throw new Error('getAll not implemented'); }
  getById(table, id) { throw new Error('getById not implemented'); }
  create(table, record) { throw new Error('create not implemented'); }
  update(table, id, record) { throw new Error('update not implemented'); }
  delete(table, id) { throw new Error('delete not implemented'); }
}

module.exports = { Store };
