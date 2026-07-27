import { HealthService } from '../../lib/health/HealthService';
import { HealthPoller } from '../../lib/health/HealthPoller';
import { mergeStatus, mergeSnapshot, createDefaultSnapshot } from '../../lib/health/utils';
import type { HealthCollector, HealthSnapshot, HealthStatus } from '../../lib/health/types';

function makeCollector(
  name: string,
  partial: Partial<HealthSnapshot>
): HealthCollector {
  return {
    name,
    collect: jest.fn().mockResolvedValue(partial),
  };
}

function healthyOllama(): Partial<HealthSnapshot> {
  return {
    ollama: {
      status: 'healthy',
      baseURL: 'http://localhost:11434',
      reachable: true,
      loadedModels: [{ name: 'llama3.2:3b' }],
      modelLoadTimeMs: null,
      averageInferenceLatencyMs: null,
    },
  };
}

function healthyDb(): Partial<HealthSnapshot> {
  return {
    database: {
      status: 'healthy',
      supabase: { status: 'healthy', latencyMs: 12 },
      activeConversations: 0,
      queueDepth: 0,
      memoryEngine: { status: 'healthy', latencyMs: 5 },
      scheduler: { status: 'healthy', latencyMs: null },
      agentRuntime: { status: 'healthy', latencyMs: null },
      revenueEngine: { status: 'healthy', latencyMs: null },
    },
  };
}

describe('HealthService', () => {
  test('collect returns a full snapshot with all required fields', async () => {
    const service = new HealthService()
      .register(makeCollector('system', {
        system: {
          cpu: { usagePercent: 10, loadAverage: [0.5], cores: 4, speedMhz: 2400 },
          memory: { totalBytes: 16e9, freeBytes: 8e9, usedBytes: 8e9, processUsedBytes: 100e6, usagePercent: 50 },
          disks: [{ path: '/', totalBytes: 500e9, freeBytes: 250e9, usagePercent: 50 }],
          uptimeSeconds: 120,
          nodeVersion: 'v20.0.0',
          gitCommit: 'abc123',
          buildVersion: '1.0.0',
          platform: 'linux',
          hostname: 'test',
        },
      }))
      .register(makeCollector('ollama', healthyOllama()))
      .register(makeCollector('database', healthyDb()))
      .register(makeCollector('external', {
        external: {
          network: { status: 'healthy', latencyMs: 20 },
          firebase: { status: 'unknown', configured: false },
          stripe: { status: 'unknown', configured: false },
        },
      }))
      .register(makeCollector('workers', {
        workers: { status: 'healthy', total: 2, healthy: 2, busy: 0, error: 0, workers: [] },
      }))
      .register(makeCollector('gpu', {
        gpu: { status: 'unknown', devices: [] },
      }));

    const snapshot = await service.collect();

    expect(snapshot.id).toBeDefined();
    expect(snapshot.timestamp).toBeDefined();
    expect(snapshot.status).toBe('healthy');
    expect(snapshot.system.cpu.cores).toBe(4);
    expect(snapshot.ollama.reachable).toBe(true);
    expect(snapshot.database.activeConversations).toBe(0);
    expect(snapshot.external.network.status).toBe('healthy');
  });

  test('overall status degrades when a critical collector is unavailable', async () => {
    const service = new HealthService()
      .register(makeCollector('ollama', healthyOllama()))
      .register(makeCollector('database', {
        database: {
          status: 'unavailable',
          supabase: { status: 'unavailable', latencyMs: null, error: 'Connection refused' },
          activeConversations: null,
          queueDepth: null,
          memoryEngine: { status: 'unavailable', latencyMs: null },
          scheduler: { status: 'unknown', latencyMs: null },
          agentRuntime: { status: 'unknown', latencyMs: null },
          revenueEngine: { status: 'unknown', latencyMs: null },
        },
      }))
      .register(makeCollector('external', {
        external: {
          network: { status: 'healthy', latencyMs: 10 },
          firebase: { status: 'unknown', configured: false },
          stripe: { status: 'unknown', configured: false },
        },
      }))
      .register(makeCollector('workers', {
        workers: { status: 'healthy', total: 1, healthy: 1, busy: 0, error: 0, workers: [] },
      }))
      .register(makeCollector('system', {}))
      .register(makeCollector('gpu', {}));

    const snapshot = await service.collect();
    expect(snapshot.status).toBe('unavailable');
  });

  test('collect continues when a collector throws', async () => {
    const badCollector: HealthCollector = {
      name: 'bad',
      collect: jest.fn().mockRejectedValue(new Error('Boom')),
    };

    const service = new HealthService()
      .register(badCollector)
      .register(makeCollector('ollama', healthyOllama()));

    const snapshot = await service.collect();
    expect(snapshot.ollama.status).toBe('healthy');
    expect(snapshot.status).toBe('degraded');
  });

  test('getLatest returns the most recent snapshot', async () => {
    const service = new HealthService().register(makeCollector('ollama', healthyOllama()));
    expect(service.getLatest()).toBeNull();
    await service.collect();
    expect(service.getLatest()?.ollama.status).toBe('healthy');
  });
});

describe('mergeStatus', () => {
  test.each<[HealthStatus, HealthStatus, HealthStatus]>([
    ['healthy', 'degraded', 'degraded'],
    ['degraded', 'unavailable', 'unavailable'],
    ['healthy', 'unavailable', 'unavailable'],
    ['unknown', 'healthy', 'healthy'],
    ['unknown', 'degraded', 'degraded'],
    ['healthy', 'healthy', 'healthy'],
  ])('mergeStatus(%s, %s) -> %s', (a, b, expected) => {
    expect(mergeStatus(a, b)).toBe(expected);
  });
});

describe('mergeSnapshot', () => {
  test('merges partial over defaults without losing unmentioned fields', () => {
    const base = createDefaultSnapshot();
    const partial: Partial<HealthSnapshot> = {
      ollama: { ...base.ollama, reachable: true, status: 'healthy' },
    };
    const merged = mergeSnapshot(base, partial);
    expect(merged.ollama.reachable).toBe(true);
    expect(merged.ollama.status).toBe('healthy');
    expect(merged.system.hostname).toBe('unknown');
  });
});

describe('HealthPoller', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('polls and stores history', async () => {
    const service = new HealthService().register(makeCollector('ollama', healthyOllama()));
    const poller = new HealthPoller(service, { intervalMs: 1000, historyLimit: 3 });

    await poller.start();
    await jest.advanceTimersByTimeAsync(1000);
    await jest.advanceTimersByTimeAsync(1000);

    const history = poller.getHistory();
    expect(history.length).toBe(3);
    expect(history[0].ollama.status).toBe('healthy');

    poller.stop();
  });

  test('history does not exceed limit', async () => {
    const service = new HealthService().register(makeCollector('ollama', healthyOllama()));
    const poller = new HealthPoller(service, { intervalMs: 100, historyLimit: 2 });

    await poller.start();
    await jest.advanceTimersByTimeAsync(100);
    await jest.advanceTimersByTimeAsync(100);
    await jest.advanceTimersByTimeAsync(100);

    expect(poller.getHistory().length).toBe(2);
    poller.stop();
  });

  test('getLatest returns latest snapshot', async () => {
    const service = new HealthService().register(makeCollector('ollama', healthyOllama()));
    const poller = new HealthPoller(service, { intervalMs: 100, historyLimit: 10 });

    await poller.start();
    expect(poller.getLatest()?.ollama.status).toBe('healthy');

    poller.stop();
  });
});
