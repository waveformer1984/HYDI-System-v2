'use strict';

const fs = require('fs');
const SignalCoverage = require('../../../src/hydi-v3/SignalCoverage');
const BusinessSignalInterpreter = require('../../../src/hydi-v3/BusinessSignalInterpreter');
const ManufacturingSignalInterpreter = require('../../../src/hydi-v3/ManufacturingSignalInterpreter');

function interpreters() {
  return [
    new BusinessSignalInterpreter({}),
    new ManufacturingSignalInterpreter({}),
  ];
}

describe('SignalCoverage', () => {
  test('every sensor event type is routed to exactly one interpreter', () => {
    // This is the guard. When someone adds a sensor event type without an
    // interpreter case, or teaches a second interpreter to claim an existing
    // type, this fails instead of the event silently vanishing or being
    // counted twice in the briefing.
    const result = SignalCoverage.audit({ interpreters: interpreters() });

    expect(result.dropped).toEqual([]);
    expect(result.double).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test('the declared sensor inventory matches what the sensors actually emit', () => {
    // SENSOR_EVENT_TYPES is hand-maintained, so it could drift from the
    // sensors themselves and quietly narrow what the audit checks.
    const sources = {
      FilesystemMonitor: 'FilesystemMonitor',
      GitSensor: 'GitSensor',
      PrinterSensor: 'PrinterSensor',
    };

    for (const [key, moduleName] of Object.entries(sources)) {
      const source = fs.readFileSync(
        require.resolve(`../../../src/hydi-v3/${moduleName}`), 'utf8',
      );
      const emitted = new Set();
      for (const match of source.matchAll(/_emit\(\s*'([A-Za-z]+)'/g)) emitted.add(match[1]);
      for (const match of source.matchAll(/\?\s*'([A-Za-z]+)'\s*:\s*'([A-Za-z]+)'/g)) {
        emitted.add(match[1]);
        emitted.add(match[2]);
      }

      const declared = new Set(SignalCoverage.SENSOR_EVENT_TYPES[key] || []);
      const undeclared = [...emitted].filter((type) => !declared.has(type));
      expect({ sensor: key, undeclared }).toEqual({ sensor: key, undeclared: [] });
    }
  });

  test('detects a dropped event type', () => {
    const result = SignalCoverage.audit({
      interpreters: interpreters(),
      eventTypes: ['SomethingNobodyHandles'],
    });
    expect(result.ok).toBe(false);
    expect(result.dropped).toEqual(['SomethingNobodyHandles']);
    expect(SignalCoverage.toText(result)).toContain('silently invisible');
  });

  test('detects a double-translated event type', () => {
    const greedy = { interpret: () => ({ payload: {} }), constructor: { name: 'GreedyInterpreter' } };
    const result = SignalCoverage.audit({
      interpreters: [...interpreters(), greedy],
      eventTypes: ['CommitCreated'],
    });
    expect(result.ok).toBe(false);
    expect(result.double[0].type).toBe('CommitCreated');
    expect(SignalCoverage.toText(result)).toContain('counted twice');
  });

  test('an interpreter that throws is treated as not handling the type', () => {
    const broken = { interpret: () => { throw new Error('boom'); }, constructor: { name: 'BrokenInterpreter' } };
    const result = SignalCoverage.audit({
      interpreters: [broken],
      eventTypes: ['CommitCreated'],
    });
    expect(result.dropped).toEqual(['CommitCreated']);
  });

  test('reports success in a readable form', () => {
    const result = SignalCoverage.audit({ interpreters: interpreters() });
    expect(SignalCoverage.toText(result)).toContain('routed to exactly one interpreter');
  });
});

describe('previously dropped event types', () => {
  test('PrinterOffline produces a manufacturing risk signal', () => {
    const signal = new ManufacturingSignalInterpreter({}).interpret({
      id: 'e1', at: Date.now(), type: 'PrinterOffline', source: 'PrinterSensor',
      payload: { equipmentName: 'Prusa MK4', equipmentId: 'prusa-1' },
    });

    expect(signal).toBeTruthy();
    expect(signal.payload.interpretation).toContain('offline');
    expect(signal.payload.impact).toBe('risk-equipment-offline');
    expect(signal.payload.risk).toBe('elevated');
  });

  test('DirectoryDeleted produces a business signal', () => {
    const signal = new BusinessSignalInterpreter({}).interpret({
      id: 'e2', at: Date.now(), type: 'DirectoryDeleted', source: 'FilesystemMonitor',
      payload: { project: 'Resonate', relPath: 'audio/old' },
    });

    expect(signal).toBeTruthy();
    expect(signal.payload.interpretation).toContain('Directory removed');
  });

  test('neither interpreter claims the other\'s domain', () => {
    const business = new BusinessSignalInterpreter({});
    const manufacturing = new ManufacturingSignalInterpreter({});

    const gitEvent = { id: 'g', at: Date.now(), type: 'CommitCreated', source: 'GitSensor', payload: { project: 'P' } };
    const printerEvent = { id: 'p', at: Date.now(), type: 'PrinterFailed', source: 'PrinterSensor', payload: { equipmentName: 'Prusa' } };

    expect(business.interpret(gitEvent)).toBeTruthy();
    expect(manufacturing.interpret(gitEvent)).toBeNull();
    expect(manufacturing.interpret(printerEvent)).toBeTruthy();
    expect(business.interpret(printerEvent)).toBeNull();
  });

  test('a BusinessSignal is never re-interpreted by either interpreter', () => {
    // Both subscribe to '*', so without this guard a published signal would
    // feed back into the bus and loop.
    const signalEvent = { id: 's', at: Date.now(), type: 'BusinessSignal', source: 'x', payload: {} };
    expect(new BusinessSignalInterpreter({}).interpret(signalEvent)).toBeNull();
    expect(new ManufacturingSignalInterpreter({}).interpret(signalEvent)).toBeNull();
  });
});
