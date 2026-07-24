import type { DailySummary, InferenceMetric, MetricAggregation } from './types';

function toMs(ns?: number | null): number | null {
  if (ns == null) return null;
  return ns / 1e6;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];

  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (upper >= sorted.length) return sorted[lower];
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function frequencyMap<T extends string>(items: T[]): Record<T, number> {
  const map = {} as Record<T, number>;
  for (const item of items) {
    map[item] = (map[item] ?? 0) + 1;
  }
  return map;
}

export function topKey(map: Record<string, number>): string {
  let top = 'unknown';
  let topCount = -1;
  for (const [key, count] of Object.entries(map)) {
    if (count > topCount) {
      topCount = count;
      top = key;
    }
  }
  return top;
}

export function isFailure(metric: InferenceMetric): boolean {
  return metric.errors && metric.errors.length > 0 ? true : false;
}

export function dateKey(timestamp: string): string {
  return timestamp.slice(0, 10); // YYYY-MM-DD
}

export function aggregateMetrics(metrics: InferenceMetric[]): MetricAggregation {
  const latencies = metrics.map((m) => m.latencyMs).sort((a, b) => a - b);
  const successfulCount = metrics.filter((m) => !isFailure(m)).length;
  const failedCount = metrics.filter(isFailure).length;

  const providerUsage = frequencyMap(metrics.map((m) => m.provider));
  const modelUsage = frequencyMap(metrics.map((m) => m.selectedModel));

  const byDay = new Map<string, InferenceMetric[]>();
  for (const m of metrics) {
    const day = dateKey(m.timestamp);
    const list = byDay.get(day) ?? [];
    list.push(m);
    byDay.set(day, list);
  }

  const dailySummaries: DailySummary[] = [];
  for (const [date, list] of byDay.entries()) {
    const dayLatencies = list.map((m) => m.latencyMs).sort((a, b) => a - b);
    const daySuccess = list.filter((m) => !isFailure(m)).length;
    const dayFail = list.filter(isFailure).length;
    const dayProviderUsage = frequencyMap(list.map((m) => m.provider));
    const dayModelUsage = frequencyMap(list.map((m) => m.selectedModel));

    dailySummaries.push({
      date,
      count: list.length,
      successCount: daySuccess,
      failureCount: dayFail,
      avgLatencyMs: average(dayLatencies),
      p95LatencyMs: percentile(dayLatencies, 95),
      p99LatencyMs: percentile(dayLatencies, 99),
      failureRate: list.length > 0 ? dayFail / list.length : 0,
      topProvider: topKey(dayProviderUsage),
      topModel: topKey(dayModelUsage),
    });
  }

  dailySummaries.sort((a, b) => a.date.localeCompare(b.date));

  return {
    count: metrics.length,
    successCount: successfulCount,
    failureCount: failedCount,
    avgLatencyMs: average(latencies),
    minLatencyMs: latencies[0] ?? 0,
    maxLatencyMs: latencies[latencies.length - 1] ?? 0,
    p95LatencyMs: percentile(latencies, 95),
    p99LatencyMs: percentile(latencies, 99),
    failureRate: metrics.length > 0 ? failedCount / metrics.length : 0,
    providerUsage,
    modelUsage,
    dailySummaries,
  };
}

export { toMs };
