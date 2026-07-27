import { MetricsService } from '../../lib/metrics/MetricsService';
import { MemoryMetricsStore } from '../../lib/metrics/stores/MemoryMetricsStore';
import { percentile, average, aggregateMetrics } from '../../lib/metrics/aggregations';
import type { InferenceMetric } from '../../lib/metrics/types';

function makeMetric(overrides: Partial<InferenceMetric> = {}): InferenceMetric {
  return {
    id: 'test-id',
    timestamp: new Date().toISOString(),
    requestId: 'req-1',
    provider: 'local',
    selectedModel: 'llama3.2:3b',
    promptLength: 100,
    responseLength: 50,
    latencyMs: 100,
    retryCount: 0,
    ...overrides,
  };
}

describe('MetricsService', () => {
  let store: MemoryMetricsStore;
  let service: MetricsService;

  beforeEach(() => {
    store = new MemoryMetricsStore({ maxSize: 100 });
    service = new MetricsService(store);
  });

  test('records a metric and assigns id/timestamp', () => {
    const recorded = service.record(makeMetric({ requestId: 'a' }));
    expect(recorded.id).toBeDefined();
    expect(recorded.timestamp).toBeDefined();
    expect(recorded.provider).toBe('local');
  });

  test('query filters by provider and model', () => {
    service.record(makeMetric({ provider: 'local', selectedModel: 'm1' }));
    service.record(makeMetric({ provider: 'anthropic', selectedModel: 'claude' }));

    expect(service.query({ provider: 'local' }).length).toBe(1);
    expect(service.query({ model: 'claude' }).length).toBe(1);
  });

  test('query status filters success and failure', () => {
    service.record(makeMetric({ errors: ['boom'] }));
    service.record(makeMetric({ errors: [] }));
    service.record(makeMetric({})); // no errors

    expect(service.query({ status: 'failure' }).length).toBe(1);
    expect(service.query({ status: 'success' }).length).toBe(2);
  });

  test('aggregate computes latency percentiles and usage', () => {
    for (let i = 1; i <= 100; i++) {
      service.record(makeMetric({ latencyMs: i, provider: i % 2 === 0 ? 'local' : 'anthropic' }));
    }

    const agg = service.aggregate();
    expect(agg.count).toBe(100);
    expect(agg.avgLatencyMs).toBe(50.5);
    expect(agg.p95LatencyMs).toBe(95.05);
    expect(agg.p99LatencyMs).toBe(99.01);
    expect(agg.providerUsage.local).toBe(50);
    expect(agg.providerUsage.anthropic).toBe(50);
  });

  test('aggregate produces daily summaries', () => {
    service.record(makeMetric({ timestamp: '2026-07-17T10:00:00Z' }));
    service.record(makeMetric({ timestamp: '2026-07-17T11:00:00Z' }));
    service.record(makeMetric({ timestamp: '2026-07-18T10:00:00Z' }));

    const agg = service.aggregate();
    expect(agg.dailySummaries.length).toBe(2);
    expect(agg.dailySummaries[0].date).toBe('2026-07-17');
    expect(agg.dailySummaries[0].count).toBe(2);
  });

  test('failure rate is computed correctly', () => {
    service.record(makeMetric({ latencyMs: 10, errors: ['fail'] }));
    service.record(makeMetric({ latencyMs: 20 }));
    service.record(makeMetric({ latencyMs: 30 }));

    const agg = service.aggregate();
    expect(agg.failureRate).toBeCloseTo(0.333, 2);
    expect(agg.failureCount).toBe(1);
    expect(agg.successCount).toBe(2);
  });

  test('store respects max size', () => {
    const smallStore = new MemoryMetricsStore({ maxSize: 5 });
    const smallService = new MetricsService(smallStore);

    for (let i = 0; i < 10; i++) {
      smallService.record(makeMetric({ latencyMs: i }));
    }

    expect(smallService.query().length).toBe(5);
  });
});

describe('Aggregation utilities', () => {
  test('percentile interpolation', () => {
    const sorted = [10, 20, 30, 40, 50];
    expect(percentile(sorted, 50)).toBe(30);
    expect(percentile(sorted, 90)).toBe(46);
  });

  test('average', () => {
    expect(average([10, 20, 30])).toBe(20);
    expect(average([])).toBe(0);
  });

  test('aggregateMetrics handles empty input', () => {
    const agg = aggregateMetrics([]);
    expect(agg.count).toBe(0);
    expect(agg.avgLatencyMs).toBe(0);
    expect(agg.failureRate).toBe(0);
  });
});
