'use strict';

class ModelHealth {
  constructor() {
    this.checks = new Map();
  }

  record(modelId, result) {
    this.checks.set(modelId, {
      ...result,
      checkedAt: Date.now(),
    });
  }

  get(modelId) {
    return this.checks.get(modelId) || { ok: false, status: 'unknown', checkedAt: 0 };
  }

  all() {
    const out = {};
    for (const [k, v] of this.checks) out[k] = v;
    return out;
  }

  summary() {
    const checks = Array.from(this.checks.values());
    const ok = checks.filter((c) => c.ok).length;
    const total = checks.length;
    return { ok, total, unhealthy: total - ok, checks };
  }

  isHealthy(modelId) {
    const c = this.get(modelId);
    return c.ok === true;
  }
}

module.exports = ModelHealth;
