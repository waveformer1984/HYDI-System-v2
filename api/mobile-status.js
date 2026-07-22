/**
 * Mobile Status Endpoint — compact, fast, 3G-safe system snapshot.
 * Returns health + per-stream revenue in a single round-trip.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const STREAMS = [
  'galactic_bytes',
  'detailer_bot',
  'lipi_v2',
  'protogrance_aromatics',
  'rezonate',
  'waveformer_studio',
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const started = Date.now();

  try {
    const [dashResult, ledgerResult] = await Promise.all([
      supabase
        .from('system_dashboard')
        .select('current_status,escalation_level,trend_status,jobs_failed,auto_heals_24h')
        .single(),
      supabase
        .from('financial_ledger')
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
