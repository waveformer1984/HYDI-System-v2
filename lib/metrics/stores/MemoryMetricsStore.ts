import type { InferenceMetric, MetricQuery, MetricsStore } from '../types';

export interface MemoryMetricsStoreOptions {
  maxSize?: number;
}

export class MemoryMetricsStore implements MetricsStore {
  private metrics: InferenceMetric[] = [];
  private maxSize: number;

  constructor(options: MemoryMetricsStoreOptions = {}) {
    this.maxSize = options.maxSize ?? 5000;
  }

  write(metric: InferenceMetric): void {
    this.metrics.push(metric);
    if (this.metrics.length > this.maxSize) {
      this.metrics.shift();
    }
  }

  read(query: MetricQuery = {}): InferenceMetric[] {
    let result = [...this.metrics];

    if (query.startTime) {
      result = result.filter((m) => m.timestamp >= query.startTime!);
    }
    if (query.endTime) {
      result = result.filter((m) => m.timestamp <= query.endTime!);
    }
    if (query.provider) {
      result = result.filter((m) => m.provider === query.provider);
    }
    if (query.model) {
      result = result.filter((m) => m.selectedModel === query.model);
    }
    if (query.conversationId) {
      result = result.filter((m) => m.conversationId === query.conversationId);
    }
    if (query.status === 'success') {
      result = result.filter((m) => !m.errors || m.errors.length === 0);
    }
    if (query.status === 'failure') {
      result = result.filter((m) => m.errors && m.errors.length > 0);
    }

    result.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    if (query.limit && query.limit > 0) {
      result = result.slice(0, query.limit);
    }

    return result;
  }

  clear(): void {
    this.metrics = [];
  }

  size(): number {
    return this.metrics.length;
  }

  all(): InferenceMetric[] {
    return [...this.metrics];
  }
}
