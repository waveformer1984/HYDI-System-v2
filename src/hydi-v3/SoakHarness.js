'use strict';

const { EventEmitter } = require('events');

/**
 * SoakHarness runs repeated operational cycles to expose issues that only
 * appear after prolonged use. Cycles are configurable and report pass/fail
 * counts and latency.
 */
class SoakHarness extends EventEmitter {
  constructor(config = {}) {
    super();
    this.defaultDurationMs = config.durationMs || 5000;
    this.defaultMaxIterations = config.maxIterations || null;
    this.cooldownMs = config.cooldownMs || 0;
    this.logger = config.logger || console;
    this.context = config.context || null;
  }

  async run(scenarios = [], options = {}) {
    const duration = options.durationMs || this.defaultDurationMs;
    const max = options.maxIterations || this.defaultMaxIterations;
    const report = {
      startedAt: Date.now(),
      duration,
      maxIterations: max,
      scenarios: [],
      totalIterations: 0,
      failures: 0,
    };

    for (const s of scenarios) {
      const name = typeof s === 'string' ? s : s.name;
      const handler = this._handler(name);
      const row = {
        name,
        iterations: 0,
        failures: 0,
        latency: [],
      };
      const endAt = report.startedAt + duration;
      let i = 0;
      while ((max === null || i < max) && Date.now() < endAt) {
        i += 1;
        const start = process.hrtime.bigint();
        try {
          const result = await handler(i);
          this.emit('cycle', { scenario: name, iteration: i, result });
        } catch (err) {
          row.failures += 1;
          report.failures += 1;
          this.emit('cycle_failure', { scenario: name, iteration: i, error: err.message });
        }
        const ms = Number(process.hrtime.bigint() - start) / 1_000_000;
        row.latency.push(ms);
        row.iterations += 1;
        report.totalIterations += 1;
        if (this.cooldownMs) await this._sleep(this.cooldownMs);
      }
      row.meanLatency = row.latency.length ? row.latency.reduce((a, b) => a + b, 0) / row.latency.length : 0;
      report.scenarios.push(row);
    }

    report.finishedAt = Date.now();
    this.emit('complete', report);
    return report;
  }

  _handler(name) {
    const ctx = this.context;
    if (ctx && typeof ctx[name] === 'function') return ctx[name].bind(ctx);
    switch (name) {
      case 'federationJoinLeave':
        return (i) => ({ action: 'federation', state: i % 2 === 0 ? 'joined' : 'left' });
      case 'snapshotRestore':
        return (i) => ({ action: 'snapshot', op: i % 2 === 0 ? 'snapshot' : 'restore' });
      case 'marketplaceInstallRemove':
        return (i) => ({ action: 'marketplace', op: i % 2 === 0 ? 'install' : 'remove' });
      case 'crashRecover':
        return (i) => {
          if (i % 7 === 0) throw new Error('simulated crash');
          return { action: 'crash', recovered: true };
        };
      default:
        return () => ({ action: 'noop' });
    }
  }

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

module.exports = SoakHarness;
