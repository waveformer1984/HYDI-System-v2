'use strict';

const { EventEmitter } = require('events');

/**
 * ExecutiveDashboard renders the executive view of the HYDI operating system:
 * active goals, priorities, resources, federation utilization, risk, forecasts,
 * roadmaps, blocked work, governance approvals, and mission health.
 */
class ExecutiveDashboard extends EventEmitter {
  constructor(config = {}) {
    super();
    this.goalManager = config.goalManager || null;
    this.strategicPlanner = config.strategicPlanner || null;
    this.missionPlanner = config.missionPlanner || null;
    this.executionRoadmap = config.executionRoadmap || null;
    this.resourceAllocator = config.resourceAllocator || null;
    this.riskAnalyzer = config.riskAnalyzer || null;
    this.forecastEngine = config.forecastEngine || null;
    this.progressTracker = config.progressTracker || null;
    this.decisionJournal = config.decisionJournal || null;
    this.federationDashboard = config.federationDashboard || null;
    this.historyLimit = config.historyLimit || 1440;
    this.snapshots = [];
  }

  snapshot() {
    const goals = this.goalManager ? this.goalManager.list() : [];
    const active = goals.filter((g) => g.state === 'active' || g.state === 'proposed');
    const progress = this.progressTracker ? this.progressTracker.summary() : null;
    const resources = this.resourceAllocator ? this.resourceAllocator.available() : null;
    const federation = this.federationDashboard ? this.federationDashboard.render() : null;
    const plans = this.strategicPlanner ? Object.fromEntries(this.strategicPlanner.plans) : {};

    const status = {
      ts: Date.now(),
      activeGoals: active.length,
      goalsByState: goals.reduce((acc, g) => {
        acc[g.state] = (acc[g.state] || 0) + 1;
        return acc;
      }, {}),
      topGoals: active
        .sort((a, b) => (b.priority || 0) - (a.priority || 0))
        .slice(0, 5)
        .map((g) => ({ id: g.id, title: g.title, priority: g.priority, state: g.state })),
      progress,
      resources,
      blocked: this.progressTracker ? this.progressTracker.getBlocked().length : 0,
      federation: federation ? {
        peers: federation.peers,
        healthy: federation.healthy,
        completedTasks: federation.completedTasks,
      } : null,
      decisionCount: this.decisionJournal ? this.decisionJournal.entries.length : 0,
      plans: Object.keys(plans),
    };
    this.snapshots.push(status);
    if (this.snapshots.length > this.historyLimit) this.snapshots.shift();
    this.emit('snapshot', status);
    return status;
  }

  render() {
    const s = this.snapshot();
    return {
      summary: `Executive: ${s.activeGoals} active goals, ${s.blocked} blocked, top: ${s.topGoals.map((g) => g.title).join(', ') || 'none'}`,
      started: true,
      activeGoals: s.activeGoals,
      blocked: s.blocked,
      progress: s.progress,
      resources: s.resources,
      topGoals: s.topGoals,
      federation: s.federation,
      decisionCount: s.decisionCount,
      ts: s.ts,
    };
  }

  getHistory(limit = 100) {
    return this.snapshots.slice(-limit);
  }
}

module.exports = ExecutiveDashboard;
