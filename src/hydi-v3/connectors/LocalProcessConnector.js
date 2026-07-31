'use strict';

const BaseConnector = require('./BaseConnector');

class LocalProcessConnector extends BaseConnector {
  constructor(config = {}) {
    super(config);
    this.capabilities = ['ProcessHeartbeat'];
    this.intervalMs = config.intervalMs || 30000;
  }

  async start() {
    if (!this._isEnabled()) {
      this._notConfigured('disabled');
      return;
    }
    if (this.eventBus && this.eventBus.registry) {
      this.eventBus.registry.register('ProcessHeartbeat', this.name);
      this.eventBus.registry.declareIgnored('ProcessHeartbeat', 'process telemetry not interpreted as business signal');
    }
    this._emitHeartbeat();
    this._timer = setInterval(() => this._emitHeartbeat(), this.intervalMs);
    if (this._timer.unref) this._timer.unref();
    this.state = 'running';
  }

  async stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this.state = 'stopped';
  }

  _emitHeartbeat() {
    this._emit('ProcessHeartbeat', {
      pid: process.pid,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpuUsage: process.cpuUsage ? process.cpuUsage() : null,
      timestamp: Date.now(),
    });
  }

  healthCheck() {
    if (this.state !== 'running') {
      return super.healthCheck();
    }
    const base = super.healthCheck();
    return { ...base, ok: this.state === 'running' };
  }
}

module.exports = LocalProcessConnector;
