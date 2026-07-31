'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const FilesystemMonitor = require('../../../src/hydi-v3/FilesystemMonitor');
const BusinessEventBus = require('../../../src/hydi-v3/BusinessEventBus');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-fs-'));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('FilesystemMonitor', () => {
  let root;
  let bus;
  let monitor;

  beforeEach(() => {
    root = tempDir();
    fs.mkdirSync(path.join(root, 'src', 'audio'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'audio', 'engine.cpp'), 'initial');
    bus = new BusinessEventBus({ maxHistory: 100 });
  });

  afterEach(async () => {
    if (monitor) monitor.destroy();
    bus.destroy();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('initial scan emits ProjectOpened and FileCreated', async () => {
    const seen = [];
    bus.subscribe('*', (e) => seen.push(e));
    monitor = new FilesystemMonitor({ roots: { Resonate: root }, eventBus: bus, watch: false, logger: { log: () => {}, warn: () => {}, error: () => {} } });
    await monitor.start();
    expect(seen.some((e) => e.type === 'ProjectOpened' && e.payload.project === 'Resonate')).toBe(true);
    expect(seen.some((e) => e.type === 'FileCreated' && e.payload.relPath === 'src/audio/engine.cpp')).toBe(true);
  });

  test('scan detects FileModified after a file changes', async () => {
    const modified = [];
    bus.subscribe('FileModified', (e) => modified.push(e));
    monitor = new FilesystemMonitor({ roots: { Resonate: root }, eventBus: bus, watch: false, logger: { log: () => {}, warn: () => {}, error: () => {} } });
    await monitor.start();
    fs.writeFileSync(path.join(root, 'src', 'audio', 'engine.cpp'), 'changed content');
    await wait(50);
    await monitor.scan();
    expect(modified.length).toBe(1);
    expect(modified[0].payload.relPath).toBe('src/audio/engine.cpp');
  });

  test('scan detects FileDeleted after a file is removed', async () => {
    const deleted = [];
    bus.subscribe('FileDeleted', (e) => deleted.push(e));
    monitor = new FilesystemMonitor({ roots: { Resonate: root }, eventBus: bus, watch: false, logger: { log: () => {}, warn: () => {}, error: () => {} } });
    await monitor.start();
    fs.unlinkSync(path.join(root, 'src', 'audio', 'engine.cpp'));
    await wait(20);
    await monitor.scan();
    expect(deleted.length).toBe(1);
    expect(deleted[0].payload.relPath).toBe('src/audio/engine.cpp');
  });

  test('respects exclude patterns', async () => {
    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', 'x.js'), 'ignore');
    const created = [];
    bus.subscribe('FileCreated', (e) => created.push(e));
    monitor = new FilesystemMonitor({ roots: { Resonate: root }, eventBus: bus, watch: false, logger: { log: () => {}, warn: () => {}, error: () => {} } });
    await monitor.start();
    expect(created.some((e) => e.payload.relPath === 'node_modules/x.js')).toBe(false);
    expect(created.some((e) => e.payload.relPath === 'src/audio/engine.cpp')).toBe(true);
  });
});
