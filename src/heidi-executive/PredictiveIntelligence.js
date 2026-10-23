/**
 * HEIDI Operational Decision Engine — Predictive Warnings
 */

class PredictiveIntelligence {
  constructor(options = {}) {
    this.restartThreshold = options.restartThreshold || 3;
    this.timeWindowMs = options.timeWindowMs || 3600000;
    this.latencyThreshold = options.latencyThreshold || 1.5;
  }

  analyze(service, history = []) {
    const now = Date.now();
    const window = history.filter(h => now - h.timestamp < this.timeWindowMs);
    const restarts = window.filter(h => h.event === 'restart' || h.event === 'crash').length;
    const recoveries = window.filter(h => h.event === 'recovery').map(h => h.latencyMs).filter(Boolean);
    const latencies = recoveries.length ? recoveries : [];
    const median = latencies.length ? latencies.sort((a, b) => a - b)[Math.floor(latencies.length / 2)] : 0;
    const previousMedian = history.length ? this.median(history.map(h => h.latencyMs).filter(Boolean)) : 0;
    const latencyRising = previousMedian > 0 && median / previousMedian >= this.latencyThreshold;

    const warnings = [];
    if (restarts >= this.restartThreshold) {
      warnings.push({
        type: 'RESTART_SPIKE',
        severity: restarts >= this.restartThreshold * 2 ? 'HIGH' : 'MEDIUM',
        message: `${service} has restarted ${restarts} times in the last hour`,
      });
    }

    if (latencyRising) {
      warnings.push({
        type: 'LATENCY_REGRESSION',
        severity: 'MEDIUM',
        message: `${service} recovery latency rose from ${previousMedian}ms to ${median}ms`,
      });
    }

    return { service, restarts, medianLatencyMs: median, warnings };
  }

  median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }
}

module.exports = { PredictiveIntelligence };
