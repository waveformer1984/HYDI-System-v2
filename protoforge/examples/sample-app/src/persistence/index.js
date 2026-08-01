const { MemoryStore, createStore: createMemoryStore } = require('./memory-store');
const { JsonStore, createStore: createJsonStore } = require('./json-store');

function createStore(options = {}) {
  if (options.type === 'memory' || !options.filePath) return createMemoryStore(options);
  return createJsonStore(options);
}

module.exports = { createStore, MemoryStore, JsonStore };
