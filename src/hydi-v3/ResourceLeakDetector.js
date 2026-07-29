'use strict';

const { EventEmitter } = require('events');
const os = require('os');

/**
 * ResourceLeakDetector samples resource usage over time and detects
 * growing leaks in memory, file descriptors, and other tracked handles.
 */
class ResourceLeakDetector extends EventEmitter {
  constructor(config = {}) {
    super();
    this.samples = [];
    this.maxSamples = config.maxSamples || 1440;
    this.growthThreshold = config.growthThreshold || 0.05; // 5% per sample
    this.minSamples = config.minSamples || 5;
    this.intervalMs = config.intervalMs || 1000;
    this.timer = null;
    this.trackers = new Map();
    this.lifecycleRegistry = config.lifecycleRegistry || null;
  }

  start() {
    if (this.timer) return this;
    this.timer = setInterval(() => this.sample(), this.intervalMs).unref();
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

  sample() {
    const mem = process.memoryUsage();
    const snapshot = {
      at: Date.now(),
      rss: mem.rss,
      heapTotal: mem.heapTotal,
      heapUsed: mem.heapUsed,
      external: mem.external,
      loadAvg: os.loadavg()[0],
    };
    this.samples.push(snapshot);
    if (this.samples.length > this.maxSamples) this.samples.shift();

    for (const [name, tracker] of this.trackers) {
      const value = tracker.value();
      tracker.samples.push({ at: snapshot.at, value });
      if (tracker.samples.length > this.maxSamples) tracker.samples.shift();
      this._checkGrowth(name, tracker);
    }

    this._checkMemoryGrowth(snapshot);
    this.emit('sample', snapshot);
    return snapshot;
  }

  track(name, valueFn) {
    this.trackers.set(name, { value: valueFn, samples: [] });
    return this;
  }

  _checkMemoryGrowth(snapshot) {
    if (this.samples.length < this.minSamples) return;
    const first = this.samples[0].heapUsed;
    const current = snapshot.heapUsed;
    const growth = (current - first) / first;
    if (growth >= this.growthThreshold) {
      const report = { kind: 'heap', growth: parseFloat(growth.toFixed(2)), from: first, to: current };
      this._audit('leak_detected', report);
      this.emit('leak_detected', report);
    }
  }

  _checkGrowth(name, tracker) {
    if (tracker.samples.length < this.minSamples) return;
    const first = tracker.samples[0].value;
    const current = tracker.samples[tracker.samples.length - 1].value;
    if (first <= 0) return;
    const growth = (current - first) / first;
    if (growth >= this.growthThreshold) {
      const report = { kind: name, growth: parseFloat(growth.toFixed(2)), from: first, to: current };
      this._audit('leak_detected', report);
      this.emit('leak_detected', report);
    }
  }

  getTrend() {
    if (this.samples.length < 2) return null;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    return {
      heapGrowth: last.heapUsed - first.heapUsed,
      rssGrowth: last.rss - first.rss,
      samples: this.samples.length,
    };
  }

  _audit(action, report) {
    const entry = { at: Date.now(), action, ...report };
    if (this.lifecycleRegistry) this.lifecycleRegistry.recordProposal(entry);
    this.emit('audit', entry);
  }
}

module.exports = ResourceLeakDetector;
