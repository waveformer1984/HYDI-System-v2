// Agent/worker remote control — mobile ops start/stop/restart.
//
// This does NOT execute anything directly: WorkerOrchestrator
// (workers/WorkerOrchestrator.js) is a long-lived Node process, not
// something a serverless function can reach into. Instead this writes a
// command row to agent_control_commands, which the running orchestrator
// polls (see WorkerOrchestrator.pollCommands). GET lists recent commands so
// a mobile client can show whether a request was picked up yet.
//
// Auth follows the same HMAC service-token scheme as api/chat/route.js.
// Least-privilege by construction: only start/stop/restart against a known
// worker_type are representable, and 'stop' requires an explicit
// confirm:true from the caller (command approval for destructive ops).

import { createClient } from '@supabase/supabase-js';
import { verifyServiceToken } from '../../lib/auth/verifyServiceToken.js';
import { rateLimit } from '../../lib/rate-limit.js';

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

// Must stay in sync with workerConfigs keys in workers/WorkerOrchestrator.js.
const KNOWN_WORKER_TYPES = [
  'revenue_ingestion', 'task_router', 'event_bus',
  'provisioning', 'fabrication', 'inventory', 'cost_margin',
  'opportunity_detection', 'behavior_pattern', 'anomaly_detection', 'decision_assist',
  'security_identity', 'sync', 'notification', 'audit',
];
const COMMANDS = ['start', 'stop', 'restart'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.MOBILE_CHAT_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-hydi-service-token');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!rateLimit(req, res, { name: 'agent-control', windowMs: 60 * 1000, max: 20 })) {
    return;
  }

  const { valid, reason, service } = verifyServiceToken(req.headers['x-hydi-service-token']);
  if (!valid) {
    return res.status(401).json({ error: 'Unauthorized', reason });
  }

  if (req.method === 'GET') {
    return handleList(req, res);
  }
  if (req.method === 'POST') {
    return handleCreate(req, res, service);
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleList(req, res) {
  try {
    const workerType = typeof req.query?.worker_type === 'string' ? req.query.worker_type : null;
    let query = supabase
      .from('agent_control_commands')
      .select('id, worker_type, command, status, requested_by, reason, result_message, created_at, processed_at')
      .order('created_at', { ascending: false })
      .limit(20);
    if (workerType) query = query.eq('worker_type', workerType);

    const { data, error } = await query;
    if (error) throw error;

    return res.status(200).json({ ok: true, commands: data || [] });
  } catch (err) {
    console.error('[agent-manager/control] list error:', err);
    return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

async function handleCreate(req, res, service) {
  try {
    const { worker_type: workerType, command, reason, confirm } = req.body || {};

    if (!workerType || !KNOWN_WORKER_TYPES.includes(workerType)) {
      return res.status(400).json({
        ok: false,
        error: `Unknown worker_type. Must be one of: ${KNOWN_WORKER_TYPES.join(', ')}`,
      });
    }
    if (!command || !COMMANDS.includes(command)) {
      return res.status(400).json({ ok: false, error: `command must be one of: ${COMMANDS.join(', ')}` });
    }
    // Destructive-operation approval gate: stopping a worker takes it out of
    // the pipeline, so it needs an explicit confirmation from the caller.
    if (command === 'stop' && confirm !== true) {
      return res.status(400).json({
        ok: false,
        error: 'Stopping a worker is destructive — resend with confirm: true to proceed',
      });
    }

    const { data, error } = await supabase
      .from('agent_control_commands')
      .insert({
        worker_type: workerType,
        command,
        requested_by: service, // from the verified token, never client-supplied
        reason: reason || null,
        status: 'pending',
      })
      .select('id, worker_type, command, status, created_at')
      .single();

    if (error) throw error;

    return res.status(202).json({ ok: true, queued: data });
  } catch (err) {
    console.error('[agent-manager/control] create error:', err);
    return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
}
