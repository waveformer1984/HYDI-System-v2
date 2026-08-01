const crypto = require('crypto');
const { createStore } = require('./persistence');
const { EventBus, MemoryTransport } = require('./events/event-bus');
const { ValidationError, NotFoundError, ConflictError } = require('./errors');
const { requireString } = require('./validation');

function now() { return new Date().toISOString(); }
function id() { return crypto.randomUUID(); }

function ensureFound(record, message) {
  if (!record) throw new NotFoundError(message);
  return record;
}

class Repository {
  constructor(store, eventBus, logger) {
    this.store = store;
    this.eventBus = eventBus || new EventBus();
    this.logger = logger || { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  }

  async init() { await this.store.init(); }

  createRecord(input) {
    const name = requireString(input, 'name');
    const record = { id: id(), name, status: 'active', created_at: now() };
    this.store.create('records', record);
    this.eventBus.emit('record.created', record);
    this.logger.info('repository', 'record.created', `Record ${record.id} created`);
    return { ...record };
  }

  getRecord(id) {
    return ensureFound(this.store.getById('records', id), 'Record not found');
  }

  listRecords() {
    return this.store.getAll('records');
  }

  updateRecord(id, input) {
    const old = ensureFound(this.store.getById('records', id), 'Record not found');
    const updated = { ...old };
    if (input.name != null) updated.name = requireString(input, 'name');
    this.store.update('records', id, updated);
    this.eventBus.emit('record.updated', updated);
    this.logger.info('repository', 'record.updated', `Record ${id} updated`);
    return { ...updated };
  }

  deleteRecord(id) {
    const old = ensureFound(this.store.getById('records', id), 'Record not found');
    this.store.delete('records', id);
    this.eventBus.emit('record.deleted', { id });
    this.logger.info('repository', 'record.deleted', `Record ${id} deleted`);
    return { ...old };
  }
}

function createRepository(options = {}) {
  const config = options.config || require('./config').createConfig();
  const logger = options.logger || require('./logger').createLogger(config);
  const transports = [new MemoryTransport()];
  if (config.eventLogPath) transports.push(new (require('./events/event-bus').FileTransport)(config.eventLogPath));
  const store = options.store || createStore({ type: 'memory' });
  const eventBus = options.eventBus || new EventBus(transports);
  const repo = new Repository(store, eventBus, logger);
  return repo;
}

module.exports = { Repository, createRepository };
