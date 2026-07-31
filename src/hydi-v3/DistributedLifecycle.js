'use strict';

const { EventEmitter } = require('events');

/**
 * DistributedLifecycle integrates federation nodes with the local
 * LifecycleRegistry and provides snapshots, upgrade coordination, and health
 * reporting. It does not replace the existing lifecycle systems; it extends them.
 */
class DistributedLifecycle extends EventEmitter {
  constructor(config = {}) {
    super();
    this.registry = config.lifecycleRegistry || null;
    this.snapshotManager = config.snapshotManager || null;
    this.upgradeManager = config.upgradeManager || null;
    this.compatibility = config.compatibilityManager || null;
    this.observability = config.observability || null;
    this.logger = config.logger || console;
    this.nodeEvents = new Map();
    if (this.registry) {
      this.registry.register({
        name: 'Federation',
        category: 'federation',
        version: config.version || '1.0.0',
        phase: 41,
        capabilities: ['discovery', 'transport', 'mesh', 'sync'],
        permissions: {},
        health: 'healthy',
      });
    }
  }

  registerNode(nodeId, components) {
    if (!this.registry) return { success: false, error: 'no_registry' };
    const entry = {
      name: `Node:${nodeId}`,
      category: 'federation_node',
      version: components && components.version ? components.version : '0.0.0',
      phase: 41,
      capabilities: (components && components.capabilities) || [],
      permissions: {},
      health: 'healthy',
    };
    this.registry.register(entry);
    this.nodeEvents.set(nodeId, []);
    this.emit('node_registered', { nodeId, entry });
    return { success: true, entry };
  }

  recordEvent(nodeId, event) {
    const log = { at: Date.now(), nodeId, ...event };
    const list = this.nodeEvents.get(nodeId) || [];
    list.push(log);
    this.nodeEvents.set(nodeId, list);
    if (this.registry) this.registry.recordProposal(log);
    this.emit('event', log);
    return log;
  }

  async prepareSnapshot(label = 'federation-snapshot') {
    if (!this.snapshotManager) return { success: false, error: 'no_snapshot_manager' };
    return this.snapshotManager.create(label);
  }

  async proposeUpgrade(component, targetVersion) {
    if (!this.upgradeManager) return { success: false, error: 'no_upgrade_manager' };
    const proposal = { name: component, proposed: targetVersion };
    return this.upgradeManager.analyze(proposal);
  }

  async checkCompatibility(targets) {
    if (!this.compatibility) return { success: true, overall: 'compatible', results: [] };
    const overall = this.compatibility.checkGraph(targets);
    this.emit('compatibility', overall);
    return overall;
  }

  syncTo(targetRegistry) {
    if (!this.registry || !targetRegistry) return { success: false, error: 'missing_registry' };
    const components = this.registry.list();
    for (const c of components) {
      targetRegistry.register(c);
    }
    return { success: true, synced: components.length };
  }

  healthReport() {
    const report = this.registry ? this.registry.healthReport() : { healthy: 0, total: 0 };
    return {
      ...report,
      nodes: Array.from(this.nodeEvents.keys()),
      nodeEventCount: Array.from(this.nodeEvents.values()).reduce((sum, l) => sum + l.length, 0),
    };
  }
}

module.exports = DistributedLifecycle;
