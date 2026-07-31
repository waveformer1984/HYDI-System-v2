'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const BusinessEventBus = require('../../../src/hydi-v3/BusinessEventBus');
const ManufacturingSignalInterpreter = require('../../../src/hydi-v3/ManufacturingSignalInterpreter');
const PrinterSensor = require('../../../src/hydi-v3/PrinterSensor');
const EquipmentRegistry = require('../../../src/hydi-v3/EquipmentRegistry');
const BusinessMemory = require('../../../src/hydi-v3/BusinessMemory');
const ExecutiveOperatingSystem = require('../../../src/hydi-v3/ExecutiveOperatingSystem');

const SILENT = { log: () => {}, error: () => {}, warn: () => {} };

describe('ManufacturingSignalInterpreter', () => {
  let bus;
  let interpreter;
  let signals;

  beforeEach(() => {
    bus = new BusinessEventBus({ logger: SILENT });
    interpreter = new ManufacturingSignalInterpreter({ eventBus: bus });
    signals = [];
    bus.subscribe('BusinessSignal', (event) => signals.push(event));
  });

  afterEach(() => {
    interpreter.destroy();
    bus.destroy();
  });

  test('PrinterCompleted becomes a positive manufacturing business signal', (done) => {
    bus.subscribe('BusinessSignal', (event) => {
      const p = event.payload;
      expect(p.strategicObjective).toBe('manufacturing');
      expect(p.impact).toBe('positive');
      expect(p.confidence).toBe(0.98);
      expect(p.interpretation).toContain('completed a build');
      done();
    });
    bus.emit('PrinterCompleted', { equipmentId: 'creality-k1-se', equipmentName: 'Creality K1 SE' }, 'PrinterSensor');
  });

  test('PrinterFailed carries elevated risk and a recommendation', (done) => {
    bus.subscribe('BusinessSignal', (event) => {
      const p = event.payload;
      expect(p.strategicObjective).toBe('manufacturing');
      expect(p.risk).toBe('elevated');
      expect(p.recommendation).toContain('Investigate failed build');
      done();
    });
    bus.emit('PrinterFailed', { equipmentId: 'creality-k1-se', equipmentName: 'Creality K1 SE' }, 'PrinterSensor');
  });

  test('MaterialLow is a high-priority manufacturing signal', (done) => {
    bus.subscribe('BusinessSignal', (event) => {
      const p = event.payload;
      expect(p.strategicObjective).toBe('manufacturing');
      expect(p.priority).toBe('high');
      expect(p.impact).toBe('risk-material');
      done();
    });
    bus.emit('MaterialLow', { material: 'PETG' }, 'PrinterSensor');
  });

  test('ignores non-manufacturing hardware events', () => {
    bus.emit('UnknownHardwareEvent', { foo: 'bar' }, 'SomeSensor');
    expect(signals.length).toBe(0);
  });

  test('interpret() returns a signal without an event bus', () => {
    const sig = new ManufacturingSignalInterpreter({ objective: 'manufacturing' }).interpret({
      type: 'PrinterIdle',
      at: 1,
      payload: { equipmentName: 'Creality K1 SE' },
    });
    expect(sig.payload.strategicObjective).toBe('manufacturing');
    expect(sig.payload.impact).toBe('manufacturing-idle');
  });

  test('full pipeline reaches BusinessMemory without printer code in the Executive OS', async () => {
    const dataPath = path.join(os.tmpdir(), `heidi-mfg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });

    const eosSource = require('fs').readFileSync(
      require.resolve('../../../src/hydi-v3/ExecutiveOperatingSystem'), 'utf8',
    );
    const printerTerms = /\bprinter\b|\bcreality\b|\boctoprint\b|\bmoonraker\b|\bklipper\b|\bfilament\b/i;
    expect(printerTerms.test(eosSource)).toBe(false);

    const memory = new BusinessMemory({ dataPath, logger: SILENT });
    await memory.start();
    const bus2 = new BusinessEventBus({ logger: SILENT });
    const mfgInterpreter = new ManufacturingSignalInterpreter({ eventBus: bus2 });
    const eos = new ExecutiveOperatingSystem({ dataPath, businessMemory: memory, eventBus: bus2, logger: SILENT });
    await eos.start();

    const registry = new EquipmentRegistry();
    const printer = new PrinterSensor({
      eventBus: bus2,
      registry,
      simulate: true,
      autoRun: false,
      materialRemaining: 5,
      logger: SILENT,
    });
    await printer.start();
    printer.runSimulation('normal');

    const activities = memory.find({ type: 'activity' });
    expect(activities.some((a) => String(a.name).includes('completed a build'))).toBe(true);
    expect(activities.some((a) => a.tags.includes('manufacturing'))).toBe(true);

    await eos.destroy();
    await memory.destroy();
    mfgInterpreter.destroy();
    bus2.destroy();
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });
});
