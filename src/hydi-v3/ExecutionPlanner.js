'use strict';

const { EventEmitter } = require('events');

/**
 * ExecutionPlanner builds an explainable plan for where a task should run.
 * It uses the CapabilityBroker, NodeScorer, ResourceMonitor, and NodePolicy
 * to choose the best node, reserve the task, and execute.
 */
class ExecutionPlanner extends EventEmitter {
  constructor(config = {}) {
    super();
    this.broker = config.broker || config.capabilityBroker || null;
    this.scorer = config.scorer || config.nodeScorer || null;
    this.monitor = config.monitor || config.resourceMonitor || null;
    this.queue = config.queue || config.distributedQueue || null;
    this.taskManager = config.taskManager || null;
    this.policy = config.policy || null;
    this.contracts = config.serviceContract || null;
    this.logger = config.logger || console;
    this.audit = [];
  }

  async plan(task, options = {}) {
    if (this.contracts) {
      const check = this.contracts.validate('ExecutionPlanner.plan', { task, options });
      if (!check.valid) return { success: false, error: check.error };
    }
    if (this.policy) {
      const decision = this.policy.validateAction('plan', { task });
      if (!decision.allowed) return { success: false, error: decision.reason };
    }

    const allNodes = this.monitor ? this.monitor.getAll() : [];
    const healthy = allNodes.filter((n) => n.health === 'healthy');
    if (healthy.length === 0) return { success: false, error: 'no_healthy_nodes' };

    const required = task.requiredCapabilities || [];
    const capable = healthy.filter((n) => required.every((c) => n.capabilities.includes(c)));
    if (capable.length === 0) return { success: false, error: 'no_capable_nodes' };

    const ranked = this.scorer ? this.scorer.rank(task, capable, options) : capable.map((n) => ({ nodeId: n.nodeId, total: 1 }));
    if (ranked.length === 0) return { success: false, error: 'no_eligible_nodes' };

    const chosen = ranked[0];
    const plan = {
      taskId: task.id,
      task,
      chosen: chosen.nodeId,
      score: chosen.total,
      explanation: this.scorer ? this.scorer.explain(chosen) : 'no_scorer',
      alternatives: ranked.slice(1, 4).map((r) => ({ nodeId: r.nodeId, score: r.total })),
      plannedAt: Date.now(),
    };
    this.audit.push({ at: Date.now(), action: 'plan', plan });
    this.emit('planned', plan);
    return { success: true, plan };
  }

  async execute(task, options = {}) {
    const planResult = await this.plan(task, options);
    if (!planResult.success) return planResult;

    const plan = planResult.plan;
    const item = this.queue ? this.queue.enqueue(task, options) : null;
    const reserved = this.queue ? this.queue.reserve(plan.chosen) : null;
    if (reserved && reserved.task.id !== task.id) {
      return { success: false, error: 'queue_reservation_mismatch' };
    }
    if (this.taskManager) {
      this.taskManager.advertise(task, { requestedBy: options.requestedBy || 'planner' });
      this.taskManager.assign(task.id, plan.chosen);
    }
    this.emit('executing', { plan, item });
    return { success: true, plan, item };
  }

  getAudit(limit = 100) {
    return this.audit.slice(-limit);
  }
}

module.exports = ExecutionPlanner;
