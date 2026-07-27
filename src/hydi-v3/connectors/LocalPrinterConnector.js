'use strict';

const BaseConnector = require('./BaseConnector');
const PrinterSensor = require('../PrinterSensor');

class LocalPrinterConnector extends BaseConnector {
  constructor(config = {}) {
    super(config);
    this.capabilities = [
      'PrinterStarted', 'PrinterPaused', 'PrinterResumed', 'PrinterCompleted',
      'PrinterFailed', 'PrinterIdle', 'PrinterHeating', 'PrinterOffline', 'MaterialLow',
    ];
  }

  async start() {
    if (!this._isEnabled()) {
      this._notConfigured('disabled');
      return;
    }
    const registry = this.context.equipmentRegistry || this.config.registry;
    if (!registry) {
      this._notConfigured('no equipment registry available');
      return;
    }
    this.sensor = new PrinterSensor({
      registry,
      eventBus: this.eventBus,
      logger: this.logger,
      simulate: this.config.simulate === true,
      scenario: this.config.scenario,
      autoRun: this.config.autoRun,
      pollIntervalMs: this.config.pollIntervalMs,
      equipmentId: this.config.equipmentId,
    });
    await this.sensor.start();
    this.state = 'running';
  }

  async stop() {
    if (this.sensor && typeof this.sensor.stop === 'function') {
      this.sensor.stop();
    }
    this.state = 'stopped';
  }

  healthCheck() {
    if (this.state !== 'running') {
      return super.healthCheck();
    }
    if (!this.sensor || typeof this.sensor.healthCheck !== 'function') {
      return { ...super.healthCheck(), ok: false, detail: 'sensor not initialized' };
    }
    const h = this.sensor.healthCheck();
    const base = super.healthCheck();
    return { ...base, ok: h.ok, detail: h.available ? 'available' : 'unavailable' };
  }
}

module.exports = LocalPrinterConnector;
