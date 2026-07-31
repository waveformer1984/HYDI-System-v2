'use strict';

const { EventEmitter } = require('events');

/**
 * FederationDashboard aggregates federation status for operators: peers,
 * tasks, memory synchronization, lifecycle health, and audit summaries.
 */
class FederationDashboard extends EventEmitter {
  constructor(config = {}) {
    super();
    this.mesh = config.mesh || null;
    this.taskManager = config.taskManager || null;
    this.memoryStore = config.memoryStore || null;
    this.lifecycle = config.lifecycle || null;
    this.gateway = config.gateway || null;
    this.logger = config.logger || console;
    this.historyLimit = config.historyLimit || 1440;
    this.snapshots = [];
  }

  snapshot() {
    const status = {
      ts: Date.now(),
      peers: this.mesh ? this.mesh.getPeers() : [],
      topology: this.mesh ? this.mesh.getTopology() : null,
      health: this.mesh ? this.mesh.healthCheck() : null,
      tasks: this.taskManager ? this.taskManager.list() : [],
      memory: this.memoryStore ? this.memoryStore.snapshot() : null,
      lifecycle: this.lifecycle ? this.lifecycle.healthReport() : null,
      audit: this.gateway ? this.gateway.getAudit(50) : [],
    };
    this.snapshots.push(status);
    if (this.snapshots.length > this.historyLimit) this.snapshots.shift();
    this.emit('snapshot', status);
    return status;
  }

  getStatus() {
    return this.snapshots.length ? this.snapshots[this.snapshots.length - 1] : this.snapshot();
  }

  render() {
    const s = this.getStatus();
    return {
      peers: s.peers.length,
      tasks: s.tasks.length,
      pendingTasks: s.tasks.filter((t) => t.status === 'pending' || t.status === 'advertised').length,
      completedTasks: s.tasks.filter((t) => t.status === 'completed').length,
      failedTasks: s.tasks.filter((t) => t.status === 'failed').length,
      conflicts: s.memory ? Object.keys(s.memory).reduce((sum, ns) => sum + (s.memory[ns].conflicts || 0), 0) : 0,
      healthy: s.lifecycle ? s.lifecycle.healthy : 0,
      total: s.lifecycle ? s.lifecycle.total : 0,
      ts: s.ts,
    };
  }

  getHistory(limit = 100) {
    return this.snapshots.slice(-limit);
  }
}

module.exports = FederationDashboard;
