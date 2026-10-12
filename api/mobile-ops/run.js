// Typed mobile-ops command gateway — allowlisted diagnostics and bounded test runs.
// POST { action, args?, confirm? } with device or service token (requireAuth).
// Never exposes secrets; output is truncated and audit-logged.

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../lib/auth/requireAuth.js';
import { executeTypedAction, listActionsForRole } from '../../lib/mobile-ops/typed-actions.js';
import { computeSubsystemHealth, computeOverallHealth } from '../../lib/realtime/healthScore.js';
import { trackedSubsystems } from '../../lib/realtime/subsystems.js';

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

async function loadServiceStatusSnapshot() {
  const [statusResult, eventsResult, workersResult] = await Promise.all([
    supabase.from('hydi_subsystem_status').select('*'),
    supabase.from('hydi_status_events').select('*').order('created_at', { ascending: false }).limit(20),
    supabase.from('worker_status').select('*'),
  ]);
  if (statusResult.error) throw new Error(statusResult.error.message);

  const byName = {};
  for (const row of statusResult.data || []) byName[row.subsystem] = row;

  const subsystems = {};
  for (const name of trackedSubsystems()) {
    subsystems[name] = computeSubsystemHealth(byName[name]);
    subsystems[name].last_heartbeat = byName[name] ? byName[name].last_heartbeat : null;
  }

  const overallHealth = computeOverallHealth(subsystems);
  return {
    health_score: overallHealth,
    overall_status: overallHealth >= 90 ? 'healthy' : overallHealth >= 60 ? 'degraded' : overallHealth >= 20 ? 'critical' : 'offline',
    subsystems,
    workers: (workersResult.data || []).map((w) => ({
      worker_id: w.worker_id,
      worker_type: w.worker_type,
      status: w.status,
      last_heartbeat: w.last_heartbeat,
    })),
    recent_events: (eventsResult.data || []).slice(0, 10),
    ts: new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.MOBILE_CHAT_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-hydi-service-token, x-hydi-device-token');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    const auth = await requireAuth(req, res, supabase, { permission: 'status:view', routeName: 'mobile-ops-run-list' });
    if (!auth.ok) return;
    return res.status(200).json({ actions: listActionsForRole(auth.role) });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, args, confirm } = req.body || {};
  const auth = await requireAuth(req, res, supabase, { permission: 'status:view', routeName: 'mobile-ops-run' });
  if (!auth.ok) return;

  const outcome = await executeTypedAction({
    action,
    args: args && typeof args === 'object' ? args : {},
    confirm: confirm === true,
    role: auth.role,
    ctx: { loadServiceStatus: loadServiceStatusSnapshot },
  });

  await supabase.from('auth_audit_log').insert({
    event_type: outcome.ok ? 'mobile_ops_action' : 'mobile_ops_action_failed',
    device_id: auth.deviceId || null,
    role: auth.role,
    reason: outcome.error || action,
    metadata: {
      action,
      correlation_id: outcome.correlation_id,
      ok: outcome.ok,
    },
  }).then(undefined, () => {});

  if (outcome.error === 'forbidden') return res.status(403).json(outcome);
  if (outcome.error === 'confirmation_required' || outcome.error === 'invalid_action') {
    return res.status(400).json(outcome);
  }

  const code = outcome.ok ? 200 : 502;
  return res.status(code).json(outcome);
}
