'use strict';

const { EventEmitter } = require('events');

/**
 * ObservabilityDashboard aggregates metrics for agent health, mission progress,
 * revenue, queue depth, memory, database, errors, reflection summaries, decision
 * confidence, and system uptime. It supports historical charts and metric export.
 */
class ObservabilityDashboard extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      historyLimit: config.historyLimit || 1440,
      ...config,
    };

    this.history = {
      timestamps: [],
      agentHealth: [],
      missionProgress: [],
      revenue: [],
      queueDepth: [],
      memory: [],
      errors: [],
      decisionConfidence: [],
    };
  }

  recordSnapshot(sources = {}) {
    const now = new Date().toISOString();
    const core = sources.coreLoop;
    const watchdog = sources.watchdog;
    const mission = sources.missionPlanner;
    const decisions = sources.decisionIntelligence;

    const snapshot = {
      timestamp: now,
      agentHealth: this.getAgentHealthScore(watchdog),
      missionProgress: this.getMissionProgressScore(mission),
      revenue: core?.metrics?.revenueGenerated || 0,
      queueDepth: this.getQueueDepth(sources),
      memory: core?.getMemoryUsage ? core.getMemoryUsage() : 0,
      errors: core?.metrics?.loopsFailed || 0,
      decisionConfidence: decisions?.averageConfidence ? decisions.averageConfidence() : 0,
    };

    this.history.timestamps.push(now);
    this.history.agentHealth.push(snapshot.agentHealth);
    this.history.missionProgress.push(snapshot.missionProgress);
    this.history.revenue.push(snapshot.revenue);
    this.history.queueDepth.push(snapshot.queueDepth);
    this.history.memory.push(snapshot.memory);
    this.history.errors.push(snapshot.errors);
    this.history.decisionConfidence.push(snapshot.decisionConfidence);

    for (const key of Object.keys(this.history)) {
      if (Array.isArray(this.history[key]) && this.history[key].length > this.config.historyLimit) {
        this.history[key].shift();
      }
    }

    this.emit('snapshot', snapshot);
    return snapshot;
  }

  getAgentHealthScore(watchdog) {
    if (!watchdog) return 1;
    const status = watchdog.getStatus();
    const total = status.healthy + status.warning + status.dead;
    if (total === 0) return 1;
    return (status.healthy + status.warning * 0.5) / total;
  }

  getMissionProgressScore(missionPlanner) {
    if (!missionPlanner) return 0;
    const status = missionPlanner.getStatus();
    const total = status.total || 0;
    if (total === 0) return 0;
    const completed = status.completed || 0;
    return completed / total;
  }

  getQueueDepth(sources) {
    if (sources.heartbeat) {
      const status = sources.heartbeat.getStatus();
      return status.total - status.healthy;
    }
    if (sources.coreLoop && sources.coreLoop.activeLoops) {
      return sources.coreLoop.activeLoops.size;
    }
    return 0;
  }

  getDashboard(sources = {}) {
    const snapshot = this.recordSnapshot(sources);
    return {
      summary: snapshot,
      charts: this.getCharts(),
      agentHealth: sources.watchdog?.getStatus() || {},
      missionProgress: sources.missionPlanner?.getStatus() || {},
      revenue: sources.decisionIntelligence?.getHistorySummary() || {},
      memory: sources.memorySystem?.getStatus() || {},
      errors: this.getErrorSummary(sources),
      reflections: sources.reflectionEngine?.getStatus() || {},
      decisionConfidence: sources.decisionIntelligence?.getStatus() || {},
      uptime: process.uptime ? process.uptime() : 0,
    };
  }

  getCharts() {
    return {
      timestamps: this.history.timestamps,
      agentHealth: this.history.agentHealth,
      missionProgress: this.history.missionProgress,
      revenue: this.history.revenue,
      queueDepth: this.history.queueDepth,
      memory: this.history.memory,
      errors: this.history.errors,
      decisionConfidence: this.history.decisionConfidence,
    };
  }

  getErrorSummary(sources) {
    const core = sources.coreLoop;
    return {
      loopsFailed: core?.metrics?.loopsFailed || 0,
      totalErrors: this.history.errors.reduce((a, b) => a + b, 0),
      lastError: null,
    };
  }

  exportMetrics(format = 'json') {
    const dashboard = this.getDashboard();
    if (format === 'prometheus') {
      return this.toPrometheus(dashboard);
    }
    return JSON.stringify(dashboard, null, 2);
  }

  toPrometheus(dashboard) {
    const lines = [];
    lines.push(`# HELP hydi_agent_health Current agent health score`);
    lines.push(`# TYPE hydi_agent_health gauge`);
    lines.push(`hydi_agent_health ${dashboard.summary.agentHealth}`);
    lines.push(`# HELP hydi_mission_progress Mission completion ratio`);
    lines.push(`# TYPE hydi_mission_progress gauge`);
    lines.push(`hydi_mission_progress ${dashboard.summary.missionProgress}`);
    lines.push(`# HELP hydi_revenue_total Revenue generated`);
    lines.push(`# TYPE hydi_revenue_total counter`);
    lines.push(`hydi_revenue_total ${dashboard.summary.revenue}`);
    lines.push(`# HELP hydi_queue_depth Pending queue depth`);
    lines.push(`# TYPE hydi_queue_depth gauge`);
    lines.push(`hydi_queue_depth ${dashboard.summary.queueDepth}`);
    lines.push(`# HELP hydi_memory_usage Current memory usage`);
    lines.push(`# TYPE hydi_memory_usage gauge`);
    lines.push(`hydi_memory_usage ${dashboard.summary.memory}`);
    lines.push(`# HELP hydi_errors_total Total errors`);
    lines.push(`# TYPE hydi_errors_total counter`);
    lines.push(`hydi_errors_total ${dashboard.summary.errors}`);
    return lines.join('\n') + '\n';
  }

  getStatus() {
    return {
      snapshots: this.history.timestamps.length,
      lastSnapshot: this.history.timestamps[this.history.timestamps.length - 1] || null,
    };
  }
}

module.exports = ObservabilityDashboard;
