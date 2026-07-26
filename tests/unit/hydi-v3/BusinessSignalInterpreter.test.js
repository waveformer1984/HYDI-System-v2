'use strict';

const BusinessEventBus = require('../../../src/hydi-v3/BusinessEventBus');
const BusinessSignalInterpreter = require('../../../src/hydi-v3/BusinessSignalInterpreter');

describe('BusinessSignalInterpreter', () => {
  let bus;
  let interpreter;

  beforeEach(() => {
    bus = new BusinessEventBus({ maxHistory: 100 });
    interpreter = new BusinessSignalInterpreter({ eventBus: bus });
  });

  afterEach(() => {
    interpreter.detach();
    bus.destroy();
  });

  test('interprets a Resonate audio file as engineering progress', (done) => {
    bus.subscribe('BusinessSignal', (e) => {
      expect(e.payload.strategicObjective).toBe('resonate');
      expect(e.payload.subsystem).toBe('Audio Engine');
      expect(e.payload.interpretation).toContain('Resonate');
      expect(e.payload.impact).toBe('engineering-progress');
      done();
    });
    bus.emit('FileModified', {
      project: 'Resonate',
      path: 'C:\\proto\\resonate\\src\\audio\\engine.cpp',
      relPath: 'src/audio/engine.cpp',
      mtime: Date.now(),
    }, 'FilesystemMonitor');
  });

  test('interprets a manufacturing artifact as manufacturing-ready', (done) => {
    bus.subscribe('BusinessSignal', (e) => {
      expect(e.payload.strategicObjective).toBe('manufacturing');
      expect(e.payload.fileCategory).toBe('manufacturing-artifact');
      expect(e.payload.impact).toBe('manufacturing-ready');
      done();
    });
    bus.emit('FileCreated', {
      project: 'protogrance',
      path: 'C:\\proto\\protogrance\\output\\brace.gcode',
      relPath: 'output/brace.gcode',
    }, 'FilesystemMonitor');
  });

  test('interpret() returns a signal without an event bus', () => {
    const sig = new BusinessSignalInterpreter({ objective: 'research' }).interpret({
      type: 'FileCreated',
      at: 1,
      payload: { project: 'research', path: 'note.md', relPath: 'note.md' },
    });
    expect(sig.payload.strategicObjective).toBe('research');
    expect(sig.payload.subsystem).toBe('Documentation');
  });
});
