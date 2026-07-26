'use strict';

class ManufacturingSignalInterpreter {
  constructor(config = {}) {
    this.eventBus = config.eventBus || null;
    this.objective = config.objective || 'manufacturing';
    this.subsystem = config.subsystem || 'Manufacturing Floor';
    if (this.eventBus) this.attach(this.eventBus);
  }

  attach(eventBus) {
    this.eventBus = eventBus;
    this._handler = (event) => {
      const signal = this.interpret(event);
      if (signal) this.publish(signal);
    };
    this.eventBus.subscribe('*', this._handler);
  }

  detach() {
    if (this.eventBus && this._handler) {
      this.eventBus.unsubscribe('*', this._handler);
    }
    this._handler = null;
  }

  destroy() {
    this.detach();
    this.eventBus = null;
  }

  interpret(event) {
    if (event.type === 'BusinessSignal') return null;
    const p = event.payload || {};
    const name = p.equipmentName || p.name || 'the printer';
    const material = p.material || 'material';

    const basePayload = {
      strategicObjective: this.objective,
      subsystem: this.subsystem,
      project: p.equipmentName || 'ProtoForge',
      originatingEvent: event.type,
      equipmentId: p.equipmentId,
      equipmentName: p.equipmentName,
      equipmentType: p.equipmentType,
      meta: p,
    };

    switch (event.type) {
      case 'PrinterStarted':
        return this._signal({
          ...basePayload,
          interpretation: `${name} started a build`,
          impact: 'manufacturing-active',
          confidence: 0.95,
        });
      case 'PrinterPaused':
        return this._signal({
          ...basePayload,
          interpretation: `${name} paused a build`,
          impact: 'manufacturing-paused',
          confidence: 0.95,
        });
      case 'PrinterResumed':
        return this._signal({
          ...basePayload,
          interpretation: `${name} resumed a build`,
          impact: 'manufacturing-active',
          confidence: 0.95,
        });
      case 'PrinterCompleted':
        return this._signal({
          ...basePayload,
          interpretation: `${name} completed a build`,
          impact: 'positive',
          confidence: 0.98,
        });
      case 'PrinterFailed':
        return this._signal({
          ...basePayload,
          interpretation: `${name} failed a build`,
          impact: 'risk-elevated',
          risk: 'elevated',
          recommendation: 'Investigate failed build before next production batch.',
          confidence: 0.96,
        });
      case 'PrinterIdle':
        return this._signal({
          ...basePayload,
          interpretation: `${name} is idle and available`,
          impact: 'manufacturing-idle',
          confidence: 0.94,
        });
      case 'PrinterHeating':
        return this._signal({
          ...basePayload,
          interpretation: `${name} is heating up`,
          impact: 'manufacturing-warming',
          confidence: 0.94,
        });
      case 'MaterialLow':
        return this._signal({
          ...basePayload,
          interpretation: `Material inventory is low for ${material}`,
          impact: 'risk-material',
          priority: 'high',
          confidence: 0.97,
        });
      default:
        return null;
    }
  }

  publish(signal) {
    if (this.eventBus) {
      this.eventBus.emit('BusinessSignal', signal.payload, signal.source);
    }
    return signal;
  }

  _signal(payload) {
    return {
      type: 'BusinessSignal',
      source: 'ManufacturingSignalInterpreter',
      at: Date.now(),
      payload,
    };
  }
}

module.exports = ManufacturingSignalInterpreter;
