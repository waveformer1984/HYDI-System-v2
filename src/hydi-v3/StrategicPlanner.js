'use strict';

const { EventEmitter } = require('events');

/**
 * StrategicPlanner prioritizes goals, identifies dependencies, produces
 * execution plans, and adapts them to changing conditions. All plans are
 * deterministic and explainable.
 */
class StrategicPlanner extends EventEmitter {
  constructor(config = {}) {
    super();
    this.goalManager = config.goalManager || null;
    this.dependencyPlanner = config.dependencyPlanner || null;
    this.riskAnalyzer = config.riskAnalyzer || null;
    this.resourceAllocator = config.resourceAllocator || null;
    this.missionPlanner = config.missionPlanner || null;
    this.executionRoadmap = config.executionRoadmap || null;
    this.decisionJournal = config.decisionJournal || null;
    this.policy = config.policy || null;
    this.lifecycleRegistry = config.lifecycleRegistry || null;
    this.plans = new Map();
    this._clock = 0;
  }

  plan(options = {}) {
    const goals = (this.goalManager ? this.goalManager.list() : options.goals || [])
      .filter((g) => g.state === 'proposed' || g.state === 'active' || g.state === 'approved');

    const ordered = this._prioritize(goals);

    if (this.dependencyPlanner) {
      const dep = this.dependencyPlanner.order(ordered);
      if (!dep.success) return dep;
      ordered.length = 0;
      ordered.push(...dep.ordered);
    }

    const plan = {
      id: `sp-${Date.now()}-${++this._clock}`,
      goals: ordered.map((g) => g.id),
      selected: ordered,
      rationale: this._rationale(ordered),
      riskThreshold: options.riskThreshold || 0.7,
      createdAt: Date.now(),
    };

    if (this.policy) {
      const decision = this.policy.validateAction('plan', { nodeId: 'local', plan });
      if (!decision.allowed) return { success: false, error: decision.reason };
    }

    this.plans.set(plan.id, plan);
    if (this.decisionJournal) {
      this.decisionJournal.record({
        selected: plan.id,
        inputs: goals.map((g) => g.id),
        rejected: [],
        rationale: plan.rationale,
        expected: { ordered: plan.goals },
        owner: 'strategic_planner',
      });
    }
    this._audit('plan_created', plan);
    this.emit('plan_created', plan);
    return { success: true, plan };
  }

  replan(planId, reason) {
    const old = this.plans.get(planId);
    if (!old) return { success: false, error: 'plan_not_found' };
    const fresh = this.plan({ riskThreshold: old.riskThreshold });
    if (!fresh.success) return fresh;
    if (this.decisionJournal) {
      this.decisionJournal.record({
        selected: fresh.plan.id,
        inputs: old.goals,
        rejected: [old.id],
        rationale: `replan: ${reason}`,
        expected: { ordered: fresh.plan.goals },
        owner: 'strategic_planner',
      });
    }
    this._audit('plan_replaned', fresh.plan, { previous: planId, reason });
    this.emit('plan_replaned', { plan: fresh.plan, previous: old, reason });
    return { success: true, plan: fresh.plan, previous: old };
  }

  adapt(planId, newGoals) {
    const plan = this.plans.get(planId);
    if (!plan) return { success: false, error: 'plan_not_found' };
    const merged = this._prioritize(newGoals).filter((g) => !plan.goals.includes(g.id));
    plan.goals.push(...merged.map((g) => g.id));
    plan.selected.push(...merged);
    plan.updatedAt = Date.now();
    this._audit('plan_adapted', plan);
    this.emit('plan_adapted', plan);
    return { success: true, plan };
  }

  getPlan(id) {
    return this.plans.get(id) || null;
  }

  explain(planId) {
    const plan = this.plans.get(planId);
    if (!plan) return null;
    return [
      `Plan ${plan.id}: ${plan.goals.length} goals`,
      `rationale: ${plan.rationale}`,
      `sequence: ${plan.goals.join(' -> ')}`,
      `risk threshold: ${plan.riskThreshold}`,
    ].join(' | ');
  }

  _prioritize(goals) {
    const ranked = goals.slice();
    ranked.sort((a, b) => {
      const scoreA = (a.strategicValue || 0) * (a.priority || 0) / Math.max(1, a.estimatedEffort || 1);
      const scoreB = (b.strategicValue || 0) * (b.priority || 0) / Math.max(1, b.estimatedEffort || 1);
      if (scoreB !== scoreA) return scoreB - scoreA;
      if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
      return (a.id || '').localeCompare(b.id || '');
    });
    return ranked;
  }

  _rationale(goals) {
    const top = goals[0];
    if (!top) return 'no_goals';
    return `prioritized by strategic_value*priority/effort; leading goal: ${top.title} (${top.id})`;
  }

  _audit(action, plan, context = {}) {
    const entry = {
      at: Date.now(),
      action,
      planId: plan.id,
      goals: plan.goals,
      context,
    };
    if (this.lifecycleRegistry) this.lifecycleRegistry.recordProposal(entry);
    this.emit('audit', entry);
  }
}

module.exports = StrategicPlanner;
