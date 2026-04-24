/**
 * URSULA HEALTH HOOK
 * HYDI Mobile Chat Integration
 * Provides self-aware health intelligence for Ursula agent
 * 
 * Usage:
 *   const { ursulaSelfCheck } = require('./ursula-health-hook');
 *   const status = await ursulaSelfCheck();
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Perform Ursula self-check
 * Runs trend analysis and returns formatted status for mobile chat
 * @returns {Promise<Object>} Status object with formatted message
 */
async function ursulaSelfCheck() {
  try {
    // Run trend + escalation via RPC
    const { data: heal, error: healError } = await supabase.rpc('auto_heal_from_trends');
    
    if (healError) {
      console.error('Auto-heal RPC error:', healError);
    }
    
    // Read dashboard
    const { data: dash, error: dashError } = await supabase
      .from('system_dashboard')
      .select('*')
      .single();

    if (dashError) {
      console.error('Dashboard query error:', dashError);
      return {
        status: 'UNKNOWN',
        trend: 'unknown',
        escalation: 'UNKNOWN',
        message: '❓ Unable to retrieve system status. Please check database connection.'
      };
    }

    // Ursula emits status to HYDI mobile chat
    return {
      status: dash.current_status || 'UNKNOWN',
      trend: dash.trend_status || 'unknown',
      escalation: dash.escalation_level || 'OK',
      lastCheck: dash.last_check,
      jobsQueued: dash.jobs_queued,
      jobsFailed: dash.jobs_failed,
      eventsLastHour: dash.events_last_hour,
      autoHeals24h: dash.auto_heals_24h,
      message: buildUrsulaSummary(dash, heal)
    };
  } catch (err) {
    console.error('Ursula self-check error:', err);
    return {
      status: 'ERROR',
      trend: 'unknown',
      escalation: 'CRITICAL',
      message: '🚨 System health check failed. Please contact support.'
    };
  }
}

/**
 * Build formatted summary message for Ursula chat
 * @param {Object} dash - Dashboard data from system_dashboard view
 * @param {Object} heal - Auto-heal result data
 * @returns {String} Formatted message with emojis
 */
function buildUrsulaSummary(dash, heal) {
  const emoji = {
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

  const currentStatus = dash.current_status || 'UNKNOWN';
  const trendStatus = dash.trend_status || 'unknown';
  
  let msg = `${emoji[currentStatus] || '❓'} HYDI Status: ${currentStatus}\n`;
  msg += `${emoji[trendStatus] || ''} Trend: ${trendStatus} — ${dash.trend_reason || 'N/A'}\n`;
  
  if (dash.escalation_level && dash.escalation_level !== 'OK') {
    msg += `⚠️ Escalation: ${dash.escalation_action || 'action_required'} — ${dash.escalation_reason || 'Attention needed'}\n`;
  }
  
  if (heal && heal.healed > 0) {
    msg += `🔧 Auto-healed: ${heal.healed} action(s) taken\n`;
  }
  
  msg += `📊 Queue: ${dash.jobs_queued || 0} queued | ${dash.jobs_failed || 0} failed | ${dash.events_last_hour || 0} events/hr`;
  
  return msg;
}

/**
 * Get status badge for chat header
 * @returns {Promise<String>} Emoji badge for header
 */
async function getStatusBadge() {
  try {
    const { data: dash, error } = await supabase
      .from('system_dashboard')
      .select('current_status')
      .single();
    
    if (error || !dash) return '❓';
    
    const badges = {
      OK: '✅',
      WARNING: '🟡',
      CRITICAL: '🔴'
    };
    
    return badges[dash.current_status] || '❓';
  } catch (err) {
    return '❓';
  }
}

/**
 * Check if system is healthy enough for user operations
 * @returns {Promise<Boolean>} true if system is operational
 */
async function isSystemOperational() {
  try {
    const { data: dash, error } = await supabase
      .from('system_dashboard')
      .select('current_status, escalation_level')
      .single();
    
    if (error || !dash) return false;
    
    // System is operational if not CRITICAL
    return dash.current_status !== 'CRITICAL' && dash.escalation_level !== 'CRITICAL';
  } catch (err) {
    return false;
  }
}

module.exports = { 
  ursulaSelfCheck, 
  buildUrsulaSummary,
  getStatusBadge,
  isSystemOperational
};
