// Voice command endpoint — Phase 5. Mobile client does speech recognition
// (Web Speech API) and posts the resulting transcript here; nothing audio
// ever reaches the server. Every transcript still goes through the exact
// same Authentication -> Authorization -> Command Queue -> Execution ->
// Audit Log chain as a manually-issued command — parseIntent() only
// classifies text, it never bypasses requireAuth()'s RBAC check.

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../lib/auth/requireAuth.js';
import { hasPermission } from '../../lib/auth/rbac.js';
import { parseIntent } from '../../lib/voice/intentParser.js';

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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-hydi-service-token, x-hydi-device-token');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Baseline auth first — every role has status:view, so this only
  // confirms "who is this", not "are they allowed to do X". The per-intent
  // permission check below is the real authorization gate.
  const auth = await requireAuth(req, res, supabase, { permission: 'status:view', routeName: 'voice-command' });
  if (!auth.ok) return;

  const { transcript } = req.body || {};
  const parsed = parseIntent(transcript);
  if (!parsed.valid) {
    return res.status(400).json({ error: 'Could not interpret command', reason: parsed.reason });
  }

  if (!hasPermission(auth.role, parsed.permission)) {
    await supabase.from('auth_audit_log').insert({
      event_type: 'permission_denied', device_id: auth.deviceId, role: auth.role,
      reason: `voice command '${parsed.intent}' requires '${parsed.permission}'`, metadata: { transcript },
    }).catch(() => {});
    return res.status(403).json({ error: 'Forbidden', reason: `role '${auth.role}' cannot run '${parsed.intent}'` });
  }

  if (parsed.queues === 'command') {
    if (!parsed.target) {
      return res.status(400).json({ error: 'Could not determine a target worker from the transcript' });
    }
    const { data, error } = await supabase
      .from('agent_control_commands')
      .insert({
        worker_type: parsed.target,
        command: parsed.command,
        status: 'pending',
        requested_by: auth.deviceId || 'service-token',
        requested_role: auth.role,
        payload: { source: 'voice', transcript: parsed.transcript },
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(202).json({ intent: parsed.intent, command: data });
  }

  if (parsed.queues === 'action') {
    const { data, error } = await supabase
      .from('actions')
      .insert({ session_id: auth.deviceId || 'voice', task_name: parsed.intent, status: 'pending', payload: { source: 'voice', transcript: parsed.transcript } })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(202).json({ intent: parsed.intent, action: data });
  }

  // Read-only intents (status_report, check_workers, summarize_activity) —
  // the mobile client follows up with the corresponding GET route
  // (/api/status/system, /api/agent-manager/control) using the same
  // credentials; this response just confirms what was understood.
  return res.status(200).json({ intent: parsed.intent, message: `Recognized '${parsed.intent}' — fetch the corresponding status route for the answer.` });
}
