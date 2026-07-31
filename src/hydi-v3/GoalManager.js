'use strict';

const { EventEmitter } = require('events');

const STATES = ['proposed', 'approved', 'active', 'blocked', 'completed', 'cancelled', 'failed'];

/**
 * GoalManager manages a structured hierarchy of strategic goals:
 * Objectives, Initiatives, Projects, Milestones, and Tasks.
 */
class GoalManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.identity = config.identity || null;
    this.policy = config.policy || null;
    this.lifecycleRegistry = config.lifecycleRegistry || null;
    this.logger = config.logger || console;
    this.goals = new Map();
    this._clock = 0;
  }

  createGoal(input) {
    this._clock += 1;
    const goal = {
      id: input.id || `g-${Date.now()}-${this._clock}`,
      kind: input.kind || 'objective',
      title: input.title || input.id,
      owner: input.owner || (this.identity ? this.identity.nodeId : 'local'),
      priority: input.priority || 0,
      strategicValue: input.strategicValue || 0,
      estimatedEffort: input.estimatedEffort || 0,
      dependencies: input.dependencies || [],
      children: input.children || [],
      state: input.state || 'proposed',
      targetCompletion: input.targetCompletion || null,
      successCriteria: input.successCriteria || '',
      rollbackStrategy: input.rollbackStrategy || '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      parent: input.parent || null,
    };

    if (!STATES.includes(goal.state)) {
      return { success: false, error: 'invalid_state' };
    }

    if (this.policy) {
      const decision = this.policy.validateAction('create_goal', { nodeId: goal.owner, goal });
      if (!decision.allowed) return { success: false, error: decision.reason };
    }

    this.goals.set(goal.id, goal);
    this._audit('goal_created', goal);
    this.emit('goal_created', goal);
    return { success: true, goal };
  }

  get(id) {
    return this.goals.get(id) || null;
  }

  list(filter = {}) {
    const values = Array.from(this.goals.values());
    if (filter.owner) return values.filter((g) => g.owner === filter.owner);
    if (filter.state) return values.filter((g) => g.state === filter.state);
    if (filter.kind) return values.filter((g) => g.kind === filter.kind);
    return values;
  }

  setState(id, state, context = {}) {
    if (!STATES.includes(state)) return { success: false, error: 'invalid_state' };
    const goal = this.goals.get(id);
    if (!goal) return { success: false, error: 'goal_not_found' };
    if (this.policy) {
      const decision = this.policy.validateAction('transition_goal', { nodeId: goal.owner, goal, state });
      if (!decision.allowed) return { success: false, error: decision.reason };
    }
    goal.state = state;
    goal.updatedAt = Date.now();
    this._audit('goal_transitioned', goal, context);
    this.emit('goal_transitioned', goal);
    return { success: true, goal };
  }

  addChild(parentId, childId) {
    const parent = this.goals.get(parentId);
    const child = this.goals.get(childId);
    if (!parent || !child) return { success: false, error: 'goal_not_found' };
    if (!parent.children.includes(childId)) parent.children.push(childId);
    child.parent = parentId;
    parent.updatedAt = Date.now();
    child.updatedAt = Date.now();
    this._audit('goal_linked', parent, { childId });
    this.emit('goal_linked', { parent, child });
    return { success: true, parent, child };
  }

  _audit(action, goal, context = {}) {
    const entry = {
      at: Date.now(),
      action,
      goalId: goal.id,
      state: goal.state,
      owner: goal.owner,
      context,
    };
    if (this.lifecycleRegistry) this.lifecycleRegistry.recordProposal(entry);
    this.emit('audit', entry);
  }
}

module.exports = GoalManager;
