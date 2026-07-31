'use strict';

const { EventEmitter } = require('events');

/**
 * ForecastEngine produces conservative, explainable forecasts for execution
 * duration, resource usage, completion probability, bottlenecks, and risk.
 * It never fabricates precision.
 */
class ForecastEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    this.history = config.history || [];
    this.logger = config.logger || console;
    this.baseRate = config.baseRate || 1; // generic effort units per minute
    this.confidenceThreshold = config.confidenceThreshold || 0.5;
  }

  forecast(task, resources = {}) {
    const duration = this._estimateDuration(task, resources);
    const resourceUsage = this._estimateResourceUsage(task, duration);
    const bottlenecks = this._identifyBottlenecks(task, resources);
    const risk = this._estimateRisk(task, resources);
    const completion = Math.max(0, Math.min(1, 1 - risk.overall - (bottlenecks.length * 0.1)));

    const forecast = {
      taskId: task.id,
      duration,
      resourceUsage,
      completionProbability: parseFloat(completion.toFixed(2)),
      bottlenecks,
      expectedRisk: risk,
      assumptions: [
        `base_rate=${this.baseRate}`,
        `effort=${task.estimatedEffort || 0}`,
        `risk_score=${risk.overall}`,
        `bottleneck_count=${bottlenecks.length}`,
      ],
      ts: Date.now(),
    };
    this.emit('forecast', forecast);
    return { success: true, forecast };
  }

  _estimateDuration(task, resources) {
    const effort = task.estimatedEffort || 0;
    if (effort <= 0) return 0;
    const rate = resources.throughput || this.baseRate;
    const parallel = Math.max(1, resources.nodes || 1);
    const raw = effort / (rate * parallel);
    const uncertainty = 1 + (1 / Math.max(1, this.history.length));
    return Math.ceil(raw * uncertainty * 60 * 1000); // ms
  }

  _estimateResourceUsage(task, durationMs) {
    return {
      cpu: (task.cpu || 0) * (durationMs / 60000),
      ram: (task.ram || 0) * (durationMs / 60000),
      gpu: task.gpu ? 1 : 0,
      storage: task.storage || 0,
    };
  }

  _identifyBottlenecks(task, resources) {
    const list = [];
    if (task.gpu && !resources.gpu) list.push('gpu_required_not_available');
    if ((task.ram || 0) > (resources.ram || 0)) list.push('ram_insufficient');
    if ((task.cpu || 0) > (resources.cpu || 0)) list.push('cpu_insufficient');
    if ((task.dependencies || []).length > 3) list.push('many_dependencies');
    return list;
  }

  _estimateRisk(task, resources) {
    const effort = task.estimatedEffort || 0;
    const deps = (task.dependencies || []).length;
    const risk = {
      execution: Math.min(1, effort / 100),
      dependency: Math.min(1, deps * 0.15),
      resource: (task.gpu && !resources.gpu) ? 0.4 : 0,
      overall: 0,
    };
    risk.overall = Math.min(1, (risk.execution + risk.dependency + risk.resource) / 3);
    return risk;
  }

  explain(forecast) {
    return [
      `Task ${forecast.taskId}: ~${Math.round(forecast.duration / 60000)} min`,
      `completion probability ${(forecast.completionProbability * 100).toFixed(0)}%`,
      `bottlenecks: ${forecast.bottlenecks.join(', ') || 'none'}`,
      `assumptions: ${forecast.assumptions.join('; ')}`,
    ].join(' | ');
  }
}

module.exports = ForecastEngine;
