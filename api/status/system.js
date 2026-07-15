// Unified HYDI status snapshot — Phase 1. One round-trip covering every
// tracked subsystem's current health, the computed overall health score,
// and the most recent status-transition events (audit log). This is the
// REST snapshot; api/events/stream.js is the live push channel that keeps
// clients current between polls (see that file for why both exist —
// "no polling-only architecture" means SSE is primary, this snapshot is
// what a freshly-opened dashboard renders before the stream catches up).

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../lib/auth/requireAuth.js';
import { computeSubsystemHealth, computeOverallHealth } from '../../lib/realtime/healthScore.js';

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

const SUBSYSTEMS = [
  'hydi_core', 'ursula', 'rave_voice', 'botforge',
  'worker_fleet', 'memory', 'database', 'deployment',
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.MOBILE_CHAT_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-hydi-service-token, x-hydi-device-token');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireAuth(req, res, supabase, { permission: 'status:view', routeName: 'status-system' });
  if (!auth.ok) return;

  const [statusResult, eventsResult, workersResult] = await Promise.all([
    supabase.from('hydi_subsystem_status').select('*'),
    supabase.from('hydi_status_events').select('*').order('created_at', { ascending: false }).limit(20),
    supabase.from('worker_status').select('*'),
  ]);

  if (statusResult.error) return res.status(500).json({ error: statusResult.error.message });

  const byName = {};
  for (const row of statusResult.data || []) byName[row.subsystem] = row;

  const subsystems = {};
  for (const name of SUBSYSTEMS) {
    subsystems[name] = computeSubsystemHealth(byName[name]);
    subsystems[name].last_heartbeat = byName[name] ? byName[name].last_heartbeat : null;
  }

  const overallHealth = computeOverallHealth(subsystems);
  const offline = Object.entries(subsystems).filter(([, s]) => s.status === 'offline' || s.status === 'unknown').map(([n]) => n);

  const workerCounts = { idle: 0, busy: 0, error: 0, stopped: 0 };
  for (const w of workersResult.data || []) {
    if (workerCounts[w.status] !== undefined) workerCounts[w.status] += 1;
  }

  return res.status(200).json({
    health_score: overallHealth,
    overall_status: overallHealth >= 90 ? 'healthy' : overallHealth >= 60 ? 'degraded' : overallHealth >= 20 ? 'critical' : 'offline',
    subsystems,
    offline_subsystems: offline,
    active_workers: workerCounts,
    workers: (workersResult.data || []).map((w) => ({
      worker_id: w.worker_id,
      worker_type: w.worker_type,
      status: w.status,
      last_heartbeat: w.last_heartbeat,
      processed_count: w.processed_count,
      error_count: w.error_count,
    })),
    recent_events: eventsResult.data || [],
    ts: new Date().toISOString(),
  });
}
