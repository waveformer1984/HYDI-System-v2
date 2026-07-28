'use strict';

class ExecutionOutcomeTracker {
  constructor(config = {}) {
    this.telemetry = config.telemetry || null;
    this.logger = config.logger || console;
    this.maxInMemory = config.maxInMemory || 1000;
    this.outcomes = [];
  }

  record({ task, selectedModel, selectedAgent, executionTime, retries, fallbackUsed, approvalRequired, operatorAcceptance, operatorCorrection, finalOutcome, confidence, meta }) {
    const entry = {
      at: Date.now(),
      type: 'execution_outcome',
      task: task || 'unknown',
      selectedModel: selectedModel || null,
      selectedAgent: selectedAgent || null,
      executionTime: typeof executionTime === 'number' ? executionTime : 0,
      retries: typeof retries === 'number' ? retries : 0,
      fallbackUsed: fallbackUsed === true,
      approvalRequired: approvalRequired === true,
      operatorAcceptance: typeof operatorAcceptance === 'number' ? operatorAcceptance : 0,
      operatorCorrection: operatorCorrection || null,
      finalOutcome: finalOutcome || 'unknown',
      confidence: typeof confidence === 'number' ? confidence : null,
      meta: meta || {},
    };
    this.outcomes.push(entry);
    if (this.outcomes.length > this.maxInMemory) this.outcomes.shift();
    if (this.telemetry && typeof this.telemetry.record === 'function') {
      this.telemetry.record(entry);
    }
    return entry;
  }

  rollingStats(windowMs = 3600000) {
    const now = Date.now();
    const window = this.outcomes.filter((o) => now - o.at <= windowMs);
    if (!window.length) {
      return { count: 0, successRate: 0, avgExecutionTime: 0, fallbackRate: 0, approvalRate: 0, acceptanceRate: 0 };
    }
    const count = window.length;
    const success = window.filter((o) => o.finalOutcome === 'success').length;
    const fallback = window.filter((o) => o.fallbackUsed).length;
    const approval = window.filter((o) => o.approvalRequired).length;
    const accepted = window.filter((o) => o.operatorAcceptance > 0).length;
    const avgTime = window.reduce((s, o) => s + o.executionTime, 0) / count;
    return {
      count,
      successRate: success / count,
      avgExecutionTime: avgTime,
      fallbackRate: fallback / count,
      approvalRate: approval / count,
      acceptanceRate: accepted / count,
    };
  }

  byModel() {
    const map = new Map();
    for (const o of this.outcomes) {
      const key = o.selectedModel || 'unknown';
      if (!map.has(key)) map.set(key, { count: 0, success: 0, time: 0, fallback: 0 });
      const m = map.get(key);
      m.count++;
      if (o.finalOutcome === 'success') m.success++;
      m.time += o.executionTime;
      if (o.fallbackUsed) m.fallback++;
    }
    const result = {};
    for (const [k, v] of map) {
      result[k] = {
        count: v.count,
        successRate: v.count ? v.success / v.count : 0,
        averageExecutionTime: v.count ? v.time / v.count : 0,
        fallbackRate: v.count ? v.fallback / v.count : 0,
      };
    }
    return result;
  }

  byAgent() {
    const map = new Map();
    for (const o of this.outcomes) {
      const key = o.selectedAgent || 'unknown';
      if (!map.has(key)) map.set(key, { count: 0, success: 0, time: 0 });
      const m = map.get(key);
      m.count++;
      if (o.finalOutcome === 'success') m.success++;
      m.time += o.executionTime;
    }
    const result = {};
    for (const [k, v] of map) {
      result[k] = {
        count: v.count,
        successRate: v.count ? v.success / v.count : 0,
        averageExecutionTime: v.count ? v.time / v.count : 0,
      };
    }
    return result;
  }
}

module.exports = ExecutionOutcomeTracker;
