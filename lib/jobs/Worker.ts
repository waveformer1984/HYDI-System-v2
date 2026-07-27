import { randomUUID } from 'crypto';
import type { JobQueue, WorkerOptions } from './types';

export class Worker {
  private queueName: string;
  private handler: WorkerOptions['handler'];
  private queue: JobQueue;
  private workerId: string;
  private pollIntervalMs: number;
  private maxConcurrency: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private activePromises = new Set<Promise<void>>();

  constructor(options: WorkerOptions) {
    this.queueName = options.queueName;
    this.handler = options.handler;
    this.queue = options.queue!;
    this.workerId = options.workerId || `worker-${randomUUID().slice(0, 8)}`;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.maxConcurrency = options.maxConcurrency ?? 1;
  }

  start(): this {
    if (this.running) return this;
    this.running = true;
    this.tick();
    this.timer = setInterval(() => this.tick(), this.pollIntervalMs);
    return this;
  }

  stop(): this {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return this;
  }

  isRunning(): boolean {
    return this.running;
  }

  getId(): string {
    return this.workerId;
  }

  async drain(timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.activePromises.size > 0 && Date.now() < deadline) {
      await Promise.race([...this.activePromises, new Promise((resolve) => setTimeout(resolve, 100))]);
    }
  }

  private async tick(): Promise<void> {
    if (this.activePromises.size >= this.maxConcurrency) return;

    try {
      const job = await this.queue.dequeue(this.queueName, this.workerId);
      if (!job) return;

      const promise = this.process(job)
        .catch((error) => {
          console.error(`[Worker ${this.workerId}] Unhandled process error:`, error instanceof Error ? error.message : 'Unknown error');
        })
        .finally(() => {
          this.activePromises.delete(promise);
        });

      this.activePromises.add(promise);

      // If concurrency allows, immediately try to fetch another job.
      if (this.activePromises.size < this.maxConcurrency) {
        setImmediate(() => this.tick());
      }
    } catch (error) {
      console.error(`[Worker ${this.workerId}] Dequeue failed:`, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async process(job: any): Promise<void> {
    try {
      await this.handler(job);
      await this.queue.complete(job.id, this.workerId, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Worker ${this.workerId}] Job ${job.id} failed:`, message);
      await this.queue.complete(job.id, this.workerId, false, message);
    }
  }
}
