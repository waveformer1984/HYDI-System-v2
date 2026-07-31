'use strict';

const { EventEmitter } = require('events');

class CapabilityRegistry extends EventEmitter {
  constructor(config = {}) {
    super();
    this.capabilities = new Map();
    this.states = new Map();
    this.installations = new Map();
    this.logger = config.logger || console;
  }

  register(capability) {
    const entry = {
      id: capability.id,
      version: capability.version || '0.0.0',
      type: capability.type || 'Skill',
      publisher: capability.publisher || 'unknown',
      description: capability.description || '',
      category: capability.category || 'unknown',
      requiredHYDIVersion: capability.requiredHYDIVersion || '>=0.0.0',
      dependencies: capability.dependencies || [],
      requiredPermissions: capability.requiredPermissions || {},
      hardwareRequirements: capability.hardwareRequirements || {},
      supportedPlatforms: capability.supportedPlatforms || [],
      offlineCompatible: capability.offlineCompatible !== false,
      license: capability.license || 'unknown',
      signature: capability.signature || null,
      digest: capability.digest || null,
      installedAt: null,
      source: capability.source || 'unknown',
    };
    this.capabilities.set(entry.id, entry);
    this.states.set(entry.id, capability.state || 'available');
    this.emit('registered', entry);
    return entry;
  }

  setState(id, state) {
    if (!this.capabilities.has(id)) return false;
    this.states.set(id, state);
    this.emit('state_changed', { id, state });
    return true;
  }

  get(id) {
    const c = this.capabilities.get(id);
    if (!c) return null;
    return { ...c, state: this.states.get(id) || 'available' };
  }

  list() {
    return Array.from(this.capabilities.values()).map((c) => ({ ...c, state: this.states.get(c.id) || 'available' }));
  }

  remove(id) {
    if (!this.capabilities.has(id)) return false;
    this.capabilities.delete(id);
    this.states.delete(id);
    this.emit('removed', { id });
    return true;
  }

  recordInstallation(id, record) {
    this.installations.set(id, record);
    const c = this.capabilities.get(id);
    if (c) c.installedAt = record.at;
    return record;
  }

  getInstallation(id) {
    return this.installations.get(id) || null;
  }

  findByType(type) {
    return this.list().filter((c) => c.type === type);
  }

  findByCategory(category) {
    return this.list().filter((c) => c.category === category);
  }
}

module.exports = CapabilityRegistry;
