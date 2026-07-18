import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../lib/auth/requireAuth.js';
import baseLogger from '../../lib/structured-logger.js';

const logger = baseLogger.child({ component: 'HydiSync' });

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.MOBILE_CHAT_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-hydi-service-token, x-hydi-device-token');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const auth = await requireAuth(req, res, supabase, { permission: 'status:view', routeName: 'hydi-sync-get' });
      if (!auth.ok) return;

      // Health snapshot — used by HYDI mobile chat
      const { data: dash, error } = await supabase
        .from('system_dashboard')
        .select('*')
        .single();

      if (error) throw error;

      const status = dash.current_status;
      const emoji  = status === 'OK' ? '✅' : status === 'WARNING' ? '🟡' : '🔴';

      return res.status(200).json({
        ok:      true,
        status,
        emoji,
        trend:   dash.trend_status,
        summary: `${emoji} HYDI ${status} · Trend: ${dash.trend_status} · Queue: ${dash.jobs_queued} queued / ${dash.jobs_failed} failed · Events: ${dash.events_last_hour}/hr`,
        dashboard: dash,
        timestamp: new Date().toISOString(),
      });
    }

    if (req.method === 'POST') {
      const auth = await requireAuth(req, res, supabase, { permission: 'hydi_sync:trigger', routeName: 'hydi-sync-post' });
      if (!auth.ok) return;

      const { action, payload } = req.body || {};

      if (action === 'heal') {
        const { data, error } = await supabase.rpc('auto_heal_from_trends');
        if (error) throw error;
        return res.status(200).json({ ok: true, action: 'heal', result: data });
      }

      if (action === 'trends') {
        const { data, error } = await supabase.rpc('analyze_health_trends');
        if (error) throw error;
        return res.status(200).json({ ok: true, action: 'trends', result: data });
      }

      if (action === 'escalation') {
        const { data, error } = await supabase.rpc('evaluate_system_escalation');
        if (error) throw error;
        return res.status(200).json({ ok: true, action: 'escalation', result: data });
      }

      if (action === 'event') {
        // Emit arbitrary event from mobile chat
        const { data, error } = await supabase
          .from('event_bus_events')
          .insert({
            event_type: payload?.event_type || 'hydi:mobile_ping',
            payload:    payload || {},
            status:     'queued',
          })
          .select()
          .single();
        if (error) throw error;
        return res.status(200).json({ ok: true, action: 'event', result: data });
      }

      return res.status(400).json({ ok: false, error: 'Unknown action. Use: heal | trends | escalation | event' });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  } catch (err) {
    logger.error('[HYDI sync] Request failed', { error: err });
    return res.status(500).json({
      ok:    false,
      error: err.message,
      hint:  'Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars in Vercel',
    });
  }
}
