'use strict';

const { randomUUID } = require('crypto');
const HModule = require('./HModule');

/**
 * ModuleRegistry owns every kernel module's lifecycle and metadata.
 *
 * It enforces the HModule contract, supports hot enable/disable, upgrade,
 * rollback, and ordered initialize/start/stop/dispose via the capability graph.
 */
class ModuleRegistry {
  constructor(kernel) {
    this.kernel = kernel;
    this.modules = new Map();
    this.enabled = new Set();
    this.history = new Map();
    this._validators = [
      (m) => (m.id ? null : 'missing id'),
      (m) => (typeof m.version === 'string' ? null : 'missing version'),
      (m) => (typeof m.name === 'string' ? null : 'missing name'),
      (m) => (typeof m.health === 'function' ? null : 'health() not implemented'),
      (m) => (typeof m.initialize === 'function' ? null : 'initialize() not implemented'),
      (m) => (typeof m.start === 'function' ? null : 'start() not implemented'),
      (m) => (typeof m.stop === 'function' ? null : 'stop() not implemented'),
      (m) => (typeof m.dispose === 'function' ? null : 'dispose() not implemented'),
      (m) => (typeof m.upgrade === 'function' ? null : 'upgrade() not implemented'),
      (m) => (typeof m.rollback === 'function' ? null : 'rollback() not implemented'),
    ];
  }

  validate(moduleInstance) {
    const errors = this._validators.map((fn) => fn(moduleInstance)).filter(Boolean);
    if (errors.length > 0) {
      throw new Error(`Module ${moduleInstance.id || '?'} validation failed: ${errors.join(', ')}`);
    }
  }

  register(moduleInstance) {
    if (!(moduleInstance instanceof HModule) && typeof moduleInstance?.health !== 'function') {
      throw new Error('registered object must extend HModule or implement the lifecycle contract');
    }
    this.validate(moduleInstance);
    this.modules.set(moduleInstance.id, moduleInstance);
    this.enabled.add(moduleInstance.id);
    this.kernel.capabilityGraph.register(moduleInstance.id, moduleInstance.manifest);
    this.history.set(moduleInstance.id, [{ action: 'registered', version: moduleInstance.manifest.version, at: new Date().toISOString() }]);
    return moduleInstance.id;
  }

  unregister(id) {
    const m = this.modules.get(id);
    if (!m) return false;
    this.stop(id).catch(() => {});
    this.kernel.capabilityGraph.unregister(id);
    this.modules.delete(id);
    this.enabled.delete(id);
    return true;
  }

  get(id) {
    return this.modules.get(id);
  }

  list() {
    return Array.from(this.modules.values()).map((m) => this._summary(m));
  }

  getEnabled() {
    return Array.from(this.enabled).map((id) => this._summary(this.modules.get(id))).filter(Boolean);
  }

  isEnabled(id) {
    return this.enabled.has(id);
  }

  enable(id) {
    if (!this.modules.has(id)) throw new Error(`module not found: ${id}`);
    this.enabled.add(id);
    this._log(id, 'enabled');
    return true;
  }

  disable(id) {
    if (!this.modules.has(id)) throw new Error(`module not found: ${id}`);
    this.stop(id).catch(() => {});
    this.enabled.delete(id);
    this._log(id, 'disabled');
    return true;
  }

  async initialize(id) {
    const m = this.modules.get(id);
    if (!m) throw new Error(`module not found: ${id}`);
    await m.initialize();
    this._log(id, 'initialized');
    return true;
  }

  async start(id) {
    const m = this.modules.get(id);
    if (!m) throw new Error(`module not found: ${id}`);
    if (!this.enabled.has(id)) return false;
    await m.start();
    this._log(id, 'started');
    return true;
  }

  async stop(id) {
    const m = this.modules.get(id);
    if (!m) return false;
    await m.stop();
    this._log(id, 'stopped');
    return true;
  }

  async dispose(id) {
    const m = this.modules.get(id);
    if (!m) return false;
    await m.dispose();
    this._log(id, 'disposed');
    return true;
  }

  async initializeAll(ids) {
    const order = this.kernel.capabilityGraph.getStartupOrder(ids || Array.from(this.modules.keys()));
    for (const id of order) {
      if (this.enabled.has(id)) await this.initialize(id);
    }
  }

  async startAll(ids) {
    const order = this.kernel.capabilityGraph.getStartupOrder(ids || Array.from(this.modules.keys()));
    for (const id of order) {
      if (this.enabled.has(id)) await this.start(id);
    }
  }

  async stopAll(ids) {
    const order = this.kernel.capabilityGraph.getShutdownOrder(ids || Array.from(this.modules.keys()));
    for (const id of order) {
      await this.stop(id);
    }
  }

  async disposeAll(ids) {
    const order = this.kernel.capabilityGraph.getShutdownOrder(ids || Array.from(this.modules.keys()));
    for (const id of order) {
      await this.dispose(id);
    }
  }

  async upgrade(id, newModule) {
    const current = this.modules.get(id);
    if (!current) throw new Error(`module not found: ${id}`);
    const previous = { module: current, manifest: { ...current.manifest } };
    await current.upgrade(newModule.manifest || newModule);
    this.modules.set(newModule.id || id, newModule);
    this.kernel.capabilityGraph.unregister(id);
    this.kernel.capabilityGraph.register(newModule.id || id, newModule.manifest);
    this.history.get(id).push({ action: 'upgraded', from: previous.manifest.version, to: newModule.manifest.version, at: new Date().toISOString() });
    return { upgraded: true, previous: previous.manifest };
  }

  async rollback(id) {
    const current = this.modules.get(id);
    if (!current) throw new Error(`module not found: ${id}`);
    await current.rollback();
    this._log(id, 'rollback');
    return { rolledBack: true };
  }

  _summary(m) {
    if (!m) return null;
    return {
      id: m.id,
      name: m.manifest.name,
      version: m.manifest.version,
      enabled: this.enabled.has(m.id),
      initialized: m._initialized,
      running: m._started,
      capabilities: m.manifest.capabilities,
      consumes: m.manifest.consumes,
    };
  }

  _log(id, action) {
    const h = this.history.get(id);
    if (h) h.push({ action, at: new Date().toISOString(), id: randomUUID() });
  }
}

module.exports = ModuleRegistry;
