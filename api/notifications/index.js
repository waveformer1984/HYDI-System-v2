// Notification history, read/unread state, and per-device preferences —
// Phase 3. Creation itself (lib/notifications/notify.js) is called by
// other server-side code (WorkerOrchestrator failures, heartbeat
// transitions, etc.), not by mobile clients directly — this route is the
// read/manage surface a phone actually calls.

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../lib/auth/requireAuth.js';
import { CATEGORIES } from '../../lib/notifications/notify.js';

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
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    const auth = await requireAuth(req, res, supabase, { permission: 'notifications:view', routeName: 'notifications-get' });
    if (!auth.ok) return;

    const unreadOnly = req.query && req.query.unread === 'true';
    let query = supabase.from('notifications').select('*');
    if (unreadOnly) query = query.is('read_at', null);
    query = query.order('created_at', { ascending: false }).limit(50);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ notifications: data || [], unread_count: (data || []).filter((n) => !n.read_at).length });
  }

  if (req.method === 'POST') {
    const action = req.body && req.body.action;

    if (action === 'mark_read') {
      const auth = await requireAuth(req, res, supabase, { permission: 'notifications:view', routeName: 'notifications-mark-read' });
      if (!auth.ok) return;

      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'id is required' });

      const { data, error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ notification: data });
    }

    if (action === 'preferences') {
      const auth = await requireAuth(req, res, supabase, { permission: 'notifications:manage_prefs', routeName: 'notifications-preferences' });
      if (!auth.ok) return;

      const { device_id, categories } = req.body;
      if (!device_id) return res.status(400).json({ error: 'device_id is required' });
      if (categories) {
        const invalid = Object.keys(categories).filter((c) => !CATEGORIES.includes(c));
        if (invalid.length) return res.status(400).json({ error: `unknown categories: ${invalid.join(', ')}` });
      }

      const { data, error } = await supabase
        .from('notification_preferences')
        .upsert({ device_id, categories: categories || undefined, updated_at: new Date().toISOString() })
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ preferences: data });
    }

    return res.status(400).json({ error: "unknown action; expected 'mark_read' | 'preferences'" });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
