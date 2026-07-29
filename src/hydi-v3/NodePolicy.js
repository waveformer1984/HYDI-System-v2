'use strict';

const { EventEmitter } = require('events');

/**
 * NodePolicy enforces federation governance: trust, capabilities, permissions,
 * and mandatory audit records. It is used by the scheduler and gateway before
 * any federation action is allowed.
 */
class NodePolicy extends EventEmitter {
  constructor(config = {}) {
    super();
    this.identity = config.identity || null;
    this.capabilityRegistry = config.capabilityRegistry || null;
    this.lifecycleRegistry = config.lifecycleRegistry || null;
    this.observability = config.observability || null;
    this.logger = config.logger || console;
    this.audit = [];
  }

  validateAction(action, context = {}) {
    const { nodeId, task, capability } = context;
    let allowed = true;
    let reason = 'allowed';

    if (this.identity && nodeId && !this.identity.isTrusted(nodeId) && nodeId !== this.identity.nodeId) {
      allowed = false;
      reason = 'untrusted_node';
    } else if (task && task.assignedTo && this.identity && task.assignedTo !== this.identity.nodeId && !this.identity.isTrusted(task.assignedTo)) {
      allowed = false;
      reason = 'untrusted_assignee';
    } else if (capability && this.capabilityRegistry && !this._hasCapability(nodeId, capability)) {
      allowed = false;
      reason = 'missing_capability';
    }

    const record = { at: Date.now(), action, allowed, reason, context: { nodeId, taskId: task && task.id, capability } };
    this.audit.push(record);
    this._emitAudit(record);
    return { allowed, reason, record };
  }

  filter(task, candidates) {
    return candidates.filter((c) => {
      const decision = this.validateAction('schedule', { nodeId: c.id, task, capability: task && task.capability });
      return decision.allowed;
    });
  }

  _hasCapability(nodeId, capability) {
    if (!this.capabilityRegistry) return true;
    const installed = this.capabilityRegistry.list().map((c) => c.id);
    return installed.includes(capability);
  }

  _emitAudit(record) {
    if (this.lifecycleRegistry) this.lifecycleRegistry.recordProposal(record);
    if (this.observability && typeof this.observability.recordBusinessSignal === 'function') {
      this.observability.recordBusinessSignal({ type: 'federation_policy', payload: record });
    }
    this.emit('audit', record);
  }

  getAudit(limit = 100) {
    return this.audit.slice(-limit);
  }
}

module.exports = NodePolicy;
