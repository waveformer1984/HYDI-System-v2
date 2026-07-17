import type { HealthService } from './HealthService';
import type { HealthSnapshot } from './types';

export interface HealthPollerOptions {
  intervalMs?: number;
  historyLimit?: number;
}

export class HealthPoller {
  private healthService: HealthService;
  private intervalMs: number;
  private historyLimit: number;
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private history: HealthSnapshot[] = [];

  constructor(healthService: HealthService, options: HealthPollerOptions = {}) {
    this.healthService = healthService;
    this.intervalMs = options.intervalMs ?? 30000;
    this.historyLimit = options.historyLimit ?? 100;
  }

  async start(): Promise<this> {
    if (this.isRunning) return this;

    this.isRunning = true;
    await this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);

    return this;
  }

  stop(): this {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    return this;
  }

  isActive(): boolean {
    return this.isRunning;
  }

  getLatest(): HealthSnapshot | null {
    return this.healthService.getLatest() ?? this.history[this.history.length - 1] ?? null;
  }

  getHistory(limit?: number): HealthSnapshot[] {
    const result = [...this.history].reverse();
    return limit ? result.slice(0, limit) : result;
  }

  private async tick(): Promise<void> {
    try {
      const snapshot = await this.healthService.collect();
      this.history.push(snapshot);
      if (this.history.length > this.historyLimit) {
        this.history.shift();
      }
    } catch (error) {
      console.error(
        '[HealthPoller] Tick failed:',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }
}
