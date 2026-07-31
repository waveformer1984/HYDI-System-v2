'use strict';

const { EventEmitter } = require('events');

/**
 * OperationsDashboard aggregates production reliability metrics, distributed
 * traces, execution timelines, resource history, and recovery data into a
 * unified operational view.
 */
class OperationsDashboard extends EventEmitter {
  constructor(config = {}) {
    super();
    this.healthSupervisor = config.healthSupervisor || null;
    this.faultCorrelation = config.faultCorrelation || null;
    this.recoveryCoordinator = config.recoveryCoordinator || null;
    this.leakDetector = config.leakDetector || null;
    this.deadlockDetector = config.deadlockDetector || null;
    this.federationDashboard = config.federationDashboard || null;
    this.executiveDashboard = config.executiveDashboard || null;
    this.lifecycleRegistry = config.lifecycleRegistry || null;
    this.maxHistory = config.maxHistory || 1000;

    this.latencies = [];
    this.traces = [];
    this.decisions = [];
    this.executions = [];
    this.rollbacks = [];
    this.forecasts = [];
    this.outcomes = [];
  }

  recordLatency(ms, context = {}) {
    this.latencies.push({ at: Date.now(), ms, context });
    if (this.latencies.length > this.maxHistory) this.latencies.shift();
    this.emit('latency', this.latencies[this.latencies.length - 1]);
    return this;
  }

  recordTrace(trace) {
    const record = {
      id: trace.id || `t-${Date.now()}-${this.traces.length}`,
      at: trace.at || Date.now(),
      steps: trace.steps || [],
      goalId: trace.goalId || null,
      status: trace.status || 'unknown',
    };
    this.traces.push(record);
    if (this.traces.length > this.maxHistory) this.traces.shift();
    this.emit('trace', record);
    return this;
  }

  recordDecision(decision) {
    this.decisions.push({ at: Date.now(), ...decision });
    if (this.decisions.length > this.maxHistory) this.decisions.shift();
    return this;
  }

  recordExecution(execution) {
    this.executions.push({ at: Date.now(), ...execution });
    if (this.executions.length > this.maxHistory) this.executions.shift();
    return this;
  }

  recordRollback(context) {
    this.rollbacks.push({ at: Date.now(), ...context });
    if (this.rollbacks.length > this.maxHistory) this.rollbacks.shift();
    return this;
  }

  recordForecast(forecast) {
    this.forecasts.push({ at: Date.now(), forecast });
    if (this.forecasts.length > this.maxHistory) this.forecasts.shift();
    return this;
  }

  recordOutcome(outcome) {
    this.outcomes.push({ at: Date.now(), ...outcome });
    if (this.outcomes.length > this.maxHistory) this.outcomes.shift();
    this.emit('outcome', this.outcomes[this.outcomes.length - 1]);
    return this;
  }

  meanLatency() {
    if (this.latencies.length === 0) return null;
    return Math.round(this.latencies.reduce((a, b) => a + b.ms, 0) / this.latencies.length);
  }

  p95Latency() {
    if (this.latencies.length === 0) return null;
    const sorted = this.latencies.map((l) => l.ms).sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * 0.95) - 1;
    return sorted[Math.max(0, index)];
  }

  rollbackFrequency() {
    const window = Date.now() - 3600000; // last hour
    const count = this.rollbacks.filter((r) => r.at >= window).length;
    return count;
  }

  recoverySuccessRate() {
    return this.recoveryCoordinator ? this.recoveryCoordinator.successRate() : null;
  }

  plannerAccuracy() {
    const planned = this.executions.filter((e) => e.planned !== undefined);
    if (planned.length === 0) return null;
    const matched = planned.filter((e) => e.success && e.planned).length;
    return parseFloat((matched / planned.length).toFixed(2));
  }

  forecastAccuracy() {
    if (this.forecasts.length === 0 || this.outcomes.length === 0) return null;
    let matched = 0;
    let compared = 0;
    for (const f of this.forecasts) {
      const o = this.outcomes.find((x) => x.taskId === f.forecast.taskId && x.at >= f.at);
      if (o) {
        compared += 1;
        if (o.success === (f.forecast.completionProbability > 0.5)) matched += 1;
      }
    }
    return compared === 0 ? null : parseFloat((matched / compared).toFixed(2));
  }

  snapshot() {
    const health = this.healthSupervisor ? this.healthSupervisor.getStatus() : null;
    const correlations = this.faultCorrelation ? this.faultCorrelation.getCorrelations() : [];
    const recovery = this.recoveryCoordinator ? this.recoveryCoordinator.getHistory() : [];
    const leak = this.leakDetector ? this.leakDetector.getTrend() : null;
    const deadlock = this.deadlockDetector ? this.deadlockDetector.getGraph() : null;
    const fed = this.federationDashboard ? this.federationDashboard.render() : null;
    const exec = this.executiveDashboard ? this.executiveDashboard.render() : null;

    return {
      ts: Date.now(),
      health,
      faultCount: correlations.length,
      recentFaults: correlations.slice(-5),
      recoveryAttempts: recovery.length,
      recoverySuccessRate: this.recoverySuccessRate(),
      meanLatency: this.meanLatency(),
      p95Latency: this.p95Latency(),
      rollbackFrequency: this.rollbackFrequency(),
      plannerAccuracy: this.plannerAccuracy(),
      forecastAccuracy: this.forecastAccuracy(),
      resourceTrend: leak,
      deadlockGraph: deadlock,
      federation: fed,
      executive: exec,
      traceCount: this.traces.length,
      executionCount: this.executions.length,
    };
  }

  render() {
    const s = this.snapshot();
    return {
      summary: `Ops: ${s.health ? s.health.state : 'unknown'}, mean latency ${s.meanLatency ?? '-'}ms, ` +
        `recovery ${s.recoverySuccessRate !== null ? (s.recoverySuccessRate * 100).toFixed(0) : '-'}%, ` +
        `faults ${s.faultCount}`,
      ...s,
    };
  }

  getTrace(id) {
    return this.traces.find((t) => t.id === id) || null;
  }

  getHistory(limit = 100) {
    return {
      latencies: this.latencies.slice(-limit),
      traces: this.traces.slice(-limit),
      decisions: this.decisions.slice(-limit),
      executions: this.executions.slice(-limit),
      rollbacks: this.rollbacks.slice(-limit),
    };
  }
}

module.exports = OperationsDashboard;
