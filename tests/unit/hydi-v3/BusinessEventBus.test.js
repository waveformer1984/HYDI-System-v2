'use strict';

const BusinessEventBus = require('../../../src/hydi-v3/BusinessEventBus');

describe('BusinessEventBus', () => {
  let bus;

  beforeEach(() => {
    bus = new BusinessEventBus({ maxHistory: 100 });
  });

  afterEach(() => {
    bus.destroy();
  });

  test('emits typed events with id, timestamp, source, and payload', () => {
    const handler = jest.fn();
    bus.subscribe('FileCreated', handler);
    const e = bus.emit('FileCreated', { project: 'Resonate', path: 'x.js' }, 'FilesystemMonitor');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].type).toBe('FileCreated');
    expect(handler.mock.calls[0][0].payload.project).toBe('Resonate');
    expect(handler.mock.calls[0][0].source).toBe('FilesystemMonitor');
    expect(e.id).toBeTruthy();
    expect(e.at).toBeGreaterThan(0);
  });

  test('broadcasts all events to wildcard subscribers', () => {
    const handler = jest.fn();
    bus.subscribeAll(handler);
    bus.emit('A');
    bus.emit('B');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  test('getHistory filters by type and limits', () => {
    bus.emit('X');
    bus.emit('Y');
    bus.emit('X');
    expect(bus.getHistory({ type: 'X' }).length).toBe(2);
    expect(bus.getHistory({ limit: 2 }).length).toBe(2);
  });

  test('respects maxHistory and drops old events', () => {
    bus = new BusinessEventBus({ maxHistory: 3 });
    for (let i = 0; i < 5; i += 1) bus.emit('X');
    expect(bus.getHistory().length).toBe(3);
  });

  test('replay sends prior events into a handler', () => {
    bus.emit('X', { n: 1 });
    bus.emit('X', { n: 2 });
    bus.emit('Y', { n: 3 });
    const handler = jest.fn();
    bus.replay('X', handler);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  test('records emissions and interpretations through a registry', () => {
    const BusinessEventRegistry = require('../../../src/hydi-v3/BusinessEventRegistry');
    const registry = new BusinessEventRegistry();
    registry.register('FileCreated', 'FilesystemMonitor');
    const busWithRegistry = new BusinessEventBus({ maxHistory: 10, registry });

    busWithRegistry.emit('FileCreated', { project: 'P' }, 'FilesystemMonitor');
    busWithRegistry.emit('BusinessSignal', { originatingEvent: 'FileCreated' }, 'BusinessSignalInterpreter');

    expect(registry.emitted.get('FileCreated')).toBe(1);
    expect(registry.interpreted.get('FileCreated')).toBe(1);
    busWithRegistry.destroy();
  });

  test('records unknown emissions in the registry', () => {
    const BusinessEventRegistry = require('../../../src/hydi-v3/BusinessEventRegistry');
    const registry = new BusinessEventRegistry();
    const busWithRegistry = new BusinessEventBus({ maxHistory: 10, registry });

    busWithRegistry.emit('MysteryEvent', {}, 'RogueSensor');

    expect(registry.unknownEmissions.get('MysteryEvent')).toBe(1);
    busWithRegistry.destroy();
  });
});
