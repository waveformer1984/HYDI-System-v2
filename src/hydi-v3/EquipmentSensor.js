'use strict';

const { EventEmitter } = require('events');
const EquipmentRegistry = require('./EquipmentRegistry');

class EquipmentSensor extends EventEmitter {
  constructor(config = {}) {
    super();
    this.registry = config.registry || new EquipmentRegistry();
    this.eventBus = config.eventBus || null;
    this.logger = config.logger || console;
    this._started = false;
    this._destroyed = false;
  }

  async initialize() {
    return this.start();
  }

  async start() {
    if (this._destroyed) throw new Error(`${this.constructor.name} has been destroyed`);
    if (this._started) return this;
    this._started = true;
    this.logger.log(`[${this.constructor.name}] started`);
    return this;
  }

  stop() {
    this._started = false;
    this.logger.log(`[${this.constructor.name}] stopped`);
    return this;
  }

  async destroy() {
    if (this._destroyed) return this;
    this.stop();
    this.removeAllListeners();
    this._destroyed = true;
    return this;
  }

  healthCheck() {
    return {
      ok: !this._destroyed && this._started,
      available: this._started,
      hasEventBus: !!this.eventBus,
      equipmentCount: this.registry.getAll().length,
    };
  }

  _emit(type, payload = {}) {
    if (!this.eventBus) return null;
    return this.eventBus.emit(type, { ...payload, emittedAt: Date.now() }, this.constructor.name);
  }
}

module.exports = EquipmentSensor;
