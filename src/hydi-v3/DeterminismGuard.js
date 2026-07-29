'use strict';

const { EventEmitter } = require('events');

/**
 * DeterminismGuard runs a function repeatedly and reports whether its output
 * remains stable across runs. This is used to identify flaky state or race
 * conditions.
 */
class DeterminismGuard extends EventEmitter {
  constructor(config = {}) {
    super();
    this.iterations = config.iterations || 10;
    this.concurrency = config.concurrency || 1;
    this.maxVariance = config.maxVariance || 0;
  }

  async run(fn, options = {}) {
    const iterations = options.iterations || this.iterations;
    const results = [];
    for (let i = 0; i < iterations; i += 1) {
      try {
        const value = await fn();
        results.push({ iteration: i, value, success: true });
      } catch (err) {
        results.push({ iteration: i, error: err instanceof Error ? err.message : String(err), success: false });
      }
    }

    const failures = results.filter((r) => !r.success);
    const values = results.filter((r) => r.success).map((r) => r.value);
    const stable = values.length > 0 && this._allEqual(values);
    const report = {
      iterations,
      success: failures.length === 0 && stable,
      stable,
      failures: failures.length,
      uniqueResults: this._uniqueCount(values),
    };
    this.emit('report', report);
    return report;
  }

  _allEqual(values) {
    if (values.length <= 1) return true;
    const first = JSON.stringify(values[0]);
    return values.every((v) => JSON.stringify(v) === first);
  }

  _uniqueCount(values) {
    return new Set(values.map((v) => JSON.stringify(v))).size;
  }
}

module.exports = DeterminismGuard;
