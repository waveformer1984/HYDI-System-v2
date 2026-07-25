const SubscriptionCache = require('../../src/services/subscription-cache');
const ModelRateLimiter = require('../../src/middleware/model-rate-limiter');
const { MemoryBuffer } = require('../../src/memory/MemoryBuffer');
const HeidiActionLayer = require('../../src/actions/HeidiActionLayer');
const CudaPoolManager = require('../../src/hydi-v3/CudaPoolManager');
const ObservabilityDashboard = require('../../src/hydi-v3/ObservabilityDashboard');
const SyncWorker = require('../../workers/SyncWorker');
const EventBusWorker = require('../../workers/EventBusWorker');

describe('Lifecycle cleanup', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('SubscriptionCache starts and stops cleanup interval', () => {
    const cache = new SubscriptionCache();
    expect(jest.getTimerCount()).toBe(1);
    cache.stop();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('ModelRateLimiter starts and stops queue processor', () => {
    const limiter = new ModelRateLimiter();
    expect(jest.getTimerCount()).toBe(1);
    limiter.stop();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('MemoryBuffer cancels retry timeout on destroy', async () => {
    const buffer = new MemoryBuffer();
    buffer.flushQueue.push({ table: 'tasks', key: 't1', data: { name: 'x' }, timestamp: Date.now() });
    await buffer.flushToPersistence({ write: jest.fn(() => { throw new Error('fail'); }) });
    expect(jest.getTimerCount()).toBeGreaterThanOrEqual(1);
    buffer.destroy();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('HeidiActionLayer destroy removes listeners', () => {
    const layer = new HeidiActionLayer();
    const handler = jest.fn();
    layer.on('status', handler);
    expect(layer.listenerCount('status')).toBe(1);
    layer.destroy();
    expect(layer.listenerCount('status')).toBe(0);
    expect(layer.activeActions.size).toBe(0);
    expect(layer.actions.size).toBe(0);
  });

  test('CudaPoolManager stops polling and clears state on destroy', async () => {
    const manager = new CudaPoolManager({ pollIntervalMs: 100, dataPath: '/tmp/cuda-test' });
    manager.startPolling();
    expect(jest.getTimerCount()).toBe(1);
    await manager.destroy();
    expect(jest.getTimerCount()).toBe(0);
    expect(manager.runtimes.size).toBe(0);
    expect(manager.allocations.size).toBe(0);
    expect(manager.gpus.length).toBe(0);
  });

  test('ObservabilityDashboard destroy clears history and listeners', () => {
    const dash = new ObservabilityDashboard();
    const handler = jest.fn();
    dash.on('snapshot', handler);
    dash.recordSnapshot({});
    expect(dash.history.timestamps.length).toBeGreaterThan(0);
    dash.destroy();
    expect(dash.history.timestamps.length).toBe(0);
    expect(dash.listenerCount('snapshot')).toBe(0);
  });

  test('SyncWorker stop clears all sync intervals', async () => {
    const worker = new SyncWorker('test');
    worker.queue = { shutdown: jest.fn() };
    worker.startSyncIntervals();
    expect(jest.getTimerCount()).toBe(4);
    await worker.stop();
    expect(jest.getTimerCount()).toBe(0);
    expect(worker.queue.shutdown).toHaveBeenCalled();
  });

  test('EventBusWorker stop clears metrics interval and maps', async () => {
    const worker = new EventBusWorker('test');
    worker.queue = { shutdown: jest.fn() };
    worker.metrics.startTime = new Date();
    worker.startMetricsReporting();
    expect(jest.getTimerCount()).toBe(1);
    await worker.stop();
    expect(jest.getTimerCount()).toBe(0);
    expect(worker.subscriptions.size).toBe(0);
    expect(worker.eventHistory.size).toBe(0);
    expect(worker.patternSubscriptions.size).toBe(0);
  });
});
