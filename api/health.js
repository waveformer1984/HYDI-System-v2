/**
 * HYDI Health Check Endpoint - Vercel Serverless
 * Supports both Supabase `system_dashboard` (when configured and explicitly enabled)
 * and a local JSON dashboard store (default for local-first HYDI).
 */

import { createClient } from '@supabase/supabase-js';

let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase env vars not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
    }
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabase;
}
const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });

const shouldUseSupabase = () => {
  return (
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.HYDI_HEALTH_SOURCE !== 'local'
  );
};

async function fetchSupabaseDashboard() {
  const { data: dashboard, error: dashError } = await supabase
    .from('system_dashboard')
    .select('*')
    .single();

  if (dashError) throw dashError;
  return dashboard;
}

async function fetchLocalDashboard() {
  const localStore = (await import('../lib/health/local-dashboard-store.js')).default;
  const dashboard = localStore.getDashboard();
  if (!dashboard) {
    throw new Error('Local dashboard unavailable');
  }
  return dashboard;
}

function buildResponse(dashboard, cloud) {
  const isHealthy = dashboard.current_status === 'OK' &&
                    dashboard.escalation_level !== 'CRITICAL';

  const statusCode = dashboard.current_status === 'CRITICAL' ? 503 :
                     dashboard.current_status === 'WARNING' ? 200 : 200;

  return {
    statusCode,
    body: {
      status: isHealthy ? 'healthy' : 'degraded',
      hydi_status: dashboard.current_status,
      trend_status: dashboard.trend_status,
      escalation_level: dashboard.escalation_level,
      timestamp: new Date().toISOString(),
      last_check: dashboard.last_check,
      version: '2.0.0-hydi',
      system: 'protoforge-hydi',
      environment: process.env.NODE_ENV || 'development',
      vercel: true,
      cloud,
      metrics: {
        jobs_queued: dashboard.jobs_queued,
        jobs_failed: dashboard.jobs_failed,
        jobs_dead: dashboard.jobs_dead,
        events_last_hour: dashboard.events_last_hour,
        auto_heals_24h: dashboard.auto_heals_24h,
        critical_pct: dashboard.critical_pct,
        warning_pct: dashboard.warning_pct,
        avg_queue_size: dashboard.avg_queue_size,
      },
      trend_reason: dashboard.trend_reason,
      escalation_action: dashboard.escalation_action,
      escalation_reason: dashboard.escalation_reason,
    },
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let dashboard;
    let cloud = { available: false, source: 'local', reason: 'Supabase not configured' };

    if (shouldUseSupabase()) {
      dashboard = await fetchSupabaseDashboard();
      cloud = { available: true, source: 'supabase', reason: 'Supabase system_dashboard' };
    } else {
      dashboard = await fetchLocalDashboard();
    }

    const { statusCode, body } = buildResponse(dashboard, cloud);
    res.status(statusCode).json(body);

  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
      version: '2.0.0-hydi',
      system: 'protoforge-hydi',
      environment: process.env.NODE_ENV || 'development',
      vercel: true,
      cloud: { available: false, source: 'none', reason: 'health source unavailable' },
    });
  }
}
