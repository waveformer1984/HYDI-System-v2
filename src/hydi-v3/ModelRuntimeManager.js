'use strict';

const { EventEmitter } = require('events');

const STATES = Object.freeze({
  UNAVAILABLE: 'UNAVAILABLE',
  LOADING: 'LOADING',
  READY: 'READY',
  BUSY: 'BUSY',
  FAILED: 'FAILED',
});

class ModelRuntimeManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      defaultTimeoutMs: config.defaultTimeoutMs ?? 30000,
      warmupPrompt: config.warmupPrompt ?? 'Say "ok".',
      maxQueueDepth: config.maxQueueDepth ?? 20,
      stallThresholdMs: config.stallThresholdMs ?? 120000,
      resourceSampleIntervalMs: config.resourceSampleIntervalMs ?? 5000,
      logger: config.logger || console,
    };
    this.models = new Map();
    this.queues = new Map();
    this.active = new Map();
    this.metrics = new Map();
    this.resourceSamples = [];
    this._monitor = null;
  }

  register(modelId) {
    if (!this.models.has(modelId)) {
      this.models.set(modelId, { state: STATES.UNAVAILABLE, lastStateAt: Date.now(), failures: 0, warm: false });
      this.queues.set(modelId, []);
      this.metrics.set(modelId, { calls: 0, errors: 0, totalLatency: 0, lastLatency: 0, tokens: 0 });
    }
  }

  setState(modelId, state) {
    this.register(modelId);
    const m = this.models.get(modelId);
    if (m.state === state) return;
    m.state = state;
    m.lastStateAt = Date.now();
    this.emit('state', { modelId, state, at: m.lastStateAt });
  }

  getState(modelId) {
    return this.models.get(modelId)?.state || STATES.UNAVAILABLE;
  }

  getMetrics(modelId) {
    return this.metrics.get(modelId) || { calls: 0, errors: 0, totalLatency: 0, lastLatency: 0, tokens: 0 };
  }

  averageLatency(modelId) {
    const m = this.getMetrics(modelId);
    return m.calls ? m.totalLatency / m.calls : 0;
  }

  adaptTimeout(modelId) {
    const avg = this.averageLatency(modelId);
    if (!avg) return this.config.defaultTimeoutMs;
    // Allow 3x average, bounded between 5s and 5m.
    return Math.min(Math.max(avg * 3, 5000), 300000);
  }

  async warmup(modelId, inferenceFn) {
    this.register(modelId);
    this.setState(modelId, STATES.LOADING);
    const start = Date.now();
    try {
      const result = await this._runWithTimeout(inferenceFn(this.config.warmupPrompt), this.config.defaultTimeoutMs);
      this.models.get(modelId).warm = true;
      this.setState(modelId, STATES.READY);
      return { ok: true, latency: Date.now() - start, result };
    } catch (e) {
      this.models.get(modelId).failures++;
      this.setState(modelId, STATES.FAILED);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async request(modelId, operation, inferenceFn) {
    this.register(modelId);
    const queue = this.queues.get(modelId);
    if (queue.length >= this.config.maxQueueDepth) {
      return { ok: false, error: `Queue full for ${modelId}` };
    }

    return new Promise((resolve) => {
      queue.push({ operation, inferenceFn, resolve });
      this._drain(modelId);
    });
  }

  async _drain(modelId) {
    if (this.active.get(modelId)) return;
    const queue = this.queues.get(modelId);
    if (!queue.length) return;
    const next = queue.shift();
    this.active.set(modelId, next);
    this.setState(modelId, STATES.BUSY);
    const start = Date.now();
    const timeout = this.adaptTimeout(modelId);
    try {
      const result = await this._runWithTimeout(next.inferenceFn(), timeout);
      const latency = Date.now() - start;
      this._record(modelId, latency, true);
      this.setState(modelId, STATES.READY);
      next.resolve({ ok: true, latency, result });
    } catch (e) {
      const latency = Date.now() - start;
      this._record(modelId, latency, false);
      this.models.get(modelId).failures++;
      this.setState(modelId, STATES.FAILED);
      next.resolve({ ok: false, latency, error: e instanceof Error ? e.message : String(e) });
    } finally {
      this.active.delete(modelId);
      setImmediate(() => this._drain(modelId));
    }
  }

  _record(modelId, latency, ok) {
    const m = this.getMetrics(modelId);
    m.calls++;
    m.totalLatency += latency;
    m.lastLatency = latency;
    if (!ok) m.errors++;
    this.metrics.set(modelId, m);
  }

  _runWithTimeout(promise, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
      Promise.resolve(promise).then((r) => { clearTimeout(timer); resolve(r); }, (e) => { clearTimeout(timer); reject(e); });
    });
  }

  start() {
    if (this._monitor) return;
    this._monitor = setInterval(() => {
      const now = Date.now();
      for (const [modelId, active] of this.active) {
        if (now - active.start > this.config.stallThresholdMs) {
          this.config.logger.error('[ModelRuntimeManager] stalled request', { modelId, operation: active.operation });
          this.models.get(modelId).failures++;
          this.setState(modelId, STATES.FAILED);
          this.emit('stalled', { modelId, operation: active.operation });
        }
      }
      this.resourceSamples.push({ at: now, ...process.memoryUsage() });
      if (this.resourceSamples.length > 1000) this.resourceSamples.shift();
    }, this.config.resourceSampleIntervalMs);
    if (this._monitor.unref) this._monitor.unref();
  }

  stop() {
    if (this._monitor) {
      clearInterval(this._monitor);
      this._monitor = null;
    }
  }

  allStates() {
    const out = {};
    for (const [id, m] of this.models) out[id] = { state: m.state, since: m.lastStateAt, warm: m.warm, failures: m.failures };
    return out;
  }

  resourceReport() {
    if (!this.resourceSamples.length) return null;
    const first = this.resourceSamples[0];
    const last = this.resourceSamples[this.resourceSamples.length - 1];
    return {
      samples: this.resourceSamples.length,
      heapDelta: last.heapUsed - first.heapUsed,
      rssDelta: last.rss - first.rss,
      last: { heapUsed: last.heapUsed, rss: last.rss },
    };
  }
}

module.exports = ModelRuntimeManager;
module.exports.STATES = STATES;
