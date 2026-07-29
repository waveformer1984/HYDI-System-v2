'use strict';

const { EventEmitter } = require('events');

/**
 * RiskAnalyzer scores strategic plans across execution, security, dependency,
 * resource, policy, trust, and federation availability dimensions. Every
 * assessment includes rationale.
 */
class RiskAnalyzer extends EventEmitter {
  constructor(config = {}) {
    super();
    this.policy = config.policy || null;
    this.monitor = config.resourceMonitor || null;
    this.history = config.history || [];
    this.weights = config.weights || {
      execution: 0.25,
      dependency: 0.20,
      resource: 0.20,
      security: 0.15,
      policy: 0.10,
      federation: 0.10,
    };
  }

  analyze(plan) {
    const task = plan.task || plan;
    const scores = {
      execution: this._executionRisk(task),
      dependency: this._dependencyRisk(task),
      resource: this._resourceRisk(task),
      security: this._securityRisk(task),
      policy: this._policyRisk(task),
      federation: this._federationRisk(task),
    };

    const sum = Object.values(this.weights).reduce((a, b) => a + b, 0) || 1;
    let overall = 0;
    const breakdown = {};
    for (const [k, v] of Object.entries(scores)) {
      const w = (this.weights[k] || 0) / sum;
      overall += v * w;
      breakdown[k] = { score: parseFloat(v.toFixed(2)), weight: w };
    }

    const assessment = {
      taskId: task.id,
      overall: parseFloat(overall.toFixed(2)),
      breakdown,
      rationale: this._rationale(scores),
      threshold: plan.riskThreshold || 0.7,
      acceptable: overall < (plan.riskThreshold || 0.7),
      ts: Date.now(),
    };
    this.emit('risk_assessed', assessment);
    return { success: true, assessment };
  }

  _executionRisk(task) {
    const effort = task.estimatedEffort || 0;
    const complexity = (task.dependencies || []).length;
    return Math.min(1, (effort / 100 + complexity * 0.05));
  }

  _dependencyRisk(task) {
    const deps = task.dependencies || [];
    if (deps.length === 0) return 0;
    const missing = deps.filter((d) => !d.completed && !d.state !== 'completed').length;
    return Math.min(1, missing / Math.max(1, deps.length) + (deps.length * 0.05));
  }

  _resourceRisk(task) {
    const available = this.monitor ? this.monitor.getAll().length : 1;
    const needed = (task.cpu || 0) + (task.ram || 0);
    return Math.min(1, needed / Math.max(1, available));
  }

  _securityRisk(task) {
    return task.approvals ? 0.1 : 0.0;
  }

  _policyRisk(task) {
    if (!this.policy) return 0.1;
    const decision = this.policy.validateAction('execute', { nodeId: task.owner || 'local', task });
    return decision.allowed ? 0 : 0.8;
  }

  _federationRisk(task) {
    if (!task.federation) return 0;
    const healthy = this.monitor ? this.monitor.getHealthy().length : 1;
    return healthy > 1 ? 0.1 : 0.5;
  }

  _rationale(scores) {
    const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    return `Highest risk is ${top[0]} at ${top[1].toFixed(2)}`;
  }
}

module.exports = RiskAnalyzer;
