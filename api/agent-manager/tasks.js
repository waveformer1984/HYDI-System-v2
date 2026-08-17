import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../lib/auth/requireAuth.js';

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-hydi-service-token, x-hydi-device-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // GET — list tasks with optional filters
    if (req.method === 'GET') {
      const auth = await requireAuth(req, res, supabase, { permission: 'worker:view', routeName: 'agent-manager-tasks-get' });
      if (!auth.ok) return;

      const { status, agent_id, limit = '50', offset = '0' } = req.query;

      let query = supabase
        .from('actions')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(Number(offset), Number(offset) + Number(limit) - 1);

      if (status && status !== 'all') {
        query = query.eq('status', status);
      }

      if (agent_id && agent_id !== 'all') {
        query = query.contains('payload', { agent_id });
      }

      const { data, error, count } = await query;
      if (error) throw error;

      return res.status(200).json({ ok: true, tasks: data, total: count });
    }

    // POST — create a new task (dispatches real work to an agent)
    if (req.method === 'POST') {
      const auth = await requireAuth(req, res, supabase, { permission: 'worker:control', routeName: 'agent-manager-tasks-post' });
      if (!auth.ok) return;

      const { task_name, agent_id, session_id, payload = {} } = req.body || {};

      if (!task_name) return res.status(400).json({ ok: false, error: 'task_name is required' });
      if (!agent_id) return res.status(400).json({ ok: false, error: 'agent_id is required' });

      const enrichedPayload = {
        ...payload,
        agent_id,
        dispatched_at: new Date().toISOString(),
        source: 'agent-manager',
        requested_by: auth.deviceId || 'service-token',
        requested_role: auth.role,
      };

      const { data, error } = await supabase
        .from('actions')
        .insert({
          session_id: session_id || `mgr-${Date.now()}`,
          task_name,
          status: 'pending',
          payload: enrichedPayload,
        })
        .select()
        .single();

      if (error) throw error;

      // Emit to event bus so Hydi picks it up
      await supabase.from('event_bus_events').insert({
        event_type: 'agent_manager:task_dispatched',
        payload: { task_id: data.id, agent_id, task_name },
        status: 'queued',
      }).then(() => {}).catch(() => {}); // non-blocking

      return res.status(201).json({ ok: true, task: data });
    }

    // PATCH — update task status (cancel or retry)
    if (req.method === 'PATCH') {
      const auth = await requireAuth(req, res, supabase, { permission: 'worker:control', routeName: 'agent-manager-tasks-patch' });
      if (!auth.ok) return;

      const { id, action } = req.body || {};

      if (!id) return res.status(400).json({ ok: false, error: 'id is required' });
      if (!['cancel', 'retry'].includes(action)) {
        return res.status(400).json({ ok: false, error: 'action must be cancel or retry' });
      }

      const newStatus = action === 'cancel' ? 'failed' : 'pending';

      const { data, error } = await supabase
        .from('actions')
        .update({ status: newStatus })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      await supabase.from('auth_audit_log').insert({
        event_type: 'task_status_changed',
        device_id: auth.deviceId || null,
        role: auth.role,
        metadata: { task_id: id, action, new_status: newStatus },
      }).catch(() => {});

      return res.status(200).json({ ok: true, task: data });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('[agent-manager/tasks]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
