'use strict';

const { EventEmitter } = require('events');

/**
 * TaskMigrationManager safely moves reserved tasks between trusted nodes.
 * It relies on DistributedTaskManager and NodeMesh for actual transport and
 * lifecycle tracking.
 */
class TaskMigrationManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.taskManager = config.taskManager || null;
    this.mesh = config.mesh || null;
    this.policy = config.policy || null;
    this.logger = config.logger || console;
    this.audit = [];
  }

  canMigrate(taskId, fromNodeId, toNodeId) {
    if (this.policy) {
      const decision = this.policy.validateAction('migrate', { nodeId: toNodeId, taskId });
      if (!decision.allowed) return { allowed: false, reason: decision.reason };
    }
    const node = this.mesh ? this.mesh.compute.getNode(toNodeId) : null;
    if (!node || node.status !== 'active') return { allowed: false, reason: 'target_unavailable' };
    return { allowed: true };
  }

  migrate(taskId, fromNodeId, toNodeId) {
    const check = this.canMigrate(taskId, fromNodeId, toNodeId);
    if (!check.allowed) return { success: false, error: check.reason };

    if (this.mesh) {
      this.mesh.send(toNodeId, 'task_transfer', { taskId, from: fromNodeId, to: toNodeId });
    }
    if (this.taskManager) {
      this.taskManager.assign(taskId, toNodeId);
    }
    const record = { at: Date.now(), taskId, from: fromNodeId, to: toNodeId };
    this.audit.push(record);
    this.emit('migrated', record);
    return { success: true, taskId, to: toNodeId };
  }

  getAudit(limit = 100) {
    return this.audit.slice(-limit);
  }
}

module.exports = TaskMigrationManager;
