export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Job {
  id: string;
  queueName: string;
  payload: unknown;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface EnqueueOptions {
  priority?: number;
  maxAttempts?: number;
  delayMs?: number;
}

export interface JobQuery {
  queueName?: string;
  status?: JobStatus;
  limit?: number;
}

export type JobHandler = (job: Job) => Promise<void> | void;

export interface JobQueue {
  enqueue(queueName: string, payload: unknown, options?: EnqueueOptions): Promise<string>;
  dequeue(queueName: string, workerId: string): Promise<Job | null>;
  complete(
    jobId: string,
    workerId: string,
    success: boolean,
    errorMessage?: string
  ): Promise<void>;
  get(query: JobQuery): Promise<Job[]>;
  retry(jobId: string): Promise<boolean>;
  purge(status: JobStatus, olderThanMs?: number): Promise<number>;
}

export interface WorkerOptions {
  queueName: string;
  handler: JobHandler;
  queue?: JobQueue;
  workerId?: string;
  pollIntervalMs?: number;
  maxConcurrency?: number;
}
