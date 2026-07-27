import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DatabaseHealth, HealthCollector, HealthSnapshot, HealthStatus } from '../types';

export class DatabaseHealthCollector implements HealthCollector {
  readonly name = 'database';
  private client: SupabaseClient | null = null;

  private getSupabase(): SupabaseClient | null {
    if (this.client) return this.client;

    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !key) {
      return null;
    }

    this.client = createClient(url, key, {
      auth: { persistSession: false },
    });

    return this.client;
  }

  async collect(): Promise<Partial<HealthSnapshot>> {
    const database = await this.buildDatabaseHealth();
    return { database };
  }

  private async buildDatabaseHealth(): Promise<DatabaseHealth> {
    const db = this.getSupabase();
    if (!db) {
      return {
        status: 'unavailable',
        supabase: { status: 'unavailable', latencyMs: null, message: 'Supabase not configured' },
        activeConversations: null,
        queueDepth: null,
        memoryEngine: { status: 'unavailable', latencyMs: null, message: 'Supabase not configured' },
        scheduler: { status: 'unknown', latencyMs: null, message: 'Scheduler status not introspectable' },
        agentRuntime: { status: 'unknown', latencyMs: null, message: 'Agent runtime status not introspectable' },
        revenueEngine: { status: 'unknown', latencyMs: null, message: 'Revenue engine status not introspectable' },
      };
    }

    const supabaseCheck = await this.checkSupabase(db);
    const activeConversations = await this.countActiveConversations(db);
    const queueDepth = await this.countQueueDepth(db);
    const memoryEngine = await this.checkMemoryEngine(db);
    const scheduler = await this.checkScheduler(db);
    const agentRuntime = await this.checkAgentRuntime(db);
    const revenueEngine = await this.checkRevenueEngine(db);

    const statuses: HealthStatus[] = [
      supabaseCheck.status,
      memoryEngine.status,
      scheduler.status,
      agentRuntime.status,
      revenueEngine.status,
    ];

    const overall = statuses.reduce((worst, s) => (this.rank(s) > this.rank(worst) ? s : worst), 'healthy' as HealthStatus);

    return {
      status: overall,
      supabase: supabaseCheck,
      activeConversations,
      queueDepth,
      memoryEngine,
      scheduler,
      agentRuntime,
      revenueEngine,
    };
  }

  private async checkSupabase(db: SupabaseClient) {
    const start = Date.now();
    try {
      const { data, error } = await db.from('system_dashboard').select('*').limit(1);
      const latency = Date.now() - start;
      if (error) throw error;
      return { status: 'healthy' as HealthStatus, latencyMs: latency, message: 'Supabase reachable' };
    } catch (error) {
      // Fallback to a lightweight RPC/function call if the view is missing.
      try {
        const start2 = Date.now();
        const { error: fnError } = await db.rpc('get_hydi_context', {
          p_user_id: '00000000-0000-0000-0000-000000000000',
          p_query_embedding: Array(1536).fill(0),
          p_top_k: 1,
        });
        const latency2 = Date.now() - start2;
        if (fnError) throw fnError;
        return { status: 'degraded' as HealthStatus, latencyMs: latency2, message: 'Supabase reachable but system_dashboard view missing' };
      } catch (innerError) {
        return {
          status: 'unavailable' as HealthStatus,
          latencyMs: Date.now() - start,
          error: this.message(innerError),
        };
      }
    }
  }

  private async countActiveConversations(db: SupabaseClient): Promise<number | null> {
    try {
      const { count, error } = await db
        .from('sessions')
        .select('*', { count: 'exact', head: true })
        .gt('updated_at', new Date(Date.now() - 5 * 60 * 1000).toISOString());
      if (error) throw error;
      return count ?? 0;
    } catch {
      return null;
    }
  }

  private async countQueueDepth(db: SupabaseClient): Promise<number | null> {
    try {
      const { count, error } = await db
        .from('actions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      if (error) throw error;
      return count ?? 0;
    } catch {
      return null;
    }
  }

  private async checkMemoryEngine(db: SupabaseClient) {
    const start = Date.now();
    try {
      const { error } = await db.from('memories').select('id').limit(1);
      const latency = Date.now() - start;
      if (error) throw error;
      return { status: 'healthy' as HealthStatus, latencyMs: latency, message: 'Memory table reachable' };
    } catch (error) {
      return { status: 'unavailable' as HealthStatus, latencyMs: Date.now() - start, error: this.message(error) };
    }
  }

  private async checkScheduler(db: SupabaseClient) {
    try {
      const { count, error } = await db
        .from('worker_jobs')
        .select('*', { count: 'exact', head: true })
        .in('status', ['queued', 'running']);
      if (error) throw error;
      return {
        status: 'healthy' as HealthStatus,
        latencyMs: null,
        message: count && count > 0 ? `${count} jobs queued or running` : 'No pending scheduled jobs',
      };
    } catch (error) {
      return { status: 'unknown' as HealthStatus, latencyMs: null, message: 'Scheduler state not accessible', error: this.message(error) };
    }
  }

  private async checkAgentRuntime(db: SupabaseClient) {
    try {
      const { count, error } = await db
        .from('worker_status')
        .select('*', { count: 'exact', head: true });
      if (error) throw error;
      return {
        status: 'healthy' as HealthStatus,
        latencyMs: null,
        message: count ? `${count} worker status rows` : 'No worker status rows',
      };
    } catch (error) {
      return { status: 'unknown' as HealthStatus, latencyMs: null, message: 'Agent runtime not introspectable', error: this.message(error) };
    }
  }

  private async checkRevenueEngine(db: SupabaseClient) {
    const hasStripe = !!process.env.STRIPE_SECRET_KEY;
    try {
      const { count, error } = await db
        .from('financial_ledger')
        .select('*', { count: 'exact', head: true })
        .limit(1);
      if (error) throw error;
      return {
        status: hasStripe ? ('healthy' as HealthStatus) : ('degraded' as HealthStatus),
        latencyMs: null,
        message: hasStripe ? 'Revenue ledger reachable' : 'Revenue ledger reachable but Stripe key missing',
      };
    } catch (error) {
      return {
        status: 'unavailable' as HealthStatus,
        latencyMs: null,
        message: hasStripe ? 'Revenue ledger unreachable' : 'Revenue ledger unreachable and Stripe key missing',
        error: this.message(error),
      };
    }
  }

  private rank(status: HealthStatus): number {
    const map: Record<HealthStatus, number> = { healthy: 0, unknown: 1, degraded: 2, unavailable: 3 };
    return map[status] ?? 1;
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }
}
