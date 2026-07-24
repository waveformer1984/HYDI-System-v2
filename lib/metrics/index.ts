export * from './types';
export * from './aggregations';
export { MetricsService } from './MetricsService';
export type { PartialInferenceMetric } from './MetricsService';
export { MemoryMetricsStore } from './stores/MemoryMetricsStore';

import { MetricsService } from './MetricsService';
import { MemoryMetricsStore } from './stores/MemoryMetricsStore';

let defaultMetricsService: MetricsService | null = null;

export function getMetricsService(): MetricsService {
  if (!defaultMetricsService) {
    defaultMetricsService = new MetricsService(new MemoryMetricsStore({ maxSize: 5000 }));
  }
  return defaultMetricsService;
}
