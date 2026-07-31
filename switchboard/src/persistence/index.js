const path = require('path');
const fs = require('fs');
const { JsonStore } = require('./json-store');
const { MemoryStore } = require('./memory-store');

function createStore(options = {}) {
  const type = options.type || process.env.SWITCHBOARD_STORE || 'json';
  if (type === 'memory') return new MemoryStore(options.initial || {});

  const dataDir = options.dataDir || path.join(__dirname, '..', '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const filePath = options.filePath || path.join(dataDir, 'db.json');
  const backupDir = options.backupDir || path.join(dataDir, 'backups');
  return new JsonStore({ filePath, backupDir, logger: options.logger, onCorruption: options.onCorruption });
}

module.exports = { createStore, JsonStore, MemoryStore };
