import { createClient } from '@supabase/supabase-js';
import type { ServiceStatus, SystemMetric, SystemHealth } from '@/lib/dashboard/types';

function now(): string {
  return new Date().toISOString();
}

export async function fetchMonitoringHealth(): Promise<SystemHealth | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  try {
    const supabase = createClient(url, key);

    const [{ data: health }, { data: alerts }, { data: queues }, { data: failures }, { data: webhooks }] = await Promise.all([
      supabase.from('system_health').select('*'),
      supabase.rpc('get_active_alerts'),
      supabase.from('worker_jobs').select('queue_name, status'),
      supabase.from('worker_failures').select('*').order('failed_at', { ascending: false }).limit(5),
      supabase.from('webhook_events').select('event_type, processed, created_at').order('created_at', { ascending: false }).limit(10),
    ]);

    const services: ServiceStatus[] = (health || []).map((metric: any) => ({
      name: metric.metric,
      healthy: metric.status === 'OK',
      status: metric.status,
      lastSeen: now(),
    }));

    if (alerts && Array.isArray(alerts) && alerts.length > 0) {
      services.push({
        name: 'active-alerts',
        healthy: false,
        status: `${alerts.length} active`,
        lastSeen: now(),
      });
    }

    const cpuMetric: SystemMetric = { name: 'CPU', value: 0, unit: '%', status: 'ok', timestamp: now() };
    const memoryMetric: SystemMetric = { name: 'Memory', value: 0, unit: '%', status: 'ok', timestamp: now() };

    return {
      cpu: cpuMetric,
      memory: memoryMetric,
      disk: { name: 'Disk', value: 0, unit: '%', status: 'ok', timestamp: now() },
      uptime: { name: 'Uptime', value: 'unknown', status: 'unknown', timestamp: now() },
      services,
    };
  } catch (error) {
    console.error('[MonitoringService] Failed to fetch:', error);
    return null;
  }
}
