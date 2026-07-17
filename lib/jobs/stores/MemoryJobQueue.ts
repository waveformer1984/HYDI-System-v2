import { randomUUID } from 'crypto';
import type { EnqueueOptions, Job, JobQueue, JobQuery, JobStatus } from '../types';

export class MemoryJobQueue implements JobQueue {
  private jobs: Map<string, Job> = new Map();

  async enqueue(queueName: string, payload: unknown, options: EnqueueOptions = {}): Promise<string> {
    const id = randomUUID();
    const now = new Date().toISOString();

    const job: Job = {
      id,
      queueName,
      payload,
      status: 'pending',
      priority: Math.max(0, Math.min(10, options.priority ?? 0)),
      attempts: 0,
      maxAttempts: Math.max(1, options.maxAttempts ?? 3),
      createdAt: options.delayMs ? new Date(Date.now() + options.delayMs).toISOString() : now,
    };

    this.jobs.set(id, job);
    return id;
  }

  async dequeue(queueName: string, workerId: string): Promise<Job | null> {
    const candidates = Array.from(this.jobs.values())
      .filter(
        (j) =>
          j.queueName === queueName &&
          j.status === 'pending' &&
          j.attempts < j.maxAttempts &&
          new Date(j.createdAt) <= new Date()
      )
      .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt));

    const job = candidates[0];
    if (!job) return null;

    job.status = 'processing';
    job.attempts += 1;
    job.startedAt = new Date().toISOString();
    return { ...job };
  }

  async complete(
    jobId: string,
    workerId: string,
    success: boolean,
    errorMessage?: string
  ): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (success) {
      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      job.errorMessage = undefined;
    } else {
      job.errorMessage = errorMessage;
      if (job.attempts >= job.maxAttempts) {
        job.status = 'failed';
        job.completedAt = new Date().toISOString();
      } else {
        job.status = 'pending';
      }
    }
  }

  async get(query: JobQuery = {}): Promise<Job[]> {
    let result = Array.from(this.jobs.values());

    if (query.queueName) {
      result = result.filter((j) => j.queueName === query.queueName);
    }
    if (query.status) {
      result = result.filter((j) => j.status === query.status);
    }

    result.sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt));

    if (query.limit && query.limit > 0) {
      result = result.slice(0, query.limit);
    }

    return result.map((j) => ({ ...j }));
  }

  async retry(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.status !== 'failed' && job.status !== 'completed') return false;

    job.status = 'pending';
    job.attempts = 0;
    job.errorMessage = undefined;
    job.completedAt = undefined;
    job.startedAt = undefined;
    return true;
  }

  async purge(status: JobStatus, olderThanMs: number = 0): Promise<number> {
    const cutoff = Date.now() - olderThanMs;
    let removed = 0;

    for (const [id, job] of this.jobs.entries()) {
      if (job.status !== status) continue;
      const time = new Date(job.completedAt || job.createdAt).getTime();
      if (time <= cutoff) {
        this.jobs.delete(id);
        removed++;
      }
    }

    return removed;
  }
}
