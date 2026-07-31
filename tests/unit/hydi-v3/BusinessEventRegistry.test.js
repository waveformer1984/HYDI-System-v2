'use strict';

const BusinessEventRegistry = require('../../../src/hydi-v3/BusinessEventRegistry');

describe('BusinessEventRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new BusinessEventRegistry();
  });

  test('validates when every registered event is handled exactly once', () => {
    registry.register('FileCreated', 'FilesystemMonitor');
    registry.declareHandled('FileCreated', 'BusinessSignalInterpreter');

    const result = registry.validate();

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('fails validation when a registered event is dropped', () => {
    registry.register('RevenueReceived', 'RevenueSensor');

    const result = registry.validate();

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      { type: 'RevenueReceived', error: 'registered event has no interpreter and is not ignored', severity: 'critical' },
    ]);
  });

  test('warns when an ignored event is not registered', () => {
    registry.declareIgnored('GhostEvent', 'not part of the contract');

    const result = registry.validate();

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      { type: 'GhostEvent', error: 'ignored event is not registered', severity: 'warning' },
    ]);
  });

  test('fails validation when two interpreters handle the same event', () => {
    registry.register('CommitCreated', 'GitSensor');
    registry.declareHandled('CommitCreated', 'BusinessSignalInterpreter');
    registry.declareHandled('CommitCreated', 'GreedyInterpreter');

    const result = registry.validate();

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      { type: 'CommitCreated', error: 'registered event has multiple interpreters', interpreters: ['BusinessSignalInterpreter', 'GreedyInterpreter'], severity: 'critical' },
    ]);
  });

  test('warns when an interpreter handles an unregistered event', () => {
    registry.declareHandled('Undeclared', 'BusinessSignalInterpreter');

    const result = registry.validate();

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      { type: 'Undeclared', error: 'interpreter handles an unregistered event', severity: 'warning' },
    ]);
  });

  test('records unknown runtime emissions', () => {
    registry.recordEmission('SurpriseEvent', 'RogueSensor');

    const result = registry.validate();

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      { type: 'SurpriseEvent', count: 1, error: 'unknown event emitted at runtime', severity: 'critical' },
    ]);
  });

  test('records interpreted events and reports dropped runtime events', () => {
    registry.register('FileCreated', 'FilesystemMonitor');
    registry.declareHandled('FileCreated', 'BusinessSignalInterpreter');
    registry.recordEmission('FileCreated', 'FilesystemMonitor');
    registry.recordEmission('FileCreated', 'FilesystemMonitor');
    registry.recordInterpretation('FileCreated');

    const stats = registry.getRuntimeStats();

    expect(stats.dropped).toEqual([
      { type: 'FileCreated', emitted: 2, interpreted: 1, dropped: 1 },
    ]);
  });

  test('healthCheck surfaces validation and runtime state', () => {
    registry.register('PrinterFailed', 'PrinterSensor');
    registry.declareHandled('PrinterFailed', 'ManufacturingSignalInterpreter');

    const result = registry.healthCheck();

    expect(result.ok).toBe(true);
    expect(result.validation.ok).toBe(true);
    expect(result.runtime.dropped).toEqual([]);
  });

  test('can mark a registered event as intentionally ignored', () => {
    registry.register('Heartbeat', 'SystemSensor');
    registry.declareIgnored('Heartbeat', 'intentionally not translated into a business signal');

    const result = registry.validate();

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
