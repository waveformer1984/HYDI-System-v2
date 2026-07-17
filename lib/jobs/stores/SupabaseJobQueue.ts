import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EnqueueOptions, Job, JobQueue, JobQuery, JobStatus } from '../types';

function toJob(row: any): Job {
  return {
    id: row.id,
    queueName: row.queue_name,
    payload: row.payload,
    status: row.status,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export class SupabaseJobQueue implements JobQueue {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !key) {
      throw new Error('SupabaseJobQueue requires SUPABASE_URL and a service/anon key');
    }

    this.client = client ?? createClient(url, key, { auth: { persistSession: false } });
  }

  async enqueue(queueName: string, payload: unknown, options: EnqueueOptions = {}): Promise<string> {
    const { data, error } = await this.client.rpc('enqueue_task', {
      p_queue_name: queueName,
      p_payload: payload,
      p_priority: Math.max(0, Math.min(10, options.priority ?? 0)),
      p_max_attempts: Math.max(1, options.maxAttempts ?? 3),
    });

    if (error) throw error;
    return data as string;
  }

  async dequeue(queueName: string, workerId: string): Promise<Job | null> {
    const { data, error } = await this.client.rpc('dequeue_task', {
      p_queue_name: queueName,
      p_worker_id: workerId,
    });

    if (error) throw error;
    if (!data) return null;

    const { data: rows } = await this.client
      .from('worker_queues')
      .select('*')
      .eq('id', data)
      .single();

    return rows ? toJob(rows) : null;
  }

  async complete(
    jobId: string,
    workerId: string,
    success: boolean,
    errorMessage?: string
  ): Promise<void> {
    const { error } = await this.client.rpc('complete_task', {
      p_task_id: jobId,
      p_worker_id: workerId,
      p_success: success,
      p_error_message: errorMessage || null,
    });

    if (error) throw error;
  }

  async get(query: JobQuery = {}): Promise<Job[]> {
    let builder = this.client.from('worker_queues').select('*');

    if (query.queueName) {
      builder = builder.eq('queue_name', query.queueName);
    }
    if (query.status) {
      builder = builder.eq('status', query.status);
    }

    builder = builder.order('priority', { ascending: false }).order('created_at', { ascending: true });

    if (query.limit && query.limit > 0) {
      builder = builder.limit(query.limit);
    }

    const { data, error } = await builder;
    if (error) throw error;
    return (data ?? []).map(toJob);
  }

  async retry(jobId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('worker_queues')
      .update({ status: 'pending', attempts: 0, error_message: null, completed_at: null })
      .eq('id', jobId)
      .in('status', ['failed', 'completed'])
      .select('id')
      .single();

    if (error) return false;
    return !!data;
  }

  async purge(status: JobStatus, olderThanMs: number = 0): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();

    const { count, error } = await this.client
      .from('worker_queues')
      .delete({ count: 'exact' })
      .eq('status', status)
      .lt('completed_at', cutoff);

    if (error) throw error;
    return count ?? 0;
  }
}
