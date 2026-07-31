'use strict';

const BaseConnector = require('./BaseConnector');
const GitSensor = require('../GitSensor');

class GitConnector extends BaseConnector {
  constructor(config = {}) {
    super(config);
    this.capabilities = [
      'CommitCreated', 'BranchCreated', 'BranchDeleted',
      'WorkingTreeDirty', 'WorkingTreeClean', 'BranchStale',
    ];
  }

  async start() {
    if (!this._isEnabled()) {
      this._notConfigured('disabled');
      return;
    }
    this.sensor = new GitSensor({
      cwd: this.config.cwd,
      project: this.config.project,
      dataPath: this.dataPath,
      pollIntervalMs: this.config.pollIntervalMs,
      logger: this.logger,
      eventBus: this.eventBus,
    });
    await this.sensor.start();
    if (this.sensor.available) {
      this.state = 'running';
    } else {
      this._notConfigured(this.sensor.unavailableReason || 'git not available');
    }
  }

  async stop() {
    if (this.sensor) {
      this.sensor.stop();
    }
    this.state = 'stopped';
  }

  healthCheck() {
    if (this.state !== 'running') {
      return super.healthCheck();
    }
    if (!this.sensor || typeof this.sensor.healthCheck !== 'function') {
      return { ...super.healthCheck(), ok: false, detail: 'sensor not initialized' };
    }
    const h = this.sensor.healthCheck();
    const base = super.healthCheck();
    return { ...base, ok: h.ok, detail: h.reason || h.detail || '' };
  }
}

module.exports = GitConnector;
