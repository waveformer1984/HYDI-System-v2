import { WatchdogService } from '../../lib/watchdog/WatchdogService';
import type { HealthSnapshot } from '../../lib/health';

function createSnapshot(partial: Partial<HealthSnapshot> = {}): HealthSnapshot {
  const base: HealthSnapshot = {
    id: 'test',
    timestamp: new Date().toISOString(),
    status: 'healthy',
    version: '1.0.0',
    system: {
      cpu: { usagePercent: 10, loadAverage: [0], cores: 4, speedMhz: 2400 },
      memory: { totalBytes: 16e9, freeBytes: 8e9, usedBytes: 8e9, processUsedBytes: 100e6, usagePercent: 50 },
      disks: [{ path: '/', totalBytes: 500e9, freeBytes: 250e9, usagePercent: 50 }],
      uptimeSeconds: 100,
      nodeVersion: 'v20.0.0',
      gitCommit: 'abc',
      buildVersion: '1.0.0',
      platform: 'linux',
      hostname: 'test',
    },
    gpu: { status: 'unknown', devices: [] },
    ollama: { status: 'healthy', baseURL: 'http://localhost:11434', reachable: true, loadedModels: [], modelLoadTimeMs: null, averageInferenceLatencyMs: null },
    database: { status: 'healthy', supabase: { status: 'healthy', latencyMs: 10, message: 'ok' }, activeConversations: 0, queueDepth: 0, memoryEngine: { status: 'healthy', latencyMs: 5 }, scheduler: { status: 'healthy', latencyMs: null }, agentRuntime: { status: 'healthy', latencyMs: null }, revenueEngine: { status: 'healthy', latencyMs: null } },
    external: { network: { status: 'healthy', latencyMs: 10 }, firebase: { status: 'unknown', configured: false }, stripe: { status: 'unknown', configured: false } },
    workers: { status: 'unknown', total: null, healthy: null, busy: null, error: null, workers: [] },
  };
  return { ...base, ...partial };
}

describe('WatchdogService', () => {
  let healthService: any;
  let metricsService: any;
  let jobQueue: any;
  let eventBus: any;
  let watchdog: WatchdogService;

  beforeEach(() => {
    jest.useFakeTimers();
    healthService = { collect: jest.fn() };
    metricsService = { query: jest.fn().mockReturnValue([]), getFailureRate: jest.fn().mockReturnValue(0) };
    jobQueue = { get: jest.fn().mockResolvedValue([]), retry: jest.fn().mockResolvedValue(true) };
    eventBus = { publish: jest.fn().mockResolvedValue({ id: 'event-id' }) };

    watchdog = new WatchdogService({ healthService, metricsService, jobQueue, eventBus }, {
      intervalMs: 1000,
      maxRecoveryAttempts: 2,
    });
  });

  afterEach(() => {
    watchdog.stop();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('detects Ollama unavailability and publishes finding + recovery', async () => {
    healthService.collect.mockResolvedValue(createSnapshot({
      ollama: { status: 'unavailable', baseURL: 'http://localhost:11434', reachable: false, loadedModels: [], modelLoadTimeMs: null, averageInferenceLatencyMs: null },
    }));

    await watchdog.start();
    await jest.advanceTimersByTimeAsync(50);
    watchdog.stop();

    const findings = watchdog.getFindings();
    expect(findings.length).toBe(1);
    expect(findings[0].rule).toBe('ollama-unavailable');
    expect(eventBus.publish).toHaveBeenCalledWith('watchdog:finding', expect.any(Object), { priority: 'high' });
    expect(eventBus.publish).toHaveBeenCalledWith('watchdog:recovery', expect.any(Object), { priority: 'normal' });
  });

  test('escalates after max recovery attempts', async () => {
    healthService.collect.mockResolvedValue(createSnapshot({
      database: { status: 'unavailable', supabase: { status: 'unavailable', latencyMs: null, error: 'connection refused' }, activeConversations: null, queueDepth: null, memoryEngine: { status: 'unavailable', latencyMs: null }, scheduler: { status: 'unknown', latencyMs: null }, agentRuntime: { status: 'unknown', latencyMs: null }, revenueEngine: { status: 'unknown', latencyMs: null } },
    }));

    await watchdog.start();
    // Each tick re-fires the same rule. After maxRecoveryAttempts (2) the third tick escalates.
    await jest.advanceTimersByTimeAsync(1000);
    await jest.advanceTimersByTimeAsync(1000);
    await jest.advanceTimersByTimeAsync(1000);
    watchdog.stop();

    expect(watchdog.getEscalations().length).toBeGreaterThan(0);
    expect(eventBus.publish).toHaveBeenCalledWith('watchdog:escalate', expect.any(Object), { priority: 'high' });
  });

  test('retries DLQ jobs and clears finding when successful', async () => {
    jobQueue.get.mockResolvedValue([{ id: 'job-1', queueName: 'test', payload: {}, status: 'failed', priority: 0, attempts: 3, maxAttempts: 3, createdAt: new Date().toISOString() }]);
    healthService.collect.mockResolvedValue(createSnapshot());

    await watchdog.start();
    await jest.advanceTimersByTimeAsync(50);
    watchdog.stop();

    expect(jobQueue.retry).toHaveBeenCalledWith('job-1');
    expect(watchdog.getFindings().length).toBe(0);
  });

  test('detects high memory usage', async () => {
    healthService.collect.mockResolvedValue(createSnapshot({
      system: {
        cpu: { usagePercent: 10, loadAverage: [0], cores: 4, speedMhz: 2400 },
        memory: { totalBytes: 16e9, freeBytes: 1e9, usedBytes: 15e9, processUsedBytes: 100e6, usagePercent: 97 },
        disks: [{ path: '/', totalBytes: 500e9, freeBytes: 250e9, usagePercent: 50 }],
        uptimeSeconds: 100,
        nodeVersion: 'v20.0.0',
        gitCommit: 'abc',
        buildVersion: '1.0.0',
        platform: 'linux',
        hostname: 'test',
      },
    }));

    await watchdog.start();
    await jest.advanceTimersByTimeAsync(50);
    watchdog.stop();

    const findings = watchdog.getFindings();
    expect(findings.some((f) => f.rule === 'high-memory')).toBe(true);
  });
});
