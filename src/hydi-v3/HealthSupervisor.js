'use strict';

const { EventEmitter } = require('events');

/**
 * HealthSupervisor continuously monitors subsystem health signals, detects
 * degradation, and recommends or triggers automatic degradation modes.
 */
class HealthSupervisor extends EventEmitter {
  constructor(config = {}) {
    super();
    this.subsystems = new Map();
    this.thresholds = {
      healthy: config.healthyThreshold || 0.8,
      degraded: config.degradedThreshold || 0.5,
      ...config.thresholds,
    };
    this.intervalMs = config.intervalMs || 5000;
    this.timer = null;
    this.logger = config.logger || console;
    this.lifecycleRegistry = config.lifecycleRegistry || null;
  }

  start() {
    if (this.timer) return this;
    this.timer = setInterval(() => this.evaluate(), this.intervalMs).unref();
    this.emit('started');
    return this;
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.emit('stopped');
    return this;
  }

  register(name, source) {
    this.subsystems.set(name, { source, history: [], state: 'unknown' });
    this.emit('registered', { name });
    return this;
  }

  record(name, health) {
    const sub = this.subsystems.get(name);
    if (!sub) {
      this.register(name, null);
    }
    const entry = { at: Date.now(), health: Math.max(0, Math.min(1, health)) };
    this.subsystems.get(name).history.push(entry);
    if (this.subsystems.get(name).history.length > 1440) {
      this.subsystems.get(name).history.shift();
    }
    this.evaluate(name);
    return this;
  }

  evaluate(name) {
    const targets = name ? [name] : Array.from(this.subsystems.keys());
    const results = [];
    for (const n of targets) {
      const sub = this.subsystems.get(n);
      const recent = sub.history.slice(-10);
      const avg = recent.length ? recent.reduce((a, b) => a + b.health, 0) / recent.length : 0;
      let state = 'healthy';
      if (avg < this.thresholds.degraded) state = 'critical';
      else if (avg < this.thresholds.healthy) state = 'degraded';

      const previous = sub.state;
      sub.state = state;
      sub.lastHealth = avg;

      const result = { name: n, state, health: avg, previous };
      results.push(result);

      if (state !== previous) {
        this.emit('state_changed', result);
        this._audit('state_changed', result);
        if (state === 'critical') {
          this.emit('degradation_recommended', result);
        }
      }
    }
    return results;
  }

  getStatus() {
    const subs = Array.from(this.subsystems.entries()).map(([name, sub]) => ({
      name,
      state: sub.state,
      health: sub.lastHealth || 0,
      samples: sub.history.length,
    }));
    const overall = subs.length
      ? subs.reduce((a, s) => a + (s.health || 0), 0) / subs.length
      : 0;
    return { overall, state: this._overallState(overall), subsystems: subs };
  }

  _overallState(health) {
    if (health < this.thresholds.degraded) return 'critical';
    if (health < this.thresholds.healthy) return 'degraded';
    return 'healthy';
  }

  _audit(action, result) {
    const entry = { at: Date.now(), action, ...result };
    if (this.lifecycleRegistry) this.lifecycleRegistry.recordProposal(entry);
    this.emit('audit', entry);
  }
}

module.exports = HealthSupervisor;
