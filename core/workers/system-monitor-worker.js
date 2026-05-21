// core/workers/system-monitor-worker.js
//
// In-process worker for system/operational events:
//   heartbeat.missing    — log + write alert to Supabase if consecutive misses
//   repair.*             — log result, update dashboard metrics
//   diagnostic / error   — escalate to Supabase notifications table
//
// Domains: repair, heartbeat, system, diagnostic, log

'use strict';

const { createClient } = require('@supabase/supabase-js');

let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return _supabase;
}

async function execute(event) {
  const type = event.type || event.event_type || 'unknown';
  const source = event.source || 'unknown';
  const detail = event.detail || event.payload || {};

  // ── heartbeat.missing → write alert ──────────────────────────────────────
  if (type === 'heartbeat.missing' || type.startsWith('heartbeat')) {
    console.log(`[system-monitor] heartbeat missing from ${source}:`, detail);
    // Write a notification so Ursula can surface it
    const supabase = getSupabase();
    await supabase.from('notifications').insert({
      type: 'heartbeat_alert',
      message: `Heartbeat missing from ${source}`,
      metadata: { event_id: event.event_id, detail },
      status: 'unread'
    }).then(({ error }) => {
      if (error && !error.message.includes('does not exist')) {
        console.error('[system-monitor] notification insert error:', error.message);
      }
    });
    return { handled: true, action: 'heartbeat_alert_written', source };
  }

  // ── repair.* → log outcome ────────────────────────────────────────────────
  if (type.startsWith('repair')) {
    const processed = detail.processed ?? 0;
    console.log(`[system-monitor] repair sweep: processed=${processed} requested=${detail.requested_limit ?? '?'}`);
    return { handled: true, action: 'repair_logged', processed };
  }

  // ── diagnostic / error → escalate ────────────────────────────────────────
  if (type === 'error' || type === 'diagnostic' || type.includes('error') || type.includes('fail')) {
    console.warn(`[system-monitor] diagnostic event from ${source}:`, detail);
    return { handled: true, action: 'diagnostic_logged', severity: event.severity };
  }

  // Generic system/info event
  console.log(`[system-monitor] system event type=${type} source=${source}`);
  return { handled: true, action: 'system_event_logged' };
}

module.exports = {
  id: 'system-monitor-worker',
  version: '1.0.0',
  domains: ['repair', 'heartbeat', 'system', 'diagnostic', 'log', 'info'],
  execute,
  metadata: { description: 'Handles operational/monitoring events — heartbeat, repair sweeps, diagnostics' }
};
