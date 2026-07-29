'use strict';

const { EventEmitter } = require('events');

/**
 * ProgressTracker records and reports milestone completion, blocked work,
 * replanning events, and historical performance trends for strategic plans.
 */
class ProgressTracker extends EventEmitter {
  constructor(config = {}) {
    super();
    this.goalManager = config.goalManager || null;
    this.lifecycleRegistry = config.lifecycleRegistry || null;
    this.historyLimit = config.historyLimit || 1000;
    this.progress = new Map();
    this.events = [];
    this.trends = new Map();
  }

  recordProgress(itemId, status, context = {}) {
    const record = {
      at: Date.now(),
      itemId,
      status,
      context,
    };
    this.progress.set(itemId, record);
    this.events.push(record);
    if (this.events.length > this.historyLimit) this.events.shift();
    this._updateTrend(itemId, status);
    this._audit('progress_recorded', record);
    this.emit('progress_recorded', record);
    return { success: true, record };
  }

  recordMilestone(milestoneId, state, context = {}) {
    return this.recordProgress(milestoneId, state, { ...context, kind: 'milestone' });
  }

  getProgress(itemId) {
    return this.progress.get(itemId) || null;
  }

  summary() {
    const counts = { completed: 0, blocked: 0, active: 0, pending: 0, failed: 0 };
    for (const r of this.progress.values()) {
      const status = r.status || 'pending';
      if (counts[status] !== undefined) counts[status] += 1;
    }
    return counts;
  }

  getBlocked() {
    return Array.from(this.progress.values()).filter((r) => r.status === 'blocked' || r.status === 'failed');
  }

  getHistory(itemId, limit = 100) {
    return this.events
      .filter((e) => !itemId || e.itemId === itemId)
      .slice(-limit);
  }

  getTrends() {
    return Array.from(this.trends.entries()).map(([id, t]) => ({ id, ...t }));
  }

  _updateTrend(itemId, status) {
    const trend = this.trends.get(itemId) || { completed: 0, blocked: 0, total: 0, last: null };
    trend.total += 1;
    if (status === 'completed') trend.completed += 1;
    if (status === 'blocked' || status === 'failed') trend.blocked += 1;
    trend.last = Date.now();
    this.trends.set(itemId, trend);
  }

  _audit(action, record) {
    const entry = { at: Date.now(), action, itemId: record.itemId, status: record.status };
    if (this.lifecycleRegistry) this.lifecycleRegistry.recordProposal(entry);
    this.emit('audit', entry);
  }
}

module.exports = ProgressTracker;
