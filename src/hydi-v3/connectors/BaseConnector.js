'use strict';

const { EventEmitter } = require('events');

class BaseConnector extends EventEmitter {
  constructor(config = {}) {
    super();
    this.name = config.name || this.constructor.name.replace('Connector', '').toLowerCase();
    this.eventBus = config.eventBus || null;
    this.dataPath = config.dataPath;
    this.logger = config.logger || { log: () => {}, warn: () => {}, error: () => {} };
    this.config = config.configuration || {};
    this.context = config.context || {};
    this.state = 'stopped';
    this.lastError = null;
    this.metrics = { emitted: 0, errors: 0 };
    this.capabilities = [];
    this._requiredCredentials = config.requiredCredentials || [];
  }

  configure(configuration) {
    this.config = { ...this.config, ...configuration };
    return this;
  }

  async start() {
    throw new Error('start() must be implemented by the connector subclass');
  }

  async stop() {
    this.state = 'stopped';
  }

  healthCheck() {
    const ok = ['running', 'configured', 'not_configured'].includes(this.state);
    return {
      ok,
      name: this.name,
      state: this.state,
      capabilities: this.capabilities,
      metrics: { ...this.metrics },
      lastError: this.lastError ? this.lastError.message : null,
    };
  }

  async reconnect() {
    if (this.state === 'not_configured') return this.healthCheck();
    await this.stop();
    await this.start();
    return this.healthCheck();
  }

  status() {
    return {
      name: this.name,
      state: this.state,
      capabilities: this.capabilities,
      metrics: { ...this.metrics },
      lastError: this.lastError ? this.lastError.message : null,
    };
  }

  getCapabilities() {
    return this.capabilities;
  }

  capabilities() {
    return this.capabilities;
  }

  _emit(type, payload, source = this.name) {
    this.metrics.emitted += 1;
    if (this.eventBus) {
      this.eventBus.emit(type, payload, source);
    }
    this.emit('event', { type, payload, source });
  }

  _setError(error) {
    this.lastError = error;
    this.metrics.errors += 1;
    this.state = 'error';
    this.logger.error(`[${this.name}] ${error instanceof Error ? error.message : String(error)}`);
  }

  _isEnabled() {
    return this.config.enabled !== false;
  }

  _hasCredentials(keys) {
    return keys.every((k) => this.config[k] || process.env[k]);
  }

  _notConfigured(reason) {
    this.state = 'not_configured';
    this.lastError = new Error(reason);
    this.logger.log(`[${this.name}] not configured: ${reason}`);
  }

  _configured() {
    this.state = 'configured';
  }
}

module.exports = BaseConnector;
