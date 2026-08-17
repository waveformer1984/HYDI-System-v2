'use strict';

const { EventEmitter } = require('events');

/**
 * ObservabilityDashboard aggregates metrics for agent health, mission progress,
 * revenue, queue depth, memory, database, errors, reflection summaries, decision
 * confidence, system uptime, GPU usage, network latency, revenue/failure trends,
 * recovery events, mission replay, and historical analytics. It supports
 * historical charts, metric export, and health scoring.
 */
class ObservabilityDashboard extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      historyLimit: config.historyLimit || 1440,
      trendWindowMs: config.trendWindowMs || 600000,
      recoveryEventLimit: config.recoveryEventLimit || 1000,
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
      gpuUsage: [],
      networkLatency: [],
      reflectionStats: [],
      failureTrend: [],
      revenueTrend: [],
      recoveryEvents: [],
      healthScore: [],
    };

    this.recoveryEvents = [];
    this._lastSnapshot = null;
    this._lastSources = null;
    this._watched = new WeakSet();
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
      gpuUsage: this.getGPUUsage(sources),
      networkLatency: this.getNetworkLatency(sources),
      reflectionStats: this.getReflectionStats(sources),
      recoveryEvents: this.getRecoveryEventCount(sources),
    };

    this.history.timestamps.push(now);
    this.history.agentHealth.push(snapshot.agentHealth);
    this.history.missionProgress.push(snapshot.missionProgress);
    this.history.revenue.push(snapshot.revenue);
    this.history.queueDepth.push(snapshot.queueDepth);
    this.history.memory.push(snapshot.memory);
    this.history.errors.push(snapshot.errors);
    this.history.decisionConfidence.push(snapshot.decisionConfidence);
    this.history.gpuUsage.push(snapshot.gpuUsage);
    this.history.networkLatency.push(snapshot.networkLatency);
    this.history.reflectionStats.push(snapshot.reflectionStats.totalReflections || 0);
    this.history.recoveryEvents.push(snapshot.recoveryEvents);

    const revenueTrend = this.getTrend('revenue', this.config.trendWindowMs);
    const failureTrend = this.getTrend('errors', this.config.trendWindowMs);
    snapshot.revenueTrend = revenueTrend ? revenueTrend.slope : 0;
    snapshot.failureTrend = failureTrend ? failureTrend.slope : 0;
    snapshot.healthScore = this.computeHealthScore(snapshot);

    this.history.revenueTrend.push(snapshot.revenueTrend);
    this.history.failureTrend.push(snapshot.failureTrend);
    this.history.healthScore.push(snapshot.healthScore);

    for (const key of Object.keys(this.history)) {
      if (Array.isArray(this.history[key]) && this.history[key].length > this.config.historyLimit) {
        this.history[key].shift();
      }
    }

    this._lastSnapshot = snapshot;
    this._lastSources = sources;
    this.emit('snapshot', snapshot);
    return snapshot;
  }

  getAgentHealthScore(watchdog) {
    if (!watchdog || typeof watchdog.getStatus !== 'function') return 1;
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
    if (sources.heartbeat && typeof sources.heartbeat.getStatus === 'function') {
      const status = sources.heartbeat.getStatus();
      return status.total - status.healthy;
    }
    if (sources.coreLoop && sources.coreLoop.activeLoops) {
      return sources.coreLoop.activeLoops.size;
    }
    return 0;
  }

  getGPUUsage(sources) {
    const core = sources.coreLoop;
    if (core && typeof core.getGPUUsage === 'function') {
      return core.getGPUUsage();
    }
    if (sources.gpu && typeof sources.gpu.getUsage === 'function') {
      return sources.gpu.getUsage();
    }
    return 0;
  }

  getNetworkLatency(sources) {
    const core = sources.coreLoop;
    if (core && typeof core.getNetworkLatency === 'function') {
      return core.getNetworkLatency();
    }
    if (sources.network && typeof sources.network.getLatency === 'function') {
      return sources.network.getLatency();
    }
    return 0;
  }

  getReflectionStats(sources) {
    const status = sources.reflectionEngine?.getStatus?.() || {};
    const allRankings = [];
    const rankings = status.rankings || {};
    for (const category of Object.keys(rankings)) {
      for (const entry of rankings[category] || []) {
        allRankings.push(entry);
      }
    }
    allRankings.sort((a, b) => (b.score || 0) - (a.score || 0));

    return {
      totalReflections: status.totalReflections || 0,
      latestRevenue: status.latestReflection?.revenue || 0,
      topStrategy: allRankings[0] || null,
    };
  }

  attachRecoveryListeners(sources) {
    if (sources.watchdog && sources.watchdog.on && !this._watched.has(sources.watchdog)) {
      sources.watchdog.on('agent_recovered', (event) => this.recordRecoveryEvent('watchdog', 'agent_recovered', event));
      this._watched.add(sources.watchdog);
    }
    if (sources.selfHealing && sources.selfHealing.on && !this._watched.has(sources.selfHealing)) {
      sources.selfHealing.on('healing_completed', (event) => this.recordRecoveryEvent('selfHealing', 'healing_completed', event));
      this._watched.add(sources.selfHealing);
    }
  }

  recordRecoveryEvent(source, type, event) {
    this.recoveryEvents.push({
      source,
      type,
      timestamp: new Date().toISOString(),
      ...event,
    });
    if (this.recoveryEvents.length > this.config.recoveryEventLimit) {
      this.recoveryEvents = this.recoveryEvents.slice(-this.config.recoveryEventLimit);
    }
  }

  getRecoveryEventCount(sources) {
    this.attachRecoveryListeners(sources);
    return this.recoveryEvents.length;
  }

  getDashboard(sources = this._lastSources || {}) {
    const snapshot = this.recordSnapshot(sources);
    const call = (obj, method) => (obj && typeof obj[method] === 'function' ? obj[method]() : undefined);
    return {
      summary: snapshot,
      charts: this.getCharts(),
      agentHealth: call(sources.watchdog, 'getStatus') || {},
      missionProgress: call(sources.missionPlanner, 'getStatus') || {},
      revenue: call(sources.decisionIntelligence, 'getHistorySummary') || {},
      memory: call(sources.memorySystem, 'getStatus') || {},
      errors: this.getErrorSummary(sources),
      reflections: call(sources.reflectionEngine, 'getStatus') || {},
      decisionConfidence: call(sources.decisionIntelligence, 'getStatus') || {},
      uptime: process.uptime ? process.uptime() : 0,
      networkLatency: snapshot.networkLatency,
      gpuUsage: snapshot.gpuUsage,
      reflectionStats: snapshot.reflectionStats,
      revenueTrend: snapshot.revenueTrend,
      failureTrend: snapshot.failureTrend,
      recoveryEvents: this.recoveryEvents.slice(-10),
      missionReplay: this.getMissionReplay(null, sources),
      historicalAnalytics: this.getHistoricalAnalytics(),
      healthScore: snapshot.healthScore,
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
      gpuUsage: this.history.gpuUsage,
      networkLatency: this.history.networkLatency,
      reflectionStats: this.history.reflectionStats,
      failureTrend: this.history.failureTrend,
      revenueTrend: this.history.revenueTrend,
      recoveryEvents: this.history.recoveryEvents,
      healthScore: this.history.healthScore,
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

  getMissionReplay(missionId, sources = {}) {
    const planner = sources.missionPlanner;
    if (!planner) return null;

    if (missionId) {
      const mission = planner.getMission(missionId);
      return mission ? this.buildReplay(mission) : null;
    }

    const missions = typeof planner.getMissions === 'function' ? planner.getMissions().slice(-5) : [];
    return { missions: missions.map((m) => this.buildReplay(m)) };
  }

  buildReplay(mission) {
    const tasks = mission.tasks || [];
    return {
      missionId: mission.id,
      name: mission.name,
      status: mission.status,
      progress: mission.progress || 0,
      taskCount: tasks.length,
      completedCount: tasks.filter((t) => t.status === 'completed').length,
      failedCount: tasks.filter((t) => t.status === 'failed').length,
      replay: tasks.map((t) => ({
        id: t.id,
        status: t.status,
        type: t.type,
        startedAt: t.startedAt || null,
        completedAt: t.completedAt || null,
        failedAt: t.failedAt || null,
        duration: this.computeDuration(t.startedAt, t.completedAt || t.failedAt),
      })),
    };
  }

  computeDuration(start, end) {
    if (!start || !end) return null;
    return new Date(end).getTime() - new Date(start).getTime();
  }

  getTrend(metric, durationMs = this.config.trendWindowMs) {
    if (!this.history[metric] || !this.history.timestamps.length) return null;

    const now = Date.now();
    const cutoff = typeof durationMs === 'number' ? now - durationMs : 0;
    const pairs = [];

    for (let i = 0; i < this.history.timestamps.length; i++) {
      const ts = Date.parse(this.history.timestamps[i]);
      if (typeof durationMs === 'number' && ts < cutoff) continue;
      const value = this.history[metric][i];
      if (typeof value === 'number') {
        pairs.push({ timestamp: this.history.timestamps[i], ts, value });
      }
    }

    if (!pairs.length) return null;

    const values = pairs.map((p) => p.value);
    const timestamps = pairs.map((p) => p.timestamp);
    const current = values[values.length - 1];
    const first = values[0];
    const average = values.reduce((a, b) => a + b, 0) / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const periodMs = pairs[pairs.length - 1].ts - pairs[0].ts;
    const delta = current - first;
    const slope = periodMs > 0 ? delta / periodMs : 0;

    return {
      timestamps,
      values,
      current,
      first,
      average,
      min,
      max,
      delta,
      periodMs,
      slope,
      ratePerSecond: slope * 1000,
    };
  }

  getHistoricalAnalytics(durationMs = this.config.trendWindowMs) {
    const analytics = {
      periodMs: durationMs,
      snapshots: this.history.timestamps.length,
    };

    const numericMetrics = [
      'agentHealth',
      'missionProgress',
      'queueDepth',
      'memory',
      'decisionConfidence',
      'gpuUsage',
      'networkLatency',
      'reflectionStats',
      'recoveryEvents',
      'healthScore',
    ];

    for (const metric of numericMetrics) {
      const trend = this.getTrend(metric, durationMs);
      analytics[`avg${this.capitalize(metric)}`] = trend ? trend.average : 0;
    }

    const revenueTrend = this.getTrend('revenue', durationMs);
    const errorTrend = this.getTrend('errors', durationMs);

    analytics.totalRevenue = revenueTrend ? revenueTrend.current : 0;
    analytics.totalErrors = errorTrend ? errorTrend.current : 0;
    analytics.revenueGrowthPerSecond = revenueTrend ? revenueTrend.ratePerSecond : 0;
    analytics.failureRatePerSecond = errorTrend ? errorTrend.ratePerSecond : 0;
    const reflectionTrend = this.getTrend('reflectionStats', durationMs);
    analytics.totalReflections = reflectionTrend ? Math.round(reflectionTrend.current) : 0;

    return analytics;
  }

  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  computeHealthScore(snapshot) {
    const errorRate = Math.min(1, Math.max(0, snapshot.failureTrend * 1000));
    const queuePressure = Math.min(1, snapshot.queueDepth / 1000);
    const memoryPressure = typeof snapshot.memory === 'number' ? Math.min(1, snapshot.memory) : 1;

    const health =
      0.3 * snapshot.agentHealth +
      0.2 * snapshot.missionProgress +
      0.2 * snapshot.decisionConfidence +
      0.1 * (1 - errorRate) +
      0.1 * (1 - queuePressure) +
      0.1 * (1 - memoryPressure);

    return Math.max(0, Math.min(1, health));
  }

  getHealthScore() {
    if (!this._lastSnapshot) return 1;
    return this._lastSnapshot.healthScore;
  }

  exportMetrics(format = 'json') {
    const dashboard = this.getDashboard();
    if (format === 'prometheus') {
      return this.toPrometheus(dashboard);
    }
    return JSON.stringify(dashboard, null, 2);
  }

  exportDashboard(format = 'json', options = {}) {
    const sources = options?.sources || this._lastSources || {};
    const dashboard = this.getDashboard(sources);
    if (format === 'csv') {
      return this.toCsv(dashboard, options);
    }
    return JSON.stringify(dashboard, null, 2);
  }

  toCsv(dashboard, options = {}) {
    const includeHistory = options?.includeHistory || false;
    const headers = [
      'timestamp',
      'agentHealth',
      'missionProgress',
      'revenue',
      'queueDepth',
      'memory',
      'errors',
      'decisionConfidence',
      'gpuUsage',
      'networkLatency',
      'reflectionStats',
      'failureTrend',
      'revenueTrend',
      'recoveryEvents',
      'healthScore',
    ];

    if (!includeHistory) {
      const row = headers.map((key) => {
        const value = key === 'reflectionStats' ? JSON.stringify(dashboard.summary[key]) : dashboard.summary[key];
        return this.csvEscape(value);
      });
      return `${headers.join(',')}\n${row.join(',')}\n`;
    }

    const lines = [headers.join(',')];
    for (let i = 0; i < this.history.timestamps.length; i++) {
      const row = headers.map((key) => {
        const historyKey = key === 'timestamp' ? 'timestamps' : key;
        const value = this.history[historyKey][i];
        return this.csvEscape(value);
      });
      lines.push(row.join(','));
    }
    return lines.join('\n') + '\n';
  }

  csvEscape(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
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
    lines.push(`# HELP hydi_health_score Overall system health score`);
    lines.push(`# TYPE hydi_health_score gauge`);
    lines.push(`hydi_health_score ${dashboard.summary.healthScore}`);
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
