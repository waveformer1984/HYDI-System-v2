'use strict';

const EquipmentSensor = require('./EquipmentSensor');

const MATERIAL_LOW_THRESHOLD = 10;

const SIMULATION_SCENARIOS = {
  normal: [
    { status: 'heating', temperature: 65, progress: 0, materialRemaining: 80, event: 'PrinterHeating' },
    { status: 'printing', temperature: 210, progress: 0, materialRemaining: 80, event: 'PrinterStarted' },
    { status: 'printing', temperature: 210, progress: 100, materialRemaining: 45, event: 'PrinterCompleted' },
    { status: 'idle', temperature: 40, progress: 100, materialRemaining: 45, event: 'PrinterIdle' },
  ],
  failure: [
    { status: 'printing', temperature: 210, progress: 0, materialRemaining: 30, event: 'PrinterStarted' },
    { status: 'failed', temperature: 80, progress: 22, materialRemaining: 12, event: 'PrinterFailed' },
    { status: 'idle', temperature: 40, progress: 22, materialRemaining: 8, event: 'MaterialLow' },
  ],
};

class PrinterSensor extends EquipmentSensor {
  constructor(config = {}) {
    super(config);

    const printers = this.registry.getByType('3d-printer');
    this.equipmentId = config.equipmentId || (printers[0] && printers[0].id);
    if (!this.equipmentId) {
      throw new Error('No 3d-printer in registry and no equipmentId provided');
    }

    this.equipment = this.registry.get(this.equipmentId);
    this.simulate = config.simulate === true;
    this.scenario = config.scenario || 'normal';
    this.autoRun = config.autoRun !== false;
    this.pollIntervalMs = config.pollIntervalMs ?? (this.simulate ? 0 : 10000);
    this.adapter = config.adapter || null;

    this.state = {
      status: this.equipment.status || 'idle',
      temperature: config.temperature ?? 0,
      progress: config.progress ?? 0,
      materialRemaining: config.materialRemaining ?? 50,
      loadedMaterial: config.loadedMaterial || 'PLA',
    };

    this._timer = null;
    this._materialLowReported = false;
    this._registerEventTypes();
  }

  _registerEventTypes() {
    if (!this.eventBus || !this.eventBus.registry) return;
    const types = [
      'PrinterStarted', 'PrinterPaused', 'PrinterResumed', 'PrinterCompleted',
      'PrinterFailed', 'PrinterIdle', 'PrinterHeating', 'PrinterOffline', 'MaterialLow',
    ];
    for (const type of types) {
      this.eventBus.registry.register(type, 'PrinterSensor', { domain: 'manufacturing' });
    }
  }

  async start() {
    if (this._destroyed) throw new Error('PrinterSensor has been destroyed');
    if (this._started) return this;

    await super.start();
    this._publishCurrentState();

    if (this.simulate && this.autoRun) {
      this.runSimulation(this.scenario);
    } else if (this.adapter) {
      await this._poll();
      if (this.pollIntervalMs > 0) {
        this._timer = setInterval(() => {
          this._poll().catch((error) => {
            this.logger.error('[PrinterSensor] poll error', {
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }, this.pollIntervalMs);
        if (this._timer.unref) this._timer.unref();
      }
    } else if (!this.simulate) {
      this.logger.log('[PrinterSensor] no adapter configured; sensor is idle');
    }

    return this;
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    super.stop();
    return this;
  }

  async destroy() {
    if (this._destroyed) return this;
    this.stop();
    this._destroyed = true;
    return this;
  }

  healthCheck() {
    return {
      ok: !this._destroyed && this._started,
      available: this._started,
      equipmentId: this.equipmentId,
      equipmentName: this.equipment.name,
      simulating: this.simulate,
      hasAdapter: !!this.adapter,
      state: { ...this.state },
    };
  }

  _basePayload() {
    return {
      equipmentId: this.equipmentId,
      equipmentName: this.equipment.name,
      equipmentType: this.equipment.type,
      material: this.state.loadedMaterial,
      temperature: this.state.temperature,
      progress: this.state.progress,
      materialRemaining: this.state.materialRemaining,
    };
  }

  _publishCurrentState() {
    this._emitState(this.state.status);
    this._checkMaterialLow();
  }

  _emitState(status) {
    const eventMap = {
      idle: 'PrinterIdle',
      heating: 'PrinterHeating',
      printing: 'PrinterStarted',
      paused: 'PrinterPaused',
      completed: 'PrinterCompleted',
      failed: 'PrinterFailed',
      offline: 'PrinterOffline',
    };
    const type = eventMap[status];
    if (type) {
      this._emit(type, this._basePayload());
    }
  }

  _checkMaterialLow() {
    const low = this.state.materialRemaining <= MATERIAL_LOW_THRESHOLD;
    if (low && !this._materialLowReported) {
      this._materialLowReported = true;
      this._emit('MaterialLow', this._basePayload());
    } else if (!low && this._materialLowReported) {
      this._materialLowReported = false;
    }
  }

  async _poll() {
    if (!this.adapter) return;
    const reading = await this.adapter.fetchState(this.equipmentId);
    this._applyState(reading);
  }

  _applyState(newState) {
    const previous = { ...this.state };
    this.state = { ...this.state, ...newState };
    this.registry.updateStatus(this.equipmentId, this.state.status);

    if (this.state.status !== previous.status) {
      this._emitStatusEvent(previous.status, this.state.status);
    }
    if (this.state.materialRemaining !== previous.materialRemaining) {
      this._checkMaterialLow();
    }
  }

  _emitStatusEvent(previousStatus, newStatus) {
    if (newStatus === 'printing' && previousStatus === 'paused') {
      this._emit('PrinterResumed', this._basePayload());
    } else if (newStatus === 'heating') {
      this._emit('PrinterHeating', this._basePayload());
    } else if (newStatus === 'printing') {
      this._emit('PrinterStarted', this._basePayload());
    } else if (newStatus === 'paused') {
      this._emit('PrinterPaused', this._basePayload());
    } else if (newStatus === 'completed') {
      this._emit('PrinterCompleted', this._basePayload());
    } else if (newStatus === 'failed') {
      this._emit('PrinterFailed', this._basePayload());
    } else if (newStatus === 'idle') {
      this._emit('PrinterIdle', this._basePayload());
    } else if (newStatus === 'offline') {
      this._emit('PrinterOffline', this._basePayload());
    }
  }

  runSimulation(scenarioName = this.scenario) {
    if (!this.simulate) {
      throw new Error('PrinterSensor is not in simulation mode');
    }
    const sequence = SIMULATION_SCENARIOS[scenarioName] || SIMULATION_SCENARIOS.normal;
    for (const step of sequence) {
      const eventType = step.event;
      const state = { ...step };
      delete state.event;
      this.state = { ...this.state, ...state };
      this.registry.updateStatus(this.equipmentId, this.state.status);
      if (eventType === 'MaterialLow') {
        this._checkMaterialLow();
      } else {
        this._emit(eventType, this._basePayload());
      }
    }
  }

  simulateEvent(eventType, payload = {}) {
    if (!this.simulate) {
      throw new Error('PrinterSensor is not in simulation mode');
    }
    this._emit(eventType, { ...this._basePayload(), ...payload });
  }
}

module.exports = PrinterSensor;
