'use strict';

const PluginRuntime = require('./PluginRuntime');

class CapabilitySandbox extends PluginRuntime {
  constructor(config = {}) {
    super(config);
    this.isolation = {
      filesystem: config.isolation && config.isolation.filesystem !== undefined ? config.isolation.filesystem : true,
      network: config.isolation && config.isolation.network !== undefined ? config.isolation.network : true,
      memory: config.isolation && config.isolation.memory !== undefined ? config.isolation.memory : true,
      processSpawning: config.isolation && config.isolation.processSpawning !== undefined ? config.isolation.processSpawning : true,
      hardware: config.isolation && config.isolation.hardware !== undefined ? config.isolation.hardware : true,
      models: config.isolation && config.isolation.models !== undefined ? config.isolation.models : true,
      externalApis: config.isolation && config.isolation.externalApis !== undefined ? config.isolation.externalApis : true,
    };
    this.budgets = config.budgets || {};
    this.usage = {};
  }

  registerCapability(capability) {
    if (!capability || !capability.id) throw new Error('Capability must declare an id');
    return this.register({
      name: capability.id,
      version: capability.version,
      capabilities: [capability.type, capability.category].filter(Boolean),
      permissions: capability.requiredPermissions || {},
      resourceLimits: capability.resourceLimits || {},
    });
  }

  executeCapability(id, domain, action, args = {}) {
    if (this.isolation[domain] === false) {
      return { success: false, error: `isolation_denied:${domain}` };
    }
    return this.execute(id, domain, action, args);
  }

  withinBudget(id, resource, amount) {
    const limit = (this.budgets[id] && this.budgets[id][resource]) || (this.budgets[resource]);
    if (limit === undefined) return true;
    const used = (this.usage[id] && this.usage[id][resource]) || 0;
    return used + amount <= limit;
  }

  trackUsage(id, resource, amount) {
    if (!this.usage[id]) this.usage[id] = {};
    this.usage[id][resource] = (this.usage[id][resource] || 0) + amount;
  }
}

module.exports = CapabilitySandbox;
