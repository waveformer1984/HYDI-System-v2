// Heartbeat ingestion — Phase 1. Any tracked subsystem (hydi_core, ursula,
// rave_voice, botforge, worker_fleet, memory, database, deployment) POSTs
// here on its own cadence. Writes the current-state row, appends a
// hydi_status_events audit row on every transition, and publishes onto the
// shared event bus so api/events/stream.js pushes it to connected mobile
// clients immediately — no client-side polling required.

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth/requireAuth.js';
import { computeSubsystemHealth } from '../lib/realtime/healthScore.js';
import { publish } from '../lib/realtime/eventBus.js';

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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-hydi-service-token, x-hydi-device-token');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireAuth(req, res, supabase, { permission: 'heartbeat:post', routeName: 'heartbeat' });
  if (!auth.ok) return;

  const { subsystem, status, metadata } = req.body || {};
  if (!subsystem || !SUBSYSTEMS.includes(subsystem)) {
    return res.status(400).json({ error: `subsystem must be one of: ${SUBSYSTEMS.join(', ')}` });
  }
  if (status && !['healthy', 'degraded', 'critical', 'offline'].includes(status)) {
    return res.status(400).json({ error: 'status must be one of: healthy, degraded, critical, offline' });
  }

  const { data: existing } = await supabase
    .from('hydi_subsystem_status')
    .select('status')
    .eq('subsystem', subsystem)
    .maybeSingle();

  const now = new Date().toISOString();
  const reportedStatus = status || 'healthy';
  const health = computeSubsystemHealth({ status: reportedStatus, last_heartbeat: now });

  const { data, error } = await supabase
    .from('hydi_subsystem_status')
    .upsert({
      subsystem,
      status: health.status,
      health_score: health.health_score,
      last_heartbeat: now,
      metadata: metadata || {},
      updated_at: now,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  if (!existing || existing.status !== health.status) {
    await supabase.from('hydi_status_events').insert({
      subsystem,
      from_status: existing ? existing.status : null,
      to_status: health.status,
      health_score: health.health_score,
      detail: metadata || {},
    }).catch(() => {});
  }

  publish('subsystem_status', { subsystem, status: health.status, health_score: health.health_score });

  return res.status(200).json({ subsystem, status: health.status, health_score: health.health_score, last_heartbeat: now });
}
