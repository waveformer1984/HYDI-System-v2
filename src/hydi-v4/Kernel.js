'use strict';

const { EventEmitter } = require('events');
const path = require('path');

const EventBus = require('./EventBus');
const CapabilityGraph = require('./CapabilityGraph');
const ModuleRegistry = require('./ModuleRegistry');
const PermissionModel = require('./PermissionModel');
const Telemetry = require('./Telemetry');
const HealthMonitor = require('./HealthMonitor');
const SecretVault = require('./SecretVault');
const MemoryBus = require('./MemoryBus');
const IntelligenceBus = require('./IntelligenceBus');
const EventLedger = require('./EventLedger');

/**
 * Kernel is the HYDI V4 operating-system core.
 *
 * It owns every cross-module concern: lifecycle, capabilities, events,
 * permissions, telemetry, health, secrets, memory, and model routing.
 * No module communicates directly with another; all interaction flows
 * through the kernel.
 */
class Kernel extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      dataPath: config.dataPath || path.resolve(__dirname, '../../data/v4'),
      autoStartModules: config.autoStartModules !== false,
      ...config,
    };

    this.eventBus = new EventBus(this, config.eventBus);
    this.capabilityGraph = new CapabilityGraph(this);
    this.moduleRegistry = new ModuleRegistry(this);
    this.permissionModel = new PermissionModel(this, config.permissions);
    this.telemetry = new Telemetry(this, { storagePath: path.join(this.config.dataPath, 'telemetry'), ...config.telemetry });
    this.healthMonitor = new HealthMonitor(this, config.healthMonitor);
    this.secretVault = new SecretVault(this, { vaultPath: path.join(this.config.dataPath, 'vault.json'), ...config.secretVault });
    this.memoryBus = new MemoryBus(this, config.memoryBus);
    this.intelligenceBus = new IntelligenceBus(this, config.intelligenceBus);
    this.eventLedger = new EventLedger(this, { ledgerPath: path.join(this.config.dataPath, 'ledger'), ...config.eventLedger });

    this._started = false;
    this._runtimeConfig = new Map();
  }

  async start() {
    if (this._started) return;
    this._started = true;

    await this.secretVault.initialize();
    await this.eventLedger.initialize();
    await this.memoryBus.initialize();

    this.eventBus.start();
    this.telemetry.start();
    this.healthMonitor.start();

    if (this.config.autoStartModules) {
      await this.moduleRegistry.initializeAll();
      await this.moduleRegistry.startAll();
    }

    this.emit('started');
  }

  async stop() {
    if (!this._started) return;
    this._started = false;

    this.emit('stopping');
    await this.moduleRegistry.stopAll();
    await this.moduleRegistry.disposeAll();
    await this.eventLedger.dispose();

    this.eventBus.stop();
    this.telemetry.stop();
    this.healthMonitor.stop();

    this.emit('stopped');
  }

  getStatus() {
    return {
      started: this._started,
      modules: this.moduleRegistry.list(),
      health: this.healthMonitor.getLast(),
      intelligence: this.intelligenceBus.adapters.size,
    };
  }

  // ---------------------- Module lifecycle ----------------------

  registerModule(module) {
    this.moduleRegistry.register(module);
    this.emit('module_registered', { id: module.id });
    return module.id;
  }

  async startModule(id) {
    await this.moduleRegistry.initialize(id);
    await this.moduleRegistry.start(id);
  }

  async stopModule(id) {
    await this.moduleRegistry.stop(id);
    await this.moduleRegistry.dispose(id);
  }

  // ---------------------- Bus API ----------------------

  publish(topic, payload, metadata) {
    return this.eventBus.publish(topic, payload, metadata);
  }

  subscribe(topic, handler, options) {
    return this.eventBus.subscribe(topic, handler, options);
  }

  unsubscribe(topic, handlerOrId) {
    return this.eventBus.unsubscribe(topic, handlerOrId);
  }

  request(topic, payload, options) {
    return this.eventBus.request(topic, payload, options);
  }

  // ---------------------- Capability routing ----------------------

  async requestCapability(capability, payload = {}, options = {}) {
    const providers = this.capabilityGraph.getProviders(capability);
    if (providers.length === 0) throw new Error(`no provider for capability: ${capability}`);
    const providerId = options.providerId || providers[0];
    const origin = options.origin || 'kernel';
    return this.eventBus.request(`capability:${capability}:${providerId}`, payload, {
      origin,
      capability,
      providerId,
      ...options,
    });
  }

  // ---------------------- Configuration ----------------------

  setConfig(key, value) {
    this._runtimeConfig.set(key, value);
    this.emit('config_changed', { key, value });
  }

  getConfig(key, defaultValue) {
    if (this._runtimeConfig.has(key)) return this._runtimeConfig.get(key);
    return process.env[key] !== undefined ? process.env[key] : defaultValue;
  }

  // ---------------------- Secrets ----------------------

  setSecret(name, value) {
    return this.secretVault.set(name, value);
  }

  getSecret(name) {
    return this.secretVault.get(name);
  }

  // ---------------------- Memory ----------------------

  remember(key, value, options) {
    return this.memoryBus.set(key, value, options);
  }

  recall(key, options) {
    return this.memoryBus.get(key, options);
  }

  forget(key, options) {
    return this.memoryBus.delete(key, options);
  }

  searchMemory(query, options) {
    return this.memoryBus.search(query, options);
  }

  // ---------------------- Intelligence ----------------------

  async think(request) {
    this.telemetry.increment('kernel.think', 1, { capability: request.capability });
    return this.intelligenceBus.route(request);
  }
}

module.exports = Kernel;
