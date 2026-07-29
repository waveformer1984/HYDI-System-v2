'use strict';

const SnapshotStore = require('./SnapshotStore');

class SnapshotManager {
  constructor(config = {}) {
    this.registry = config.registry || null;
    this.config = config.config || {};
    this.telemetry = config.telemetry || null;
    this.memory = config.memory || null;
    this.agentState = config.agentState || null;
    this.modelState = config.modelState || null;
    this.store = new SnapshotStore({
      dataPath: config.dataPath,
      logger: config.logger,
      maxSnapshots: config.maxSnapshots,
    });
    this.logger = config.logger || console;
  }

  async start() {
    await this.store.start();
    return this;
  }

  async create(label = '') {
    const subsystems = {};
    if (this.registry) subsystems.registry = this.registry.list();
    if (this.config) subsystems.config = this.config;
    if (this.telemetry && typeof this.telemetry.summary === 'function') subsystems.telemetry = this.telemetry.summary();
    if (this.memory && typeof this.memory.getMetrics === 'function') subsystems.memory = this.memory.getMetrics();
    if (this.agentState) subsystems.agents = this.agentState;
    if (this.modelState) subsystems.models = this.modelState;

    const context = {
      subsystems,
      meta: { label, created: Date.now() },
    };
    const snap = await this.store.capture(context);
    return { success: true, ...snap };
  }

  async list() {
    return this.store.list();
  }

  async restore(hashOrLatest = 'latest') {
    const result = await this.store.restore(hashOrLatest);
    if (result.success && this.registry && result.snapshot && result.snapshot.subsystems && result.snapshot.subsystems.registry) {
      for (const c of result.snapshot.subsystems.registry) {
        this.registry.register(c);
      }
    }
    return result;
  }

  async compare(a, b) {
    const ra = await this.store.restore(a);
    const rb = await this.store.restore(b);
    if (!ra.success || !rb.success) {
      return { success: false, error: 'cannot_restore_one_or_both' };
    }
    const changes = [];
    const regA = (ra.snapshot.subsystems && ra.snapshot.subsystems.registry) || [];
    const regB = (rb.snapshot.subsystems && rb.snapshot.subsystems.registry) || [];
    const mapA = new Map(regA.map((c) => [c.name, c]));
    const mapB = new Map(regB.map((c) => [c.name, c]));
    for (const [name, ca] of mapA) {
      const cb = mapB.get(name);
      if (!cb) changes.push({ name, change: 'removed' });
      else if (ca.version !== cb.version) changes.push({ name, change: 'version', from: ca.version, to: cb.version });
    }
    for (const [name] of mapB) {
      if (!mapA.has(name)) changes.push({ name, change: 'added' });
    }
    return { success: true, a, b, changes };
  }
}

module.exports = SnapshotManager;
