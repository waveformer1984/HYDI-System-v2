import { randomUUID } from 'crypto';
import type { HealthCollector, HealthSnapshot, HealthStatus } from './types';
import { createDefaultSnapshot, mergeSnapshot, mergeStatus } from './utils';
import {
  SystemHealthCollector,
  GpuHealthCollector,
  OllamaHealthCollector,
  DatabaseHealthCollector,
  ExternalHealthCollector,
  WorkerHealthCollector,
} from './collectors';

export class HealthService {
  private collectors = new Map<string, HealthCollector>();
  private latestSnapshot: HealthSnapshot | null = null;

  register(collector: HealthCollector): this {
    this.collectors.set(collector.name, collector);
    return this;
  }

  unregister(name: string): this {
    this.collectors.delete(name);
    return this;
  }

  async collect(): Promise<HealthSnapshot> {
    const base = createDefaultSnapshot();
    base.id = randomUUID();
    base.timestamp = new Date().toISOString();

    const promises = Array.from(this.collectors.values()).map(async (collector) => {
      try {
        const partial = await collector.collect();
        return { name: collector.name, partial, error: null as Error | null };
      } catch (error) {
        return {
          name: collector.name,
          partial: {},
          error: error instanceof Error ? error : new Error('Collector failed'),
        };
      }
    });

    const results = await Promise.all(promises);
    let merged = base;
    let hasCollectorError = false;

    for (const result of results) {
      if (result.error) {
        hasCollectorError = true;
        console.error(`[HealthService] Collector ${result.name} failed:`, result.error.message);
      } else {
        merged = mergeSnapshot(merged, result.partial);
      }
    }

    const overall = this.computeOverallStatus(merged);
    merged.status = hasCollectorError ? mergeStatus(overall, 'degraded') : overall;
    this.latestSnapshot = merged;

    return merged;
  }

  getLatest(): HealthSnapshot | null {
    return this.latestSnapshot;
  }

  private computeOverallStatus(snapshot: HealthSnapshot): HealthStatus {
    const candidates: HealthStatus[] = [
      snapshot.ollama.status,
      snapshot.database.status,
      snapshot.gpu.status,
      snapshot.external.network.status,
      snapshot.workers.status,
    ];

    return candidates.reduce((worst, current) => mergeStatus(worst, current), 'healthy');
  }
}

/**
 * Factory that registers the standard HYDI collectors.
 */
export function createHealthService(): HealthService {
  return new HealthService()
    .register(new SystemHealthCollector())
    .register(new GpuHealthCollector())
    .register(new OllamaHealthCollector())
    .register(new DatabaseHealthCollector())
    .register(new ExternalHealthCollector())
    .register(new WorkerHealthCollector());
}
