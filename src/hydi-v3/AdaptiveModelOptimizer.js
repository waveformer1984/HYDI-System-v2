'use strict';

class AdaptiveModelOptimizer {
  constructor(config = {}) {
    this.logger = config.logger || console;
    this.maxSamples = config.maxSamples || 1000;
    this.models = new Map();
  }

  record({ model, capability, latency, success, confidence, cpuCost, memoryCost, operatorPreference }) {
    const id = model || 'unknown';
    if (!this.models.has(id)) {
      this.models.set(id, { model: id, capability: capability || null, samples: [] });
    }
    const rec = this.models.get(id);
    rec.capability = capability || rec.capability;
    rec.samples.push({
      at: Date.now(),
      latency: typeof latency === 'number' ? latency : 0,
      success: success === true ? 1 : 0,
      confidence: typeof confidence === 'number' ? confidence : 0.5,
      cpuCost: typeof cpuCost === 'number' ? cpuCost : 0,
      memoryCost: typeof memoryCost === 'number' ? memoryCost : 0,
      operatorPreference: typeof operatorPreference === 'number' ? operatorPreference : 0,
    });
    if (rec.samples.length > this.maxSamples) rec.samples.shift();
  }

  profile(modelId) {
    const rec = this.models.get(modelId);
    if (!rec) return this._emptyProfile(modelId);
    const latencies = rec.samples.map((s) => s.latency).sort((a, b) => a - b);
    const p95Index = Math.max(0, Math.ceil(latencies.length * 0.95) - 1);
    const p95Latency = latencies[p95Index] || 0;
    const total = rec.samples.length;
    const successes = rec.samples.reduce((s, r) => s + r.success, 0);
    const successRate = total ? successes / total : 0;
    const failureRate = total ? 1 - successRate : 1;
    const confidenceError = total
      ? rec.samples.reduce((s, r) => s + Math.abs(r.confidence - r.success), 0) / total
      : 0;
    const averageLatency = total ? rec.samples.reduce((s, r) => s + r.latency, 0) / total : 0;
    const cpuCost = total ? rec.samples.reduce((s, r) => s + r.cpuCost, 0) / total : 0;
    const memoryCost = total ? rec.samples.reduce((s, r) => s + r.memoryCost, 0) / total : 0;
    const operatorPref = total ? rec.samples.reduce((s, r) => s + r.operatorPreference, 0) / total : 0;
    return {
      model: rec.model,
      capability: rec.capability,
      averageLatency,
      p95Latency,
      successRate,
      failureRate,
      confidenceError,
      cpuCost,
      memoryCost,
      operatorPreference: operatorPref,
      score: this._computeScore({ successRate, p95Latency, confidenceError, cpuCost, memoryCost, operatorPreference: operatorPref }),
    };
  }

  _emptyProfile(modelId) {
    return {
      model: modelId,
      capability: null,
      averageLatency: 0,
      p95Latency: 0,
      successRate: 0,
      failureRate: 1,
      confidenceError: 0,
      cpuCost: 0,
      memoryCost: 0,
      operatorPreference: 0,
      score: 0,
    };
  }

  _computeScore({ successRate, p95Latency, confidenceError, cpuCost, memoryCost, operatorPreference }) {
    let s = successRate * 100;
    s -= (p95Latency / 1000) * 10;
    s -= confidenceError * 50;
    s -= cpuCost * 0.0001;
    s -= memoryCost * 0.00001;
    s += operatorPreference * 20;
    return Math.max(0, s);
  }

  allProfiles() {
    return Array.from(this.models.keys()).map((id) => this.profile(id));
  }

  recommend(task, candidates, _resources = {}) {
    let list = candidates.filter((c) => (c.capabilities || []).includes(task));
    if (list.length === 0) list = candidates.slice();
    const scored = list.map((c) => {
      const p = this.profile(c.id);
      return { ...c, score: p.score, profile: p };
    }).sort((a, b) => b.score - a.score);
    return scored[0] || null;
  }

  explain(modelId) {
    const p = this.profile(modelId);
    return `${p.model}: success=${p.successRate.toFixed(2)} p95=${p.p95Latency.toFixed(1)}ms confErr=${p.confidenceError.toFixed(2)} pref=${p.operatorPreference.toFixed(2)} score=${p.score.toFixed(1)}`;
  }
}

module.exports = AdaptiveModelOptimizer;
