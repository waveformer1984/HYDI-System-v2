'use strict';

const { EventEmitter } = require('events');

/**
 * DecisionJournal is the permanent executive audit trail. Every strategic
 * decision records what was considered, what was chosen, and why.
 */
class DecisionJournal extends EventEmitter {
  constructor(config = {}) {
    super();
    this.lifecycleRegistry = config.lifecycleRegistry || null;
    this.logger = config.logger || console;
    this.entries = [];
    this.indexByGoal = new Map();
    this.indexByApproval = new Map();
  }

  record(input) {
    const entry = {
      id: input.id || `dj-${Date.now()}-${this.entries.length + 1}`,
      at: input.at || Date.now(),
      inputs: input.inputs || [],
      selected: input.selected || null,
      rejected: input.rejected || [],
      rationale: input.rationale || '',
      expected: input.expected || null,
      actual: input.actual || null,
      approval: input.approval || null,
      owner: input.owner || 'local',
      goalId: input.goalId || null,
      confidence: input.confidence || null,
    };

    this.entries.push(entry);
    if (entry.goalId) {
      const list = this.indexByGoal.get(entry.goalId) || [];
      list.push(entry.id);
      this.indexByGoal.set(entry.goalId, list);
    }
    if (entry.approval) {
      const list = this.indexByApproval.get(entry.approval) || [];
      list.push(entry.id);
      this.indexByApproval.set(entry.approval, list);
    }

    this._audit('decision_recorded', entry);
    this.emit('recorded', entry);
    return { success: true, entry };
  }

  get(id) {
    return this.entries.find((e) => e.id === id) || null;
  }

  list(options = {}) {
    let result = this.entries.slice();
    if (options.goalId) result = result.filter((e) => e.goalId === options.goalId);
    if (options.approval) result = result.filter((e) => e.approval === options.approval);
    if (options.owner) result = result.filter((e) => e.owner === options.owner);
    return result;
  }

  actualize(id, actual) {
    const entry = this.get(id);
    if (!entry) return { success: false, error: 'not_found' };
    entry.actual = actual;
    entry.actualAt = Date.now();
    this.emit('actualized', entry);
    return { success: true, entry };
  }

  _audit(action, entry) {
    const record = {
      at: Date.now(),
      action,
      decisionId: entry.id,
      goalId: entry.goalId,
      selected: entry.selected,
      owner: entry.owner,
    };
    if (this.lifecycleRegistry) this.lifecycleRegistry.recordProposal(record);
    this.emit('audit', record);
  }
}

module.exports = DecisionJournal;
