'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

/**
 * PerformanceBaseline captures repeatable performance measurements and stores
 * them for regression comparison.
 */
class PerformanceBaseline extends EventEmitter {
  constructor(config = {}) {
    super();
    this.storagePath = config.storagePath || path.join(process.cwd(), 'data', 'performance-baseline.json');
    this.operations = config.operations || this._defaultOperations();
  }

  _defaultOperations() {
    return {
      startup: async () => ({ ms: 1 }),
      federationConnect: async () => ({ ms: 1 }),
      scheduling: async () => ({ ms: 1 }),
      marketplaceInstall: async () => ({ ms: 1 }),
      snapshot: async () => ({ ms: 1 }),
      restore: async () => ({ ms: 1 }),
      recovery: async () => ({ ms: 1 }),
      throughput: async () => ({ tasks: 1, ms: 1 }),
    };
  }

  async capture(runs = 3) {
    const ts = Date.now();
    const report = { ts, runs, operations: {} };
    for (const [name, op] of Object.entries(this.operations)) {
      const samples = [];
      for (let i = 0; i < runs; i += 1) {
        const start = process.hrtime.bigint();
        const result = await op();
        const ms = Number(process.hrtime.bigint() - start) / 1_000_000;
        samples.push({ ...result, ms });
      }
      const mean = samples.reduce((a, s) => a + s.ms, 0) / samples.length;
      report.operations[name] = {
        mean,
        min: Math.min(...samples.map((s) => s.ms)),
        max: Math.max(...samples.map((s) => s.ms)),
        samples,
      };
    }
    this.emit('captured', report);
    return report;
  }

  save(report) {
    const dir = path.dirname(this.storagePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.storagePath, JSON.stringify(report, null, 2));
    this.emit('saved', this.storagePath);
    return this.storagePath;
  }

  load() {
    if (!fs.existsSync(this.storagePath)) return null;
    return JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
  }

  compare(current, baseline) {
    const comparison = {};
    for (const [name, cur] of Object.entries(current.operations)) {
      const base = baseline && baseline.operations ? baseline.operations[name] : null;
      const delta = base ? cur.mean - base.mean : 0;
      const pct = base && base.mean ? (delta / base.mean) * 100 : null;
      comparison[name] = {
        current: cur.mean,
        baseline: base ? base.mean : null,
        delta,
        pct,
        regression: base ? delta > base.mean * 0.1 : false,
      };
    }
    this.emit('compared', { current, baseline, comparison });
    return { ts: Date.now(), comparison };
  }
}

module.exports = PerformanceBaseline;
