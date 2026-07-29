'use strict';

const { EventEmitter } = require('events');

/**
 * FederationMetrics collects and exposes swarm-wide metrics: throughput,
 * latency, task success/failure rates, resource utilization, and queue depth.
 */
class FederationMetrics extends EventEmitter {
  constructor(config = {}) {
    super();
    this.mesh = config.mesh || null;
    this.queue = config.queue || config.distributedQueue || null;
    this.taskManager = config.taskManager || null;
    this.monitor = config.monitor || config.resourceMonitor || null;
    this.historyLimit = config.historyLimit || 1440;
    this.metrics = [];
    this.counters = {
      tasksSubmitted: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      migrations: 0,
    };
  }

  record(type, value, labels = {}) {
    const point = { at: Date.now(), type, value, labels };
    this.metrics.push(point);
    if (this.metrics.length > this.historyLimit) this.metrics.shift();
    this.emit('metric', point);
    return point;
  }

  snapshot() {
    const queueStats = this.queue ? this.queue.stats() : { queued: 0, reserved: 0, completed: 0 };
    const taskList = this.taskManager ? this.taskManager.list() : [];
    const nodes = this.mesh ? this.mesh.getPeers() : [];
    const resources = this.monitor ? this.monitor.getAll() : [];
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    return {
      ts: now,
      nodes: {
        total: nodes.length,
        healthy: resources.filter((r) => r.health === 'healthy').length,
        unhealthy: resources.filter((r) => r.health !== 'healthy').length,
      },
      queue: queueStats,
      tasks: {
        total: this.counters.tasksSubmitted,
        completed: this.counters.tasksCompleted,
        failed: this.counters.tasksFailed,
        completedLastMinute: taskList.filter((t) => t.completedAt && t.completedAt > oneMinuteAgo).length,
        failedLastMinute: taskList.filter((t) => t.failedAt && t.failedAt > oneMinuteAgo).length,
      },
      resources: resources.map((r) => ({
        nodeId: r.nodeId,
        cpu: r.cpu,
        ram: r.ram,
        gpu: r.gpu,
        workload: r.workload,
        latency: r.latency,
        health: r.health,
      })),
      migrations: this.counters.migrations,
    };
  }

  increment(name, labels = {}) {
    if (this.counters[name] !== undefined) this.counters[name] += 1;
    this.record(name, this.counters[name], labels);
    return this.counters[name];
  }

  getTrend(metric, windowMs = 600000) {
    const now = Date.now();
    const points = this.metrics.filter((m) => m.type === metric && m.at > now - windowMs);
    if (points.length < 2) return null;
    const first = points[0];
    const last = points[points.length - 1];
    const dt = last.at - first.at;
    const slope = dt ? (last.value - first.value) / dt : 0;
    return { metric, points: points.length, slope, first: first.value, last: last.value };
  }

  export(format = 'json') {
    const snap = this.snapshot();
    if (format === 'json') return JSON.stringify(snap, null, 2);
    const rows = [
      'metric,value,nodeId',
      ...snap.resources.map((r) => `cpu,${r.cpu},${r.nodeId}`),
      ...snap.resources.map((r) => `ram,${r.ram},${r.nodeId}`),
      `queue_queued,${snap.queue.queued},`,
      `tasks_completed,${snap.tasks.completed},`,
      `tasks_failed,${snap.tasks.failed},`,
    ];
    return rows.join('\n');
  }
}

module.exports = FederationMetrics;
