'use strict';

const BaseConnector = require('./BaseConnector');
const FilesystemMonitor = require('../FilesystemMonitor');

class FilesystemConnector extends BaseConnector {
  constructor(config = {}) {
    super(config);
    this.capabilities = [
      'ProjectOpened', 'ProjectActive',
      'FileCreated', 'FileModified', 'FileDeleted',
      'DirectoryCreated', 'DirectoryDeleted',
    ];
  }

  async start() {
    if (!this._isEnabled()) {
      this._notConfigured('disabled');
      return;
    }
    this.monitor = new FilesystemMonitor({
      roots: this.config.roots || {},
      exclude: this.config.exclude,
      scanIntervalMs: this.config.scanIntervalMs,
      watch: this.config.watch,
      eventBus: this.eventBus,
      logger: this.logger,
    });
    await this.monitor.start();
    this.state = 'running';
  }

  async stop() {
    if (this.monitor) {
      this.monitor.stop();
    }
    this.state = 'stopped';
  }

  healthCheck() {
    if (this.state !== 'running') {
      return super.healthCheck();
    }
    const fs = require('fs');
    const roots = this.config.roots || {};
    const rootsHealthy = Object.values(roots).every((root) => fs.existsSync(root));
    const ok = this.monitor && this.monitor._started && this.state === 'running' && rootsHealthy;
    const base = super.healthCheck();
    return { ...base, ok, rootsHealthy };
  }
}

module.exports = FilesystemConnector;
