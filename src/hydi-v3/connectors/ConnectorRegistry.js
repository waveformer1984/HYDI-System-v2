'use strict';

const registry = new Map();

function register(name, ConnectorClass) {
  registry.set(name, ConnectorClass);
}

function create(name, config = {}) {
  const ConnectorClass = registry.get(name);
  if (!ConnectorClass) throw new Error(`Unknown connector type: ${name}`);
  return new ConnectorClass({ ...config, name: config.name || name });
}

function list() {
  return [...registry.keys()];
}

function clear() {
  registry.clear();
}

function isRegistered(name) {
  return registry.has(name);
}

module.exports = {
  register,
  create,
  list,
  clear,
  isRegistered,
  registry,
};
