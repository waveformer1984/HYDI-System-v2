'use strict';

class ExecutivePerformanceDashboard {
  constructor(config = {}) {
    this.telemetry = config.telemetry || null;
    this.runtime = config.runtime || null;
    this.resources = config.resources || null;
    this.memory = config.memory || null;
    this.optimizer = config.optimizer || null;
    this.outcomes = config.outcomes || null;
    this.feedback = config.feedback || null;
    this.logger = config.logger || console;
  }

  runtimeMetrics() {
    const runtimeStates = this.runtime ? this.runtime.allStates() : {};
    const activeTasks = this._activeTaskCount();
    const resourceSnapshot = this.resources ? this.resources.snapshot() : {};
    return {
      uptime: process.uptime(),
      queueDepth: this._queueDepth(),
      activeTasks,
      modelUtilization: this._modelUtilization(runtimeStates),
      resourceUsage: resourceSnapshot,
    };
  }

  _queueDepth() {
    if (!this.runtime || !this.runtime.queues) return 0;
    let total = 0;
    for (const q of this.runtime.queues.values()) total += (q && q.length) || 0;
    return total;
  }

  _activeTaskCount() {
    if (!this.runtime || !this.runtime.active) return 0;
    let count = 0;
    for (const v of this.runtime.active.values()) if (v) count++;
    return count;
  }

  _modelUtilization(states) {
    const out = {};
    for (const [id, s] of Object.entries(states)) {
      out[id] = { state: s.state, warm: s.warm, failures: s.failures };
    }
    return out;
  }

  decisionQuality() {
    const stats = this.outcomes ? this.outcomes.rollingStats() : { count: 0, successRate: 0, fallbackRate: 0, acceptanceRate: 0 };
    const profiles = this.optimizer ? this.optimizer.allProfiles() : [];
    const avgRoutingAccuracy = profiles.length
      ? profiles.reduce((s, p) => s + p.successRate, 0) / profiles.length
      : 0;
    return {
      routingAccuracy: avgRoutingAccuracy,
      recommendationAcceptance: stats.acceptanceRate,
      executionSuccess: stats.successRate,
      fallbackFrequency: stats.fallbackRate,
      modelProfiles: profiles.map((p) => ({ model: p.model, successRate: p.successRate, p95Latency: p.p95Latency, score: p.score })),
    };
  }

  memoryMetrics() {
    if (!this.memory) return { docCount: 0, retrievalAccuracy: 0, duplicateRate: 0, staleCount: 0, contradictionCount: 0, averageQuality: 0, reviewRecommended: 0 };
    const metrics = typeof this.memory.getMetrics === 'function' ? this.memory.getMetrics() : this._fallbackMemoryMetrics();
    return {
      docCount: metrics.docCount || 0,
      retrievalAccuracy: metrics.retrievalAccuracy || 0,
      duplicateRate: metrics.duplicateRate || 0,
      staleCount: metrics.staleCount || 0,
      contradictionCount: metrics.contradictionCount || 0,
      averageQuality: metrics.averageQuality || 0,
      reviewRecommended: metrics.reviewRecommended || 0,
    };
  }

  _fallbackMemoryMetrics() {
    if (!this.memory.embeddingManager) return {};
    const docs = this.memory.embeddingManager.list ? this.memory.embeddingManager.list() : [];
    return { docCount: docs.length, retrievalAccuracy: 0, duplicateRate: 0, staleCount: 0, contradictionCount: 0, averageQuality: 0, reviewRecommended: 0 };
  }

  agentMetrics() {
    const byAgent = this.outcomes ? this.outcomes.byAgent() : {};
    const workloads = {};
    for (const [agent, stats] of Object.entries(byAgent)) {
      workloads[agent] = {
        workload: stats.count,
        completionRate: stats.successRate,
        averageLatency: stats.averageExecutionTime,
      };
    }
    return workloads;
  }

  async fullReport() {
    return {
      generatedAt: new Date().toISOString(),
      runtime: this.runtimeMetrics(),
      decisionQuality: this.decisionQuality(),
      memory: this.memoryMetrics(),
      agents: this.agentMetrics(),
    };
  }
}

module.exports = ExecutivePerformanceDashboard;
