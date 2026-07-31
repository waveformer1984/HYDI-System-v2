'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const BusinessEventBus = require('../../../src/hydi-v3/BusinessEventBus');
const PrinterSensor = require('../../../src/hydi-v3/PrinterSensor');

const SILENT = { log: () => {}, error: () => {}, warn: () => {} };

describe('PrinterSensor', () => {
  let dataPath;
  let bus;
  let sensor;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `heidi-printer-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });
    bus = new BusinessEventBus({ logger: SILENT });
  });

  afterEach(async () => {
    if (sensor) await sensor.destroy().catch(() => {});
    bus.destroy();
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  test('lifecycle methods work and leave no timers', async () => {
    sensor = new PrinterSensor({
      eventBus: bus,
      simulate: true,
      autoRun: false,
      logger: SILENT,
    });
    await sensor.start();
    expect(sensor._started).toBe(true);
    expect(sensor._timer).toBeNull();

    await sensor.destroy();
    expect(sensor._destroyed).toBe(true);
    expect(sensor._timer).toBeNull();
  });

  test('publishes current state on startup without replaying history', async () => {
    const events = [];
    bus.subscribe('*', (event) => events.push(event));

    sensor = new PrinterSensor({
      eventBus: bus,
      simulate: true,
      autoRun: false,
      materialRemaining: 5,
      logger: SILENT,
    });
    await sensor.start();

    const types = events.map((e) => e.type);
    expect(types).toContain('PrinterIdle');
    expect(types).toContain('MaterialLow');
    expect(events.filter((e) => e.type === 'PrinterIdle').length).toBe(1);
    expect(events.filter((e) => e.type === 'MaterialLow').length).toBe(1);
  });

  test('normal simulation emits the expected event sequence', async () => {
    const events = [];
    bus.subscribe('*', (event) => events.push(event));

    sensor = new PrinterSensor({
      eventBus: bus,
      simulate: true,
      autoRun: false,
      logger: SILENT,
    });
    await sensor.start();
    sensor.runSimulation('normal');

    const types = events.map((e) => e.type);
    expect(types).toContain('PrinterHeating');
    expect(types).toContain('PrinterStarted');
    expect(types).toContain('PrinterCompleted');
    expect(types).toContain('PrinterIdle');
  });

  test('failure simulation emits PrinterFailed and MaterialLow', async () => {
    const events = [];
    bus.subscribe('*', (event) => events.push(event));

    sensor = new PrinterSensor({
      eventBus: bus,
      simulate: true,
      autoRun: false,
      scenario: 'failure',
      materialRemaining: 30,
      logger: SILENT,
    });
    await sensor.start();
    sensor.runSimulation('failure');

    const types = events.map((e) => e.type);
    expect(types).toContain('PrinterStarted');
    expect(types).toContain('PrinterFailed');
    expect(types).toContain('MaterialLow');
  });

  test('adapter interface emits state transitions', async () => {
    const adapter = {
      fetchState: jest.fn()
        .mockResolvedValueOnce({ status: 'heating', temperature: 60, materialRemaining: 50 })
        .mockResolvedValueOnce({ status: 'printing', temperature: 210, materialRemaining: 50 }),
    };
    const events = [];
    bus.subscribe('*', (event) => events.push(event));

    sensor = new PrinterSensor({
      eventBus: bus,
      adapter,
      pollIntervalMs: 0,
      logger: SILENT,
    });
    await sensor.start();
    await sensor._poll();
    await sensor._poll();

    const types = events.map((e) => e.type);
    expect(types).toContain('PrinterHeating');
    expect(types).toContain('PrinterStarted');
    expect(types).not.toContain('PrinterFailed');
  });

  test('emit events only carry hardware facts, no business vocabulary', () => {
    sensor = new PrinterSensor({
      eventBus: bus,
      simulate: true,
      autoRun: false,
      logger: SILENT,
    });
    const event = sensor._emit('PrinterCompleted', { progress: 100 });
    expect(event.payload.progress).toBe(100);
    expect(event.payload.recommendation).toBeUndefined();
    expect(event.payload.impact).toBeUndefined();
  });
});
