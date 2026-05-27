// core/circuit-breaker.js
//
// Per-worker circuit breaker. Tracks failure rate; trips to OPEN after threshold;
// auto-resets to HALF_OPEN after cooldown; CLOSED on success. Modeled on the
// HYDI-Ursula M2 pattern (5 failures in 60s → disable) and the Cascade Golden
// Rule's SAFE/DEGRADED/CONTAINMENT operating-mode discipline.
//
// Usage:
//   const cb = new CircuitBreaker({ threshold: 5, windowMs: 60_000, cooldownMs: 60_000 });
//   cb.recordSuccess('worker-id');
//   cb.recordFailure('worker-id');
//   cb.state('worker-id') // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
//   cb.canExecute('worker-id') // boolean

class CircuitBreaker {
  constructor({ threshold = 5, windowMs = 60_000, cooldownMs = 60_000 } = {}) {
    this.threshold = threshold;
    this.windowMs = windowMs;
    this.cooldownMs = cooldownMs;
    this.breakers = new Map(); // id -> { failures: timestamps[], state, openedAt }
  }

  _get(id) {
    if (!this.breakers.has(id)) {
      this.breakers.set(id, { failures: [], state: 'CLOSED', openedAt: null });
    }
    return this.breakers.get(id);
  }

  _pruneOldFailures(b) {
    const cutoff = Date.now() - this.windowMs;
    b.failures = b.failures.filter((t) => t > cutoff);
  }

  recordSuccess(id) {
    const b = this._get(id);
    b.failures = [];
    b.state = 'CLOSED';
    b.openedAt = null;
  }

  recordFailure(id) {
    const b = this._get(id);
    b.failures.push(Date.now());
    this._pruneOldFailures(b);
    if (b.failures.length >= this.threshold && b.state !== 'OPEN') {
      b.state = 'OPEN';
      b.openedAt = Date.now();
    }
  }

  state(id) {
    const b = this._get(id);
    if (b.state === 'OPEN' && Date.now() - b.openedAt >= this.cooldownMs) {
      b.state = 'HALF_OPEN';
    }
    this._pruneOldFailures(b);
    return b.state;
  }

  canExecute(id) {
    const s = this.state(id);
    return s === 'CLOSED' || s === 'HALF_OPEN';
  }

  // For routing scoring — failure penalty in [0, 1]
  failurePenalty(id) {
    const b = this._get(id);
    this._pruneOldFailures(b);
    return Math.min(1, b.failures.length / this.threshold);
  }

  snapshot() {
    const out = {};
    for (const [id, b] of this.breakers.entries()) {
      this._pruneOldFailures(b);
      out[id] = {
        state: this.state(id),
        recentFailures: b.failures.length,
        openedAt: b.openedAt
      };
    }
    return out;
  }
}

module.exports = { CircuitBreaker };
