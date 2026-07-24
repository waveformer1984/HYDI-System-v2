import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { HealthCollector, HealthSnapshot, WorkerHealth } from '../types';

export class WorkerHealthCollector implements HealthCollector {
  readonly name = 'workers';
  private client: SupabaseClient | null = null;

  private getSupabase(): SupabaseClient | null {
    if (this.client) return this.client;

    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !key) return null;

    this.client = createClient(url, key, { auth: { persistSession: false } });
    return this.client;
  }

  async collect(): Promise<Partial<HealthSnapshot>> {
    const workers = await this.buildWorkerHealth();
    return { workers };
  }

  private async buildWorkerHealth(): Promise<WorkerHealth> {
    const db = this.getSupabase();
    if (!db) {
      return {
        status: 'unknown',
        total: null,
        healthy: null,
        busy: null,
        error: null,
        workers: [],
        message: 'Supabase not configured; cannot introspect worker status',
      };
    }

    try {
      const { data, error } = await db
        .from('worker_status')
        .select('worker_id, status')
        .order('last_heartbeat', { ascending: false })
        .limit(100);

      if (error) throw error;

      const workers = (data ?? []).map((row) => ({
        id: row.worker_id as string,
        status: row.status as string,
      }));

      const healthy = workers.filter((w) => w.status === 'idle' || w.status === 'running').length;
      const busy = workers.filter((w) => w.status === 'busy').length;
      const errored = workers.filter((w) => w.status === 'error' || w.status === 'stopped').length;

      let status: WorkerHealth['status'] = 'healthy';
      if (errored > 0) status = 'degraded';
      if (workers.length > 0 && healthy === 0) status = 'unavailable';
      if (workers.length === 0) status = 'unknown';

      return {
        status,
        total: workers.length,
        healthy,
        busy,
        error: errored,
        workers,
      };
    } catch (err) {
      return {
        status: 'unknown',
        total: null,
        healthy: null,
        busy: null,
        error: null,
        workers: [],
        message: `Worker status table not accessible: ${err instanceof Error ? err.message : 'Unknown error'}`,
      };
    }
  }
}
