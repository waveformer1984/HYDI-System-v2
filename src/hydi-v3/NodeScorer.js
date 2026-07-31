'use strict';

const { EventEmitter } = require('events');

/**
 * NodeScorer evaluates candidate nodes for a task using a transparent,
 * explainable scoring model. Weights are configurable per task and policy.
 */
class NodeScorer extends EventEmitter {
  constructor(config = {}) {
    super();
    this.weights = config.weights || {
      capabilityMatch: 0.30,
      trust: 0.20,
      resources: 0.20,
      latency: 0.15,
      health: 0.10,
      strategicPriority: 0.05,
    };
    this.policy = config.policy || null;
    this.logger = config.logger || console;
    this.history = [];
  }

  score(task, node, options = {}) {
    const result = {
      nodeId: node.id,
      total: 0,
      breakdown: {},
      normalized: {},
    };

    const w = { ...this.weights, ...(options.weights || {}) };
    const sum = Object.values(w).reduce((a, b) => a + b, 0) || 1;
    const norm = (key) => (w[key] || 0) / sum;

    const required = task.requiredCapabilities || [];
    const nodeCaps = Array.isArray(node.capabilities) ? node.capabilities : [];
    const matched = required.filter((c) => nodeCaps.includes(c)).length;
    const capabilityScore = required.length ? matched / required.length : 1;
    result.breakdown.capabilityMatch = capabilityScore;
    result.normalized.capabilityMatch = norm('capabilityMatch');
    result.total += capabilityScore * norm('capabilityMatch');

    const trustScore = this._trustScore(node);
    result.breakdown.trust = trustScore;
    result.normalized.trust = norm('trust');
    result.total += trustScore * norm('trust');

    const resourceScore = this._resourceScore(node, task);
    result.breakdown.resources = resourceScore;
    result.normalized.resources = norm('resources');
    result.total += resourceScore * norm('resources');

    const latency = node.latency || 0;
    const latencyScore = latency < 1000 ? 1 : Math.max(0, 1 - (Math.log10(latency) / 4));
    result.breakdown.latency = latencyScore;
    result.normalized.latency = norm('latency');
    result.total += latencyScore * norm('latency');

    const health = (node.health === 'healthy' || node.status === 'active') ? 1 : 0;
    result.breakdown.health = health;
    result.normalized.health = norm('health');
    result.total += health * norm('health');

    const priority = options.strategicPriority || 0.5;
    result.breakdown.strategicPriority = priority;
    result.normalized.strategicPriority = norm('strategicPriority');
    result.total += priority * norm('strategicPriority');

    if (this.policy && typeof this.policy.filter === 'function') {
      const decision = this.policy.validateAction('score', { nodeId: node.id, task });
      if (!decision.allowed) {
        return { nodeId: node.id, total: 0, breakdown: result.breakdown, disqualified: true, reason: decision.reason };
      }
    }

    this._record(task, result);
    return result;
  }

  _trustScore(node) {
    const level = node.trustLevel || node.trust || 'unknown';
    const map = { official: 1, verified: 0.9, community: 0.6, unknown: 0.3, untrusted: 0 };
    return map[level] !== undefined ? map[level] : 0.3;
  }

  _resourceScore(node, task) {
    const cpu = Math.min(1, (node.cpu || 0) / (task.minCPU || 1 || 1));
    const ram = Math.min(1, (node.ram || 0) / (task.minRAM || 1 || 1));
    const gpu = task.gpu ? (node.gpu ? 1 : 0) : 1;
    const workload = node.workload || 0;
    const queuePenalty = Math.max(0, 1 - (workload / 10));
    return (cpu + ram + gpu + queuePenalty) / 4;
  }

  rank(task, nodes, options = {}) {
    const ranked = nodes
      .map((n) => this.score(task, n, options))
      .filter((s) => !s.disqualified && s.total > 0);
    ranked.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.nodeId.localeCompare(b.nodeId);
    });
    return ranked;
  }

  explain(result) {
    const parts = Object.entries(result.breakdown).map(([k, v]) => `${k}=${v.toFixed(2)}(${result.normalized[k] ? result.normalized[k].toFixed(2) : 0})`);
    return `${result.nodeId}: total=${result.total.toFixed(3)} [${parts.join(', ')}]`;
  }

  _record(task, result) {
    this.history.push({ at: Date.now(), taskId: task.id, result });
    this.emit('scored', { task, result });
  }

  getHistory(limit = 100) {
    return this.history.slice(-limit);
  }
}

module.exports = NodeScorer;
