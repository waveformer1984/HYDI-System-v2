/**
 * Mobile Status Endpoint — compact, fast, 3G-safe system snapshot.
 * Returns health + per-stream revenue in a single round-trip.
 */

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth/requireAuth.js';

// Constructed lazily (not at module load) so a missing env var surfaces as
// a graceful 503 from the handler's own try/catch below, instead of
// crashing the whole module before the handler ever runs.
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

const STREAMS = [
  'galactic_bytes',
  'detailer_bot',
  'lipi_v2',
  'protogrance_aromatics',
  'rezonate',
  'waveformer_studio',
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.MOBILE_CHAT_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-hydi-service-token, x-hydi-device-token');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireAuth(req, res, supabase, { permission: 'status:view', routeName: 'mobile-status' });
  if (!auth.ok) return;

  const started = Date.now();

  try {
    const [dashResult, ledgerResult] = await Promise.all([
      supabase
        .from('system_dashboard')
        .select('current_status,escalation_level,trend_status,jobs_failed,auto_heals_24h')
        .single(),
      supabase
        .from('ledger')
        .select('revenue_stream,net,created_at')
        .in('revenue_stream', STREAMS)
        .order('created_at', { ascending: false })
        .limit(200),
    ]);

    const cutoff = new Date(Date.now() - 86_400_000).toISOString();

    // Aggregate per-stream: last activity timestamp + 24h net revenue
    const streams = {};
    for (const s of STREAMS) streams[s] = { last: null, net_24h: 0 };

    for (const row of (ledgerResult.data || [])) {
      const entry = streams[row.revenue_stream];
      if (!entry) continue;
      if (!entry.last) entry.last = row.created_at;
      if (row.created_at >= cutoff) entry.net_24h += row.net || 0;
    }

    const dash = dashResult.data || {};
    const silent = STREAMS.filter(s => !streams[s].last || streams[s].last < cutoff);
    const alert =
      dash.escalation_level === 'CRITICAL'
        ? 'CRITICAL escalation active'
        : dash.jobs_failed > 0
        ? `${dash.jobs_failed} job(s) failed`
        : silent.length > 0
        ? `${silent.length} stream(s) silent >24h: ${silent.join(', ')}`
        : null;

    return res.status(alert && dash.escalation_level === 'CRITICAL' ? 503 : 200).json({
      ok: !alert,
      alert,
      system: dash.current_status || 'unknown',
      drift: dash.trend_status || 'unknown',
      heals_24h: dash.auto_heals_24h || 0,
      streams,
      silent,
      ms: Date.now() - started,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(503).json({
      ok: false,
      alert: err instanceof Error ? err.message : 'unknown error',
      ms: Date.now() - started,
      ts: new Date().toISOString(),
    });
  }
}
