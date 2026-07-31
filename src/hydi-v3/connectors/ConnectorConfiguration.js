'use strict';

const fs = require('fs').promises;
const path = require('path');

class ConnectorConfiguration {
  constructor(dataPath) {
    this.dataPath = dataPath || path.resolve(__dirname, '../../../data');
    this.configPath = path.join(this.dataPath, 'connectors.json');
    this.config = {};
  }

  async load() {
    try {
      const text = await fs.readFile(this.configPath, 'utf8');
      this.config = JSON.parse(text);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      this.config = {};
    }
    return this.config;
  }

  get(name) {
    return this.config[name] || {};
  }

  set(name, value) {
    this.config[name] = value;
  }

  async save() {
    await fs.mkdir(this.dataPath, { recursive: true });
    await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
  }
}

module.exports = ConnectorConfiguration;
