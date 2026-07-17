import { randomUUID } from 'crypto';
import os from 'os';
import type { InferenceMetric, MetricAggregation, MetricQuery, MetricsStore } from './types';
import { aggregateMetrics, isFailure } from './aggregations';

export type PartialInferenceMetric = Omit<InferenceMetric, 'id' | 'timestamp'>;

export class MetricsService {
  private store: MetricsStore;

  constructor(store: MetricsStore) {
    this.store = store;
  }

  record(metric: PartialInferenceMetric): InferenceMetric {
    const full: InferenceMetric = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ramUsedBytes: process.memoryUsage().rss,
      ...metric,
    };

    this.store.write(full);
    return full;
  }

  query(query: MetricQuery = {}): InferenceMetric[] {
    return this.store.read(query);
  }

  aggregate(query: MetricQuery = {}): MetricAggregation {
    const metrics = this.store.read(query);
    return aggregateMetrics(metrics);
  }

  getLastLoadDurationMs(provider: string, model?: string): number | null {
    const metrics = this.store.read({ provider, model, limit: 100 });
    for (const m of metrics) {
      if (m.loadDurationMs && m.loadDurationMs > 0) {
        return m.loadDurationMs;
      }
    }
    return null;
  }

  getAverageInferenceLatencyMs(provider: string, model?: string): number | null {
    const metrics = this.store.read({ provider, model });
    const latencies = metrics.map((m) => m.latencyMs);
    if (latencies.length === 0) return null;
    return latencies.reduce((a, b) => a + b, 0) / latencies.length;
  }

  getFailureRate(provider: string, model?: string): number {
    const metrics = this.store.read({ provider, model });
    if (metrics.length === 0) return 0;
    const failed = metrics.filter(isFailure).length;
    return failed / metrics.length;
  }

  getProviderUsage(): Record<string, number> {
    const metrics = this.store.read();
    const counts: Record<string, number> = {};
    for (const m of metrics) {
      counts[m.provider] = (counts[m.provider] ?? 0) + 1;
    }
    return counts;
  }

  getModelUsage(): Record<string, number> {
    const metrics = this.store.read();
    const counts: Record<string, number> = {};
    for (const m of metrics) {
      counts[m.selectedModel] = (counts[m.selectedModel] ?? 0) + 1;
    }
    return counts;
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    if ('size' in this.store && typeof this.store.size === 'function') {
      return (this.store as { size(): number }).size();
    }
    return this.store.read().length;
  }
}
