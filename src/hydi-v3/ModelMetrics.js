'use strict';

class ModelMetrics {
  constructor() {
    this.samples = [];
    this.maxSamples = 1000;
  }

  record(modelId, operation, latencyMs, ok, extra = {}) {
    this.samples.push({
      at: Date.now(),
      modelId,
      operation,
      latencyMs,
      ok,
      ...extra,
    });
    if (this.samples.length > this.maxSamples) this.samples.shift();
  }

  forModel(modelId, operation = null) {
    return this.samples.filter((s) => s.modelId === modelId && (!operation || s.operation === operation));
  }

  averageLatency(modelId, operation) {
    const list = this.forModel(modelId, operation);
    if (!list.length) return null;
    return list.reduce((s, r) => s + r.latencyMs, 0) / list.length;
  }

  summary(modelId) {
    const list = this.forModel(modelId);
    if (!list.length) return { count: 0 };
    const ok = list.filter((s) => s.ok).length;
    return {
      count: list.length,
      successRate: ok / list.length,
      averageLatency: list.reduce((s, r) => s + r.latencyMs, 0) / list.length,
    };
  }
}

module.exports = ModelMetrics;
