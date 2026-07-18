/**
 * URSULA STATUS ENDPOINT - Vercel Serverless
 * Returns formatted health status for HYDI Mobile Chat
 * Project: akbnfovjdcobifeupvbn
 */

import { createClient } from '@supabase/supabase-js';
import baseLogger from '../../lib/structured-logger.js';

const logger = baseLogger.child({ component: 'UrsulaStatus' });

// Lazy client: a missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must surface
// as a clean JSON error from the handler, not a cold-start crash at module
// load (same fix already applied to api/health.js and sibling routes — see
// ISSUES_FOUND.md #32).
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

const EMOJI = {
  OK: '✅',
  WARNING: '🟡',
  CRITICAL: '🔴',
  UNKNOWN: '❓',
  ERROR: '💥',
  stable: '📈',
  degrading: '📉',
  critical_trend: '🚨',
  unknown: '❓'
};

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
    // Run auto-heal and get trends
    const { data: heal, error: healError } = await supabase.rpc('auto_heal_from_trends');
    
    if (healError) {
      logger.error('Auto-heal RPC error', { error: healError });
    }

    // Fetch dashboard view and infrastructure health snapshot in parallel
    const [
      { data: dash, error: dashError },
      { data: infra }
    ] = await Promise.all([
      supabase.from('system_dashboard').select('*').single(),
      supabase.from('infrastructure_health').select('*').eq('id', 'singleton').single()
    ]);

    if (dashError) {
      logger.error('Dashboard fetch error', { error: dashError });
      return res.status(503).json({
        status: 'error',
        message: 'Unable to retrieve system status',
        timestamp: new Date().toISOString(),
        vercel: true
      });
    }

    // Build Ursula's formatted message
    const message = buildUrsulaSummary(dash, heal);
    const badge = EMOJI[dash.current_status] || '❓';

    res.status(200).json({
      status: 'success',
      ursula: {
        badge,
        status: dash.current_status || 'UNKNOWN',
        trend: dash.trend_status || 'unknown',
        escalation: dash.escalation_level || 'OK',
        message,
        is_operational: dash.current_status !== 'CRITICAL' && dash.escalation_level !== 'CRITICAL'
      },
      metrics: {
        jobs_queued: dash.jobs_queued || 0,
        jobs_failed: dash.jobs_failed || 0,
        jobs_dead: dash.jobs_dead || 0,
        events_last_hour: dash.events_last_hour || 0,
        auto_heals_24h: dash.auto_heals_24h || 0,
        critical_pct: dash.critical_pct || 0,
        warning_pct: dash.warning_pct || 0,
        avg_queue_size: dash.avg_queue_size || 0
      },
      trend: {
        status: dash.trend_status,
        reason: dash.trend_reason
      },
      escalation: {
        level: dash.escalation_level,
        action: dash.escalation_action,
        reason: dash.escalation_reason
      },
      auto_heal: heal || { healed: 0, actions: [] },
      infrastructure: infra ? {
        overall:    infra.overall,
        efficiency: infra.efficiency,
        power:      infra.power,
        thermal:    infra.thermal,
        scaffold:   infra.scaffold,
        revenue:    infra.revenue,
        updated_at: infra.updated_at
      } : null,
      last_check: dash.last_check,
      timestamp: new Date().toISOString(),
      vercel: true
    });

  } catch (error) {
    logger.error('Ursula status error', { error });
    res.status(500).json({
      status: 'error',
      message: error.message,
      ursula: {
        badge: '💥',
        status: 'ERROR',
        trend: 'unknown',
        escalation: 'CRITICAL',
        message: '🚨 System health check failed. Please contact support.',
        is_operational: false
      },
      timestamp: new Date().toISOString(),
      vercel: true
    });
  }
}

function buildUrsulaSummary(dash, heal) {
  const currentStatus = dash.current_status || 'UNKNOWN';
  const trendStatus = dash.trend_status || 'unknown';
  
  let msg = `${EMOJI[currentStatus] || '❓'} HYDI Status: ${currentStatus}\n`;
  msg += `${EMOJI[trendStatus] || ''} Trend: ${trendStatus} — ${dash.trend_reason || 'N/A'}\n`;
  
  if (dash.escalation_level && dash.escalation_level !== 'OK') {
    msg += `⚠️ Escalation: ${dash.escalation_action || 'action_required'} — ${dash.escalation_reason || 'Attention needed'}\n`;
  }
  
  if (heal && heal.healed > 0) {
    msg += `🔧 Auto-healed: ${heal.healed} action(s) taken\n`;
  }
  
  msg += `📊 Queue: ${dash.jobs_queued || 0} queued | ${dash.jobs_failed || 0} failed | ${dash.events_last_hour || 0} events/hr`;
  
  return msg;
}
