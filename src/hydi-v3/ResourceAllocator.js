'use strict';

const { EventEmitter } = require('events');

/**
 * ResourceAllocator tracks and recommends allocation of CPU, GPU, memory,
 * storage, models, federation capacity, and human approval requirements.
 */
class ResourceAllocator extends EventEmitter {
  constructor(config = {}) {
    super();
    this.monitor = config.resourceMonitor || null;
    this.capabilityBroker = config.capabilityBroker || null;
    this.resources = new Map();
    this.allocations = new Map();
    this.logger = config.logger || console;
  }

  addResource(id, capacities) {
    const resource = {
      id,
      cpu: capacities.cpu || 0,
      gpu: capacities.gpu || 0,
      ram: capacities.ram || 0,
      storage: capacities.storage || 0,
      models: capacities.models || [],
      capabilities: capacities.capabilities || [],
      federation: capacities.federation || 0,
      approvals: capacities.approvals || 0,
    };
    this.resources.set(id, resource);
    this.emit('resource_added', resource);
    return resource;
  }

  available() {
    const total = { cpu: 0, gpu: 0, ram: 0, storage: 0, federation: 0, approvals: 0 };
    if (this.monitor) {
      const metrics = this.monitor.getAll();
      for (const m of metrics) {
        total.cpu += m.cpu || 0;
        total.ram += m.ram || 0;
        total.gpu += m.gpu ? 1 : 0;
        total.federation += 1;
      }
    } else {
      for (const r of this.resources.values()) {
        total.cpu += r.cpu;
        total.gpu += r.gpu;
        total.ram += r.ram;
        total.storage += r.storage;
        total.federation += r.federation;
        total.approvals += r.approvals;
      }
    }
    return total;
  }

  request(task, options = {}) {
    const needed = {
      cpu: task.cpu || 0,
      gpu: task.gpu ? 1 : 0,
      ram: task.ram || 0,
      storage: task.storage || 0,
      model: task.model || null,
      capability: task.capability || null,
      approvals: task.approvals ? 1 : 0,
    };

    const available = this.available();
    const reasons = [];
    let feasible = true;
    if (needed.cpu > available.cpu) { feasible = false; reasons.push('insufficient_cpu'); }
    if (needed.ram > available.ram) { feasible = false; reasons.push('insufficient_ram'); }
    if (needed.gpu > available.gpu) { feasible = false; reasons.push('no_gpu'); }
    if (needed.storage > available.storage) { feasible = false; reasons.push('insufficient_storage'); }

    if (needed.capability && this.capabilityBroker) {
      const providers = this.capabilityBroker.findProviders(needed.capability, { trusted: true });
      if (providers.length === 0) { feasible = false; reasons.push('capability_unavailable'); }
    }

    if (!feasible) return { success: false, error: 'resource_exhausted', reasons, needed, available };

    const allocation = {
      taskId: task.id,
      resources: { ...needed },
      options,
      at: Date.now(),
    };
    this.allocations.set(task.id, allocation);
    this.emit('allocated', allocation);
    return { success: true, allocation };
  }

  release(taskId) {
    const allocation = this.allocations.get(taskId);
    if (!allocation) return { success: false, error: 'not_found' };
    this.allocations.delete(taskId);
    this.emit('released', allocation);
    return { success: true };
  }
}

module.exports = ResourceAllocator;
