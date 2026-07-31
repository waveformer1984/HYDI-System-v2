'use strict';

const { EventEmitter } = require('events');

/**
 * SwarmDashboard renders the current state of the collaborative execution
 * fabric for operators. It aggregates the coordinator, metrics, resources,
 * queue, and consensus into a single human-readable snapshot.
 */
class SwarmDashboard extends EventEmitter {
  constructor(config = {}) {
    super();
    this.coordinator = config.coordinator || null;
    this.metrics = config.metrics || config.federationMetrics || null;
    this.monitor = config.monitor || config.resourceMonitor || null;
    this.queue = config.queue || config.distributedQueue || null;
    this.historyLimit = config.historyLimit || 1440;
    this.snapshots = [];
  }

  snapshot() {
    const swarm = this.coordinator ? this.coordinator.status() : null;
    const resources = this.monitor ? this.monitor.getAll() : [];
    const queue = this.queue ? this.queue.stats() : null;
    const metrics = this.metrics ? this.metrics.snapshot() : null;
    const topNodes = resources
      .sort((a, b) => (b.cpu + b.ram) - (a.cpu + a.ram))
      .slice(0, 5)
      .map((r) => ({
        nodeId: r.nodeId,
        cpu: (r.cpu * 100).toFixed(0),
        ram: (r.ram * 100).toFixed(0),
        gpu: r.gpu,
        workload: r.workload,
        health: r.health,
      }));

    const status = {
      ts: Date.now(),
      running: swarm ? swarm.started : false,
      nodes: resources.length,
      healthy: resources.filter((r) => r.health === 'healthy').length,
      queue,
      topNodes,
      metrics: metrics ? {
        completed: metrics.tasks.completed,
        failed: metrics.tasks.failed,
        migrations: metrics.migrations,
      } : null,
      consensus: swarm ? swarm.consensus : [],
    };
    this.snapshots.push(status);
    if (this.snapshots.length > this.historyLimit) this.snapshots.shift();
    this.emit('snapshot', status);
    return status;
  }

  render() {
    const s = this.snapshot();
    return {
      summary: `Swarm: ${s.healthy}/${s.nodes} healthy, queue ${s.queue ? s.queue.queued + '/' + s.queue.reserved : 'N/A'}, completed ${s.metrics ? s.metrics.completed : 0}`,
      started: s.running,
      peers: s.nodes,
      healthy: s.healthy,
      queued: s.queue ? s.queue.queued : 0,
      reserved: s.queue ? s.queue.reserved : 0,
      completed: s.metrics ? s.metrics.completed : 0,
      failed: s.metrics ? s.metrics.failed : 0,
      topNodes: s.topNodes,
      ts: s.ts,
    };
  }

  getHistory(limit = 100) {
    return this.snapshots.slice(-limit);
  }
}

module.exports = SwarmDashboard;
