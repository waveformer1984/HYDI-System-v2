'use strict';

const { EventEmitter } = require('events');

/**
 * NodeScheduler is a deterministic, policy-aware task scheduler.
 * It extends DistributedCompute scoring with affinity, anti-affinity,
 * and capability requirements, and serializes scheduling decisions.
 */
class NodeScheduler extends EventEmitter {
  constructor(config = {}) {
    super();
    this.compute = config.compute || null;
    this.policy = config.policy || null;
    this.logger = config.logger || console;
    this.pending = new Map();
    this.claims = new Map();
    this._lock = new Map();
    this._taskCounter = 0;
  }

  schedule(task, options = {}) {
    const taskId = task.id || `task-${this._taskCounter += 1}`;
    const candidate = this._select(task, options);
    if (!candidate) {
      this.pending.set(taskId, { task, options, status: 'pending' });
      this.emit('pending', { taskId, task });
      return { taskId, nodeId: null, status: 'pending' };
    }
    this.claims.set(taskId, { nodeId: candidate, task, claimedAt: Date.now() });
    this.emit('assigned', { taskId, nodeId: candidate, task });
    return { taskId, nodeId: candidate, status: 'assigned' };
  }

  _select(task, options) {
    if (!this.compute) return null;
    const filter = {};
    if (options.gpu) filter.gpu = true;
    if (options.minCPU) filter.minCPU = options.minCPU;
    if (options.minRAM) filter.minRAM = options.minRAM;
    if (options.capability) filter.capability = options.capability;

    let candidates = this.compute.getNodes()
      .filter((n) => n.status === 'active')
      .filter((n) => {
        if (filter.gpu && !n.gpu) return false;
        if (filter.minCPU && (n.cpu || 0) < filter.minCPU) return false;
        if (filter.minRAM && (n.ram || 0) < filter.minRAM) return false;
        if (filter.capability && !n.capabilities.includes(filter.capability)) return false;
        if (options.affinity && options.affinity !== n.id) return false;
        if (options.antiAffinity && options.antiAffinity.includes(n.id)) return false;
        return true;
      });

    if (this.policy && typeof this.policy.filter === 'function') {
      candidates = this.policy.filter(task, candidates);
    }

    const weights = this.compute.config ? this.compute.config.defaultWeights : { cpu: 0.3, ram: 0.3, latency: 0.2, workload: 0.2 };
    candidates.sort((a, b) => {
      const scoreA = this._score(a, weights);
      const scoreB = this._score(b, weights);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return a.id.localeCompare(b.id);
    });

    return candidates.length ? candidates[0].id : null;
  }

  _score(node, weights) {
    const cpu = node.cpu || 0;
    const ram = node.ram || 0;
    const latency = node.latency || 0;
    const workload = node.workload || 0;
    return cpu * (weights.cpu || 0) + ram * (weights.ram || 0) - latency * (weights.latency || 0) - workload * (weights.workload || 0);
  }

  release(taskId) {
    const claim = this.claims.get(taskId);
    if (!claim) return false;
    this.claims.delete(taskId);
    this.emit('released', { taskId, nodeId: claim.nodeId });
    return true;
  }

  getPending() {
    return Array.from(this.pending.entries()).map(([taskId, v]) => ({ taskId, ...v }));
  }

  getClaims() {
    return Array.from(this.claims.entries()).map(([taskId, v]) => ({ taskId, ...v }));
  }
}

module.exports = NodeScheduler;
