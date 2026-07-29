'use strict';

const { EventEmitter } = require('events');
const os = require('os');

/**
 * ResourceMonitor tracks local and remote node resources: CPU, RAM, GPU,
 * model availability, latency, workload, and lifecycle health.
 */
class ResourceMonitor extends EventEmitter {
  constructor(config = {}) {
    super();
    this.mesh = config.mesh || null;
    this.intervalMs = config.intervalMs || 30000;
    this.logger = config.logger || console;
    this.metrics = new Map();
    this._timer = null;
    this._onHeartbeat = (event) => this._recordHeartbeat(event);
    if (this.mesh) {
      this.mesh.on('node_heartbeat', this._onHeartbeat);
    }
  }

  start() {
    if (this._timer) return this;
    this._timer = setInterval(() => this.sample(), this.intervalMs);
    if (this._timer.unref) this._timer.unref();
    this.sample();
    this.emit('started');
    return this;
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    if (this.mesh) this.mesh.off('node_heartbeat', this._onHeartbeat);
    this.emit('stopped');
    return this;
  }

  sample() {
    const local = this._localMetrics();
    this.metrics.set(local.nodeId, local);
    if (this.mesh && this.mesh.identity) {
      this.mesh.broadcast('heartbeat', local);
    }
    this.emit('sample', local);
    return local;
  }

  _localMetrics() {
    const identity = this.mesh ? this.mesh.identity : { nodeId: 'local' };
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    return {
      nodeId: identity.nodeId,
      ts: Date.now(),
      cpu: Math.min(1, 1 - (os.loadavg()[0] / os.cpus().length)),
      ram: totalMem ? freeMem / totalMem : 0,
      gpu: false,
      disk: 0,
      latency: 0,
      workload: this.mesh && this.mesh.compute ? this.mesh.compute.getStatus().assignments : 0,
      capabilities: this.mesh && this.mesh.compute
        ? [...new Set(this.mesh.compute.getNodes().flatMap((n) => n.capabilities || []))]
        : [],
      health: 'healthy',
    };
  }

  _recordHeartbeat(event) {
    const { nodeId, node } = event;
    const record = {
      nodeId,
      ts: Date.now(),
      cpu: node.cpu,
      ram: node.ram,
      gpu: node.gpu,
      disk: node.disk,
      latency: node.latency,
      workload: node.workload,
      capabilities: node.capabilities,
      health: node.status === 'active' ? 'healthy' : 'unhealthy',
    };
    this.metrics.set(nodeId, record);
    this.emit('metric', record);
  }

  get(nodeId) {
    return this.metrics.get(nodeId) || null;
  }

  getAll() {
    return Array.from(this.metrics.values());
  }

  getHealthy() {
    return this.getAll().filter((m) => m.health === 'healthy');
  }

  hasResource(nodeId, resource) {
    const m = this.metrics.get(nodeId);
    if (!m) return false;
    if (resource === 'gpu') return m.gpu;
    if (resource === 'cpu') return m.cpu > 0;
    if (resource === 'ram') return m.ram > 0;
    if (m.capabilities) return m.capabilities.includes(resource);
    return false;
  }
}

module.exports = ResourceMonitor;
