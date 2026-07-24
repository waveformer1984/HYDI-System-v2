'use strict';

const fs = require('fs').promises;
const path = require('path');

/**
 * Telemetry collects and persists kernel metrics and traces.
 */
class Telemetry {
  constructor(kernel, options = {}) {
    this.kernel = kernel;
    this.config = {
      storagePath: options.storagePath || path.resolve(__dirname, '../../data/telemetry'),
      historyLimit: options.historyLimit || 10000,
      flushIntervalMs: options.flushIntervalMs || 60000,
      ...options,
    };
    this.metrics = new Map();
    this.traces = [];
    this._flushTimer = null;
  }

  start() {
    if (this._flushTimer) return;
    this._flushTimer = setInterval(() => this.flush().catch(() => {}), this.config.flushIntervalMs);
    if (this._flushTimer.unref) this._flushTimer.unref();
  }

  stop() {
    if (this._flushTimer) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }
  }

  record(name, value, tags = {}) {
    if (!this.metrics.has(name)) this.metrics.set(name, []);
    const series = this.metrics.get(name);
    series.push({ timestamp: Date.now(), value, tags });
    while (series.length > this.config.historyLimit) series.shift();
  }

  gauge(name, value, tags) {
    this.record(name, value, { ...tags, type: 'gauge' });
  }

  increment(name, delta = 1, tags) {
    this.record(name, delta, { ...tags, type: 'counter' });
  }

  trace(id, span, durationMs, tags = {}) {
    this.traces.push({ id, span, durationMs, timestamp: Date.now(), tags });
    while (this.traces.length > this.config.historyLimit) this.traces.shift();
  }

  getSummary(names) {
    const keys = names || Array.from(this.metrics.keys());
    const result = {};
    for (const key of keys) {
      const series = this.metrics.get(key) || [];
      const values = series.map((s) => s.value);
      result[key] = {
        count: values.length,
        last: series[series.length - 1] || null,
        min: values.length ? Math.min(...values) : 0,
        max: values.length ? Math.max(...values) : 0,
        avg: values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0,
      };
    }
    return result;
  }

  async flush() {
    try {
      await fs.mkdir(this.config.storagePath, { recursive: true });
      const payload = {
        flushedAt: new Date().toISOString(),
        metrics: Object.fromEntries(this.metrics),
        traces: this.traces,
      };
      await fs.writeFile(path.join(this.config.storagePath, 'latest.json'), JSON.stringify(payload, null, 2));
    } catch (err) {
      this.kernel?.eventBus?.emit('telemetry_flush_error', { error: err.message });
    }
  }
}

module.exports = Telemetry;
