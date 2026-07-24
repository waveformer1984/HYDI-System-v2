'use strict';

const { EventEmitter } = require('events');

/**
 * HealthMonitor periodically checks module health and emits aggregate status.
 */
class HealthMonitor extends EventEmitter {
  constructor(kernel, options = {}) {
    super();
    this.kernel = kernel;
    this.config = {
      intervalMs: options.intervalMs || 30000,
      ...options,
    };
    this._timer = null;
    this._last = {};
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this.check(), this.config.intervalMs);
    if (this._timer.unref) this._timer.unref();
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async check() {
    const modules = this.kernel.moduleRegistry?.list() || [];
    const status = {};
    let healthy = 0;
    let degraded = 0;
    let failed = 0;

    for (const m of modules) {
      try {
        const h = await this.kernel.moduleRegistry.get(m.id).health();
        status[m.id] = h;
        if (h.healthy === true) healthy += 1;
        else if (h.healthy === false) failed += 1;
        else degraded += 1;
      } catch (err) {
        status[m.id] = { healthy: false, error: err.message };
        failed += 1;
      }
    }

    const aggregate = { healthy, degraded, failed, total: modules.length, modules: status };
    this._last = aggregate;
    this.emit('health', aggregate);
    return aggregate;
  }

  getLast() {
    return this._last;
  }
}

module.exports = HealthMonitor;
