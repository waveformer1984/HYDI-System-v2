'use strict';

/**
 * CapabilityGraph tracks which modules provide and consume capabilities,
 * computes startup/shutdown order, and rejects cycles and conflicts.
 */
class CapabilityGraph {
  constructor(kernel) {
    this.kernel = kernel;
    this.providers = new Map(); // capability -> Set(moduleId)
    this.consumers = new Map(); // capability -> Set(moduleId)
    this.dependencies = new Map(); // moduleId -> Set(moduleId)
    this.dependents = new Map(); // moduleId -> Set(moduleId)
    this.moduleCapabilities = new Map(); // moduleId -> { provides: [], consumes: [] }
  }

  register(moduleId, manifest) {
    this.unregister(moduleId);
    const provides = Array.isArray(manifest.capabilities) ? manifest.capabilities.slice() : [];
    const consumes = Array.isArray(manifest.consumes) ? manifest.consumes.slice() : [];
    const dependsOn = Array.isArray(manifest.dependencies) ? manifest.dependencies.slice() : [];

    this.moduleCapabilities.set(moduleId, { provides, consumes, dependencies: dependsOn });

    for (const cap of provides) {
      if (!this.providers.has(cap)) this.providers.set(cap, new Set());
      this.providers.get(cap).add(moduleId);
    }
    for (const cap of consumes) {
      if (!this.consumers.has(cap)) this.consumers.set(cap, new Set());
      this.consumers.get(cap).add(moduleId);
    }

    this.dependencies.set(moduleId, new Set(dependsOn));
    if (!this.dependents.has(moduleId)) this.dependents.set(moduleId, new Set());
    for (const dep of dependsOn) {
      if (!this.dependents.has(dep)) this.dependents.set(dep, new Set());
      this.dependents.get(dep).add(moduleId);
    }
  }

  unregister(moduleId) {
    const existing = this.moduleCapabilities.get(moduleId);
    if (!existing) return;
    for (const cap of existing.provides) {
      this.providers.get(cap)?.delete(moduleId);
    }
    for (const cap of existing.consumes) {
      this.consumers.get(cap)?.delete(moduleId);
    }
    for (const dep of existing.dependencies) {
      this.dependents.get(dep)?.delete(moduleId);
    }
    this.dependencies.delete(moduleId);
    this.dependents.delete(moduleId);
    this.moduleCapabilities.delete(moduleId);
  }

  getProviders(capability) {
    return Array.from(this.providers.get(capability) || new Set());
  }

  getConsumers(capability) {
    return Array.from(this.consumers.get(capability) || new Set());
  }

  getDependencies(moduleId) {
    return Array.from(this.dependencies.get(moduleId) || new Set());
  }

  getDependents(moduleId) {
    return Array.from(this.dependents.get(moduleId) || new Set());
  }

  /**
   * Topological sort of dependencies for startup order.
   */
  getStartupOrder(moduleIds = Array.from(this.moduleCapabilities.keys())) {
    const visiting = new Set();
    const visited = new Set();
    const order = [];

    const visit = (id) => {
      if (visiting.has(id)) throw new Error(`circular dependency detected involving ${id}`);
      if (visited.has(id)) return;
      visiting.add(id);
      for (const dep of this.getDependencies(id)) {
        if (moduleIds.includes(dep)) visit(dep);
      }
      visiting.delete(id);
      visited.add(id);
      order.push(id);
    };

    for (const id of moduleIds) visit(id);
    return order;
  }

  getShutdownOrder(moduleIds = Array.from(this.moduleCapabilities.keys())) {
    return this.getStartupOrder(moduleIds).reverse();
  }

  detectConflicts() {
    const conflicts = [];
    for (const [capability, set] of this.providers) {
      if (set.size > 1) {
        conflicts.push({ capability, providers: Array.from(set), type: 'multiple_providers' });
      }
    }
    return conflicts;
  }

  detectMissingCapabilities() {
    const missing = [];
    for (const [capability, consumersSet] of this.consumers) {
      const providers = this.providers.get(capability);
      if (!providers || providers.size === 0) {
        missing.push({ capability, consumers: Array.from(consumersSet), type: 'missing_provider' });
      }
    }
    for (const [moduleId, data] of this.moduleCapabilities) {
      for (const dep of data.dependencies) {
        if (!this.moduleCapabilities.has(dep)) {
          missing.push({ moduleId, dependency: dep, type: 'missing_dependency' });
        }
      }
    }
    return missing;
  }

  toJSON() {
    return {
      providers: Object.fromEntries(Array.from(this.providers).map(([k, v]) => [k, Array.from(v)])),
      consumers: Object.fromEntries(Array.from(this.consumers).map(([k, v]) => [k, Array.from(v)])),
      dependencies: Object.fromEntries(Array.from(this.dependencies).map(([k, v]) => [k, Array.from(v)])),
      moduleCapabilities: Object.fromEntries(this.moduleCapabilities),
    };
  }
}

module.exports = CapabilityGraph;
