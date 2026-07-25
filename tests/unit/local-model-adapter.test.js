'use strict';

const LocalModelAdapter = require('../../src/models/local-model-adapter');

describe('LocalModelAdapter cleanup', () => {
  let adapter;

  afterEach(() => {
    if (adapter && typeof adapter.destroy === 'function') {
      return adapter.destroy();
    }
    adapter = null;
  });

  test('constructor starts monitoring intervals', () => {
    adapter = new LocalModelAdapter({ autoInitialize: false, startMonitoring: true });
    expect(adapter.systemMonitoringInterval).toBeTruthy();
    expect(adapter.hungModelMonitorInterval).toBeTruthy();
  });

  test('destroy clears all intervals, timers, and child processes', async () => {
    adapter = new LocalModelAdapter({ autoInitialize: false, startMonitoring: true });
    await adapter.destroy();
    expect(adapter.systemMonitoringInterval).toBeNull();
    expect(adapter.hungModelMonitorInterval).toBeNull();
    expect(adapter.batchTimer).toBeNull();
    expect(adapter.modelProcesses.size).toBe(0);
    expect(adapter._destroyed).toBe(true);
  });
});
