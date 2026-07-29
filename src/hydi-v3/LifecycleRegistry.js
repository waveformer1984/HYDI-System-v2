'use strict';

const { EventEmitter } = require('events');

const DEFAULT_COMPONENTS = [
  { name: 'Kernel', category: 'core', version: '1.0.0', phase: 34, capabilities: ['boot', 'lifecycle'] },
  { name: 'Core Services', category: 'core', version: '1.0.0', phase: 34, capabilities: ['events', 'telemetry'] },
  { name: 'Local AI Runtime', category: 'runtime', version: '1.0.0', phase: 34, capabilities: ['inference', 'routing'] },
  { name: 'Memory System', category: 'memory', version: '1.0.0', phase: 34, capabilities: ['recall', 'remember'] },
  { name: 'Agent Framework', category: 'agents', version: '1.0.0', phase: 34, capabilities: ['missions', 'execution'] },
  { name: 'Skills', category: 'skills', version: '1.0.0', phase: 35, capabilities: ['reasoning'] },
  { name: 'Plugins', category: 'plugins', version: '1.0.0', phase: 39, capabilities: ['extension'], permissions: {} },
  { name: 'UI Applications', category: 'ui', version: '1.0.0', phase: 36, capabilities: ['console', 'cockpit'] },
  { name: 'External Connectors', category: 'connectors', version: '1.0.0', phase: 35, capabilities: ['git', 'filesystem'] },
  { name: 'Hardware Integrations', category: 'hardware', version: '1.0.0', phase: 35, capabilities: ['sensors'] },
];

class LifecycleRegistry extends EventEmitter {
  constructor(config = {}) {
    super();
    this.components = new Map();
    this.upgradeHistory = [];
    this.proposals = [];
    this.logger = config.logger || console;
    for (const c of config.components || DEFAULT_COMPONENTS) {
      this.register(c);
    }
  }

  register(component) {
    const entry = {
      name: component.name,
      version: component.version || '0.0.0',
      phase: component.phase || 0,
      category: component.category || 'unknown',
      dependencies: component.dependencies || [],
      capabilities: component.capabilities || [],
      permissions: component.permissions || {},
      health: component.health || 'unknown',
      lastUpgrade: component.lastUpgrade || null,
      rollbackSnapshot: component.rollbackSnapshot || null,
      compatibilityStatus: component.compatibilityStatus || 'compatible',
    };
    this.components.set(entry.name, entry);
    this.emit('registered', entry);
    return entry;
  }

  get(name) {
    return this.components.get(name) || null;
  }

  list() {
    return Array.from(this.components.values());
  }

  setHealth(name, health) {
    const c = this.components.get(name);
    if (!c) return false;
    c.health = health;
    this.emit('health_changed', { name, health });
    return true;
  }

  setCompatibility(name, status) {
    const c = this.components.get(name);
    if (!c) return false;
    c.compatibilityStatus = status;
    return true;
  }

  recordUpgrade({ name, from, to, phase, snapshotHash }) {
    const c = this.components.get(name);
    if (!c) return null;
    const record = { at: Date.now(), name, from, to, phase: phase || c.phase, snapshotHash };
    c.version = to;
    c.lastUpgrade = record.at;
    c.rollbackSnapshot = snapshotHash || null;
    this.upgradeHistory.push(record);
    this.emit('upgraded', record);
    return record;
  }

  healthReport() {
    const all = this.list();
    const healthy = all.filter((c) => c.health === 'healthy').length;
    const degraded = all.filter((c) => c.health === 'degraded').length;
    const unhealthy = all.filter((c) => c.health === 'unhealthy' || c.health === 'unknown').length;
    return { total: all.length, healthy, degraded, unhealthy, components: all };
  }

  recordProposal(proposal) {
    this.proposals.push(proposal);
    this.emit('proposal_added', proposal);
    return proposal;
  }

  getProposals() {
    return this.proposals.slice();
  }

  getUpgradeHistory(limit = 100) {
    return this.upgradeHistory.slice(-limit);
  }
}

module.exports = LifecycleRegistry;
