'use strict';

/**
 * HModule is the base class for every HYDI V4 kernel module.
 *
 * All kernel modules must extend HModule and implement the lifecycle contract.
 */
class HModule {
  constructor(kernel, manifest = {}) {
    if (!kernel) throw new Error('kernel is required');
    if (!manifest.id) throw new Error('module manifest.id is required');
    this.kernel = kernel;
    this.manifest = {
      name: manifest.name || manifest.id,
      version: manifest.version || '0.0.0',
      description: manifest.description || '',
      author: manifest.author || '',
      dependencies: manifest.dependencies || [],
      permissions: manifest.permissions || [],
      capabilities: manifest.capabilities || [],
      consumes: manifest.consumes || [],
      options: manifest.options || {},
      ...manifest,
    };
    this._initialized = false;
    this._started = false;
    this._previous = null;
  }

  get id() {
    return this.manifest.id;
  }

  get name() {
    return this.manifest.name;
  }

  get version() {
    return this.manifest.version;
  }

  get dependencies() {
    return this.manifest.dependencies;
  }

  get capabilities() {
    return this.manifest.capabilities;
  }

  get consumes() {
    return this.manifest.consumes;
  }

  async initialize() {
    this._initialized = true;
  }

  async start() {
    this._started = true;
  }

  async stop() {
    this._started = false;
  }

  async dispose() {
    this._initialized = false;
    this._started = false;
  }

  async upgrade(newManifest) {
    this._previous = { manifest: { ...this.manifest }, state: await this.exportState() };
    this.manifest = { ...this.manifest, ...newManifest };
    return { upgraded: true, previousVersion: this._previous.manifest.version };
  }

  async rollback() {
    if (!this._previous) throw new Error('no previous version to rollback');
    this.manifest = this._previous.manifest;
    await this.importState(this._previous.state);
    this._previous = null;
    return { rolledBack: true };
  }

  async exportState() {
    return {};
  }

  async importState(state) {
    // override in subclass
  }

  async health() {
    return {
      moduleId: this.id,
      healthy: this._started,
      initialized: this._initialized,
      running: this._started,
      metrics: {},
    };
  }

  hasPermission(action, resource) {
    return this.kernel.permissionModel?.check(this.id, action, resource) ?? true;
  }

  publish(topic, payload, metadata) {
    return this.kernel.eventBus.publish(topic, payload, { origin: this.id, ...metadata });
  }

  subscribe(topic, handler, options) {
    return this.kernel.eventBus.subscribe(topic, handler, { origin: this.id, ...options });
  }

  requestCapability(capability, payload, options) {
    return this.kernel.requestCapability(capability, payload, { origin: this.id, ...options });
  }
}

module.exports = HModule;
