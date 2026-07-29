'use strict';

const { EventEmitter } = require('events');

/**
 * WorkloadBalancer continuously re-evaluates task placement and triggers
 * migrations to keep the swarm healthy and well-utilized. It uses NodeScorer,
 * ResourceMonitor and DistributedQueue to make explainable decisions.
 */
class WorkloadBalancer extends EventEmitter {
  constructor(config = {}) {
    super();
    this.scorer = config.scorer || config.nodeScorer || null;
    this.monitor = config.monitor || config.resourceMonitor || null;
    this.queue = config.queue || config.distributedQueue || null;
    this.migrator = config.migrator || config.taskMigrationManager || null;
    this.policy = config.policy || null;
    this.intervalMs = config.intervalMs || 60000;
    this.threshold = config.threshold !== undefined ? config.threshold : 0.15;
    this.logger = config.logger || console;
    this._timer = null;
  }

  start() {
    if (this._timer) return this;
    this._timer = setInterval(() => this.balance(), this.intervalMs);
    if (this._timer.unref) this._timer.unref();
    this.emit('started');
    return this;
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this.emit('stopped');
    return this;
  }

  balance() {
    if (!this.monitor || !this.scorer || !this.queue) return { moved: 0 };
    const nodes = this.monitor.getAll().filter((n) => n.health === 'healthy');
    const reserved = this.queue.list().filter((i) => i.status === 'reserved');
    const moves = [];
    for (const item of reserved) {
      const task = item.task;
      const current = nodes.find((n) => n.nodeId === item.owner);
      if (!current) continue;
      const candidates = nodes.filter((n) => n.nodeId !== item.owner);
      const ranked = this.scorer.rank(task, candidates);
      if (ranked.length === 0) continue;
      const best = ranked[0];
      const currentScore = this.scorer ? this.scorer.score(task, current).total : 0;
      if (best.total > currentScore + this.threshold) {
        if (this.policy && !this.policy.validateAction('migrate', { nodeId: best.nodeId, task }).allowed) continue;
        const result = this.migrator
          ? this.migrator.migrate(item.id, item.owner, best.nodeId)
          : { success: true };
        if (result.success) {
          item.owner = best.nodeId;
          moves.push({ item: item.id, from: current.nodeId, to: best.nodeId, score: best.total });
          this.emit('migrated', { item: item.id, from: current.nodeId, to: best.nodeId });
        }
      }
    }
    this.emit('balanced', { moved: moves.length, moves });
    return { moved: moves.length, moves };
  }

  rebalanceAfterFailure(nodeId) {
    if (!this.queue) return { requeued: 0 };
    const affected = this.queue.list().filter((i) => i.owner === nodeId && i.status !== 'completed');
    for (const item of affected) {
      this.queue.fail(item.id, nodeId, 'node_disappeared');
    }
    this.emit('rebalanced_after_failure', { nodeId, requeued: affected.length });
    return { requeued: affected.length };
  }
}

module.exports = WorkloadBalancer;
