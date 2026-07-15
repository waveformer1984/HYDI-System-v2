'use strict';

const fs = require('fs').promises;
const path = require('path');

/**
 * CheckpointStore saves and restores execution state for graceful shutdown and recovery.
 */
class CheckpointStore {
  constructor(config = {}) {
    this.config = {
      storagePath: config.storagePath || path.resolve(__dirname, '../../data/checkpoints'),
      ...config,
    };
  }

  async initialize() {
    await fs.mkdir(this.config.storagePath, { recursive: true });
  }

  async saveCheckpoint(state) {
    await this.initialize();
    const file = path.join(this.config.storagePath, 'latest.json');
    const payload = {
      timestamp: new Date().toISOString(),
      ...state,
    };
    await fs.writeFile(file, JSON.stringify(payload, null, 2));
    return payload;
  }

  async loadCheckpoint() {
    const file = path.join(this.config.storagePath, 'latest.json');
    try {
      const data = await fs.readFile(file, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }
}

module.exports = CheckpointStore;
