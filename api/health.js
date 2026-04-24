/**
 * HYDI Health Check Endpoint - Vercel Serverless
 * Integrates with Supabase health monitoring system
 * Project: akbnfovjdcobifeupvbn
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // CORS headers
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
    // Fetch from Supabase system_dashboard view
    const { data: dashboard, error: dashError } = await supabase
      .from('system_dashboard')
      .select('*')
      .single();

    if (dashError) {
      console.error('Dashboard fetch error:', dashError);
      return res.status(503).json({
        status: 'unavailable',
        timestamp: new Date().toISOString(),
        version: '2.0.0-hydi',
        system: 'protoforge-hydi',
        environment: process.env.NODE_ENV || 'development',
        error: 'Unable to connect to health monitoring database',
        vercel: true
      });
    }

    // Determine overall health status
    const isHealthy = dashboard.current_status === 'OK' && 
                      dashboard.escalation_level !== 'CRITICAL';
    
    const statusCode = dashboard.current_status === 'CRITICAL' ? 503 : 
                       dashboard.current_status === 'WARNING' ? 200 : 200;

    res.status(statusCode).json({
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
      metrics: {
        jobs_queued: dashboard.jobs_queued,
        jobs_failed: dashboard.jobs_failed,
        jobs_dead: dashboard.jobs_dead,
        events_last_hour: dashboard.events_last_hour,
        auto_heals_24h: dashboard.auto_heals_24h,
        critical_pct: dashboard.critical_pct,
        warning_pct: dashboard.warning_pct,
        avg_queue_size: dashboard.avg_queue_size
      },
      trend_reason: dashboard.trend_reason,
      escalation_action: dashboard.escalation_action,
      escalation_reason: dashboard.escalation_reason
    });

  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString(),
      version: '2.0.0-hydi',
      system: 'protoforge-hydi',
      environment: process.env.NODE_ENV || 'development',
      vercel: true
    });
  }
}
