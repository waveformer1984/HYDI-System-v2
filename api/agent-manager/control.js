// Worker lifecycle control endpoint — the piece the mobile-ops task brief
// claimed already existed and didn't (verified 2026-07-15). Every command
// flows Authentication -> Authorization (RBAC) -> Command Queue -> Execution
// -> Audit Log, per the safety requirements: this route only ever inserts a
// 'pending' row into agent_control_commands. It never touches a live worker
// process directly — workers/WorkerOrchestrator.js is the sole executor,
// polling this table on its own schedule.

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

const VALID_COMMANDS = ['start', 'stop', 'restart', 'scale_up', 'scale_down'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.MOBILE_CHAT_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-hydi-service-token, x-hydi-device-token');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    const auth = await requireAuth(req, res, supabase, { permission: 'worker:view', routeName: 'agent-manager-control-get' });
    if (!auth.ok) return;

    const { data, error } = await supabase
      .from('agent_control_commands')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ commands: data || [] });
  }

  if (req.method === 'POST') {
    const auth = await requireAuth(req, res, supabase, { permission: 'worker:control', routeName: 'agent-manager-control-post' });
    if (!auth.ok) return;

    const { worker_type, worker_id, command, payload } = req.body || {};

    if (!worker_type || !command) {
      return res.status(400).json({ error: 'worker_type and command are required' });
    }
    if (!VALID_COMMANDS.includes(command)) {
      return res.status(400).json({ error: `command must be one of: ${VALID_COMMANDS.join(', ')}` });
    }

    const { data, error } = await supabase
      .from('agent_control_commands')
      .insert({
        worker_type,
        worker_id: worker_id || null,
        command,
        status: 'pending',
        requested_by: auth.deviceId || 'service-token',
        requested_role: auth.role,
        payload: payload || {},
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await supabase.from('auth_audit_log').insert({
      event_type: 'command_requested',
      device_id: auth.deviceId || null,
      role: auth.role,
      metadata: { worker_type, worker_id, command, command_id: data.id },
    }).catch(() => {});

    return res.status(202).json({ command: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
