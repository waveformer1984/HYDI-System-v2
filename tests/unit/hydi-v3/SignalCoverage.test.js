'use strict';

const BusinessEventBus = require('../../../src/hydi-v3/BusinessEventBus');
const BusinessEventRegistry = require('../../../src/hydi-v3/BusinessEventRegistry');
const BusinessSignalInterpreter = require('../../../src/hydi-v3/BusinessSignalInterpreter');
const { RevenueSensor, MockRevenueAdapter } = require('../../../src/hydi-v3/RevenueSensor');
const SignalCoverage = require('../../../src/hydi-v3/SignalCoverage');

function makeBus() {
  const registry = new BusinessEventRegistry();
  return new BusinessEventBus({ maxHistory: 100, registry });
}

describe('SignalCoverage', () => {
  test('passes when every registered event has exactly one interpreter', () => {
    const registry = new BusinessEventRegistry();
    registry.register('FileCreated', 'FilesystemMonitor');
    registry.register('PrinterFailed', 'PrinterSensor');
    registry.declareHandled('FileCreated', 'BusinessSignalInterpreter');
    registry.declareHandled('PrinterFailed', 'ManufacturingSignalInterpreter');

    const result = SignalCoverage.audit({ registry });

    expect(result.ok).toBe(true);
    expect(result.dropped).toEqual([]);
    expect(result.double).toEqual([]);
    expect(result.orphan).toEqual([]);
  });

  test('reports success in a readable form', () => {
    const registry = new BusinessEventRegistry();
    registry.register('CommitCreated', 'GitSensor');
    registry.declareHandled('CommitCreated', 'BusinessSignalInterpreter');

    const result = SignalCoverage.audit({ registry });
    expect(SignalCoverage.toText(result)).toContain('valid contract');
  });

  test('detects a dropped event type', () => {
    const registry = new BusinessEventRegistry();
    registry.register('SomethingNobodyHandles', 'SomeSensor');

    const result = SignalCoverage.audit({ registry });

    expect(result.ok).toBe(false);
    expect(result.dropped).toEqual(['SomethingNobodyHandles']);
    expect(SignalCoverage.toText(result)).toContain('silently invisible');
  });

  test('detects a double-translated event type', () => {
    const registry = new BusinessEventRegistry();
    registry.register('CommitCreated', 'GitSensor');
    registry.declareHandled('CommitCreated', 'BusinessSignalInterpreter');
    registry.declareHandled('CommitCreated', 'GreedyInterpreter');

    const result = SignalCoverage.audit({ registry });

    expect(result.ok).toBe(false);
    expect(result.double[0].type).toBe('CommitCreated');
    expect(SignalCoverage.toText(result)).toContain('counted twice');
  });

  test('warns about an orphan interpreter event', () => {
    const registry = new BusinessEventRegistry();
    registry.declareHandled('UndeclaredEvent', 'BusinessSignalInterpreter');

    const result = SignalCoverage.audit({ registry });

    expect(result.ok).toBe(true);
    expect(result.orphan).toEqual(['UndeclaredEvent']);
    expect(result.warnings).toContain('UndeclaredEvent');
  });

  test('detects unknown runtime emissions', () => {
    const bus = makeBus();
    bus.emit('SurpriseEvent', {}, 'RogueSensor');

    const result = SignalCoverage.audit({ registry: bus.registry });

    expect(result.ok).toBe(false);
    expect(result.unknown).toEqual(['SurpriseEvent']);
  });

  test('legacy probing path still detects dropped types', () => {
    const broken = { interpret: () => { throw new Error('boom'); }, constructor: { name: 'BrokenInterpreter' } };
    const result = SignalCoverage.audit({
      interpreters: [broken],
      eventTypes: ['CommitCreated'],
    });
    expect(result.dropped).toEqual(['CommitCreated']);
  });
});

describe('RevenueReceived contract', () => {
  let bus;

  beforeEach(() => {
    bus = makeBus();
  });

  afterEach(() => {
    bus.destroy();
  });

  test('RevenueSensor registers RevenueReceived and the interpreter handles it', () => {
    new BusinessSignalInterpreter({ eventBus: bus });
    new RevenueSensor({ eventBus: bus, adapters: [] });

    const result = SignalCoverage.audit({ registry: bus.registry });

    expect(result.dropped).not.toContain('RevenueReceived');
    expect(result.orphan).not.toContain('RevenueReceived');
    expect(result.double.map((d) => d.type)).not.toContain('RevenueReceived');
  });

  test('RevenueReceived reaches the executive layer as a BusinessSignal', (done) => {
    new BusinessSignalInterpreter({ eventBus: bus });
    bus.subscribe('BusinessSignal', (e) => {
      expect(e.payload.strategicObjective).toBe('revenue');
      expect(e.payload.subsystem).toBe('Revenue');
      expect(e.payload.originatingEvent).toBe('RevenueReceived');
      expect(e.payload.impact).toBe('revenue-positive');
      expect(e.payload.confidence).toBe(0.99);
      expect(e.payload.recommendation).toContain('Finance');
      done();
    });

    bus.emit('RevenueReceived', {
      amount: 250,
      currency: 'USD',
      at: Date.now(),
      description: 'Rezonate license',
      ledger: 'test-ledger',
    }, 'RevenueSensor');
  });

  test('RevenueSensor scan emits a BusinessSignal for the Executive OS', async () => {
    const sensor = new RevenueSensor({
      eventBus: bus,
      adapters: [new MockRevenueAdapter({ transactions: [{ amount: 99, currency: 'USD', id: 'tx-1' }] })],
    });
    new BusinessSignalInterpreter({ eventBus: bus });
    const received = new Promise((resolve) => bus.once('BusinessSignal', resolve));

    await sensor.scan();

    const event = await received;
    expect(event.payload.strategicObjective).toBe('revenue');
    expect(event.payload.subsystem).toBe('Revenue');
    sensor.destroy();
  });
});

describe('no source-code convention coverage', () => {
  test('SignalCoverage no longer exposes SENSOR_EVENT_TYPES or regex-based inventory helpers', () => {
    expect(SignalCoverage.SENSOR_EVENT_TYPES).toBeUndefined();
    expect(SignalCoverage.allEventTypes).toBeUndefined();
    expect(typeof SignalCoverage.audit).toBe('function');
    expect(typeof SignalCoverage.toText).toBe('function');
  });
});
