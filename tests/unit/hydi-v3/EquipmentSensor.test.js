'use strict';

const BusinessEventBus = require('../../../src/hydi-v3/BusinessEventBus');
const EquipmentRegistry = require('../../../src/hydi-v3/EquipmentRegistry');
const EquipmentSensor = require('../../../src/hydi-v3/EquipmentSensor');

const SILENT = { log: () => {}, error: () => {}, warn: () => {} };

describe('EquipmentSensor', () => {
  let bus;
  let registry;
  let sensor;

  beforeEach(() => {
    bus = new BusinessEventBus({ logger: SILENT });
    registry = new EquipmentRegistry();
    sensor = new EquipmentSensor({ eventBus: bus, registry, logger: SILENT });
  });

  afterEach(async () => {
    await sensor.destroy();
    bus.destroy();
  });

  test('lifecycle methods work and clean up listeners', async () => {
    await sensor.start();
    expect(sensor._started).toBe(true);
    expect(sensor.healthCheck().ok).toBe(true);

    sensor.stop();
    expect(sensor._started).toBe(false);

    await sensor.destroy();
    expect(sensor._destroyed).toBe(true);
    expect(sensor.listenerCount('test')).toBe(0);
  });

  test('emits hardware events to the business event bus', async () => {
    const events = [];
    bus.subscribe('TestHardware', (event) => events.push(event));
    await sensor.start();

    sensor._emit('TestHardware', { temperature: 210 });
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('TestHardware');
    expect(events[0].payload.temperature).toBe(210);
    expect(events[0].source).toBe('EquipmentSensor');
  });

  test('healthCheck reports event bus and equipment count', async () => {
    await sensor.start();
    const health = sensor.healthCheck();
    expect(health.ok).toBe(true);
    expect(health.hasEventBus).toBe(true);
    expect(health.equipmentCount).toBe(4);
  });
});
