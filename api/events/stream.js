// Mobile-ops live event stream (Phase 1) — SSE, not polling. Broadcasts
// subsystem heartbeats (api/heartbeat.js), worker control-command outcomes
// (workers/WorkerOrchestrator.js), and notifications (lib/notifications/notify.js)
// onto every connected client via the shared process-wide bus
// (lib/realtime/eventBus.js — see that file for why an EventEmitter is the
// right primitive in this single-process, local-first deployment).
//
// Known gap, flagged rather than silently left: this is a *third* SSE
// implementation in the repo alongside src/server.js's inline
// `/events/stream` route and modules/ursula-sse-stream.js's standalone
// Ursula dashboard stream (neither wired to the new shared bus by this
// change). Consolidating all three onto lib/realtime/eventBus.js is real,
// scoped follow-up work — see docs/MOBILE_OPERATIONS.md's tech-debt list —
// not something to silently fork a fourth time here.
//
// Auth note: browsers' native EventSource cannot set custom headers, so
// this route also accepts the token via query string (?token=... for the
// legacy service token, ?device_token=... for a per-device token) in
// addition to the header form every other mobile-ops route uses.

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../lib/auth/requireAuth.js';
import { bus } from '../../lib/realtime/eventBus.js';
import { computeSubsystemHealth } from '../../lib/realtime/healthScore.js';

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

const SWEEP_INTERVAL_MS = 30 * 1000; // matches CLAUDE.md's 30s drift-observation cadence
let sweepStarted = false;

/** Periodically re-derives health for subsystems that have stopped heartbeating entirely — a
 *  subsystem going silent never triggers a new write on its own, so nothing else re-checks it. */
function startOfflineSweep() {
  if (sweepStarted) return;
  sweepStarted = true;

  const timer = setInterval(async () => {
    try {
      const { data: rows } = await supabase.from('hydi_subsystem_status').select('*');
      for (const row of rows || []) {
        const health = computeSubsystemHealth(row);
        if (health.status !== row.status) {
          await supabase.from('hydi_subsystem_status')
            .update({ status: health.status, health_score: health.health_score, updated_at: new Date().toISOString() })
            .eq('subsystem', row.subsystem);
          await supabase.from('hydi_status_events').insert({
            subsystem: row.subsystem, from_status: row.status, to_status: health.status, health_score: health.health_score,
            detail: { source: 'offline_sweep' },
          }).catch(() => {});
          bus.emit('event', { type: 'subsystem_status', subsystem: row.subsystem, status: health.status, health_score: health.health_score, timestamp: new Date().toISOString() });
        }
      }
    } catch (err) {
      console.error('[HYDI Stream] Offline sweep failed:', err instanceof Error ? err.message : err);
    }
  }, SWEEP_INTERVAL_MS);
  timer.unref();
}

export default async function handler(req, res) {
  // Query-string token support for EventSource; merged into headers so
  // requireAuth's normal header-based lookup handles both transports.
  const q = req.query || {};
  if (q.token && !req.headers['x-hydi-service-token']) req.headers['x-hydi-service-token'] = q.token;
  if (q.device_token && !req.headers['x-hydi-device-token']) req.headers['x-hydi-device-token'] = q.device_token;

  const auth = await requireAuth(req, res, supabase, { permission: 'status:view', routeName: 'events-stream', rateMax: 20 });
  if (!auth.ok) return;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': process.env.MOBILE_CHAT_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Cache-Control',
    'X-Accel-Buffering': 'no',
  });

  let seq = 0;
  const write = (event) => {
    seq += 1;
    try {
      res.write(`id: ${seq}\n`);
      res.write(`retry: 3000\n`);
      res.write(`event: ${event.type || 'message'}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (err) {
      cleanup();
    }
  };

  write({ type: 'connected', message: 'Connected to HYDI mobile-ops event stream', role: auth.role, timestamp: new Date().toISOString() });

  const onEvent = (event) => write(event);
  bus.on('event', onEvent);
  startOfflineSweep();

  const heartbeat = setInterval(() => write({ type: 'heartbeat' }), 30000);

  function cleanup() {
    clearInterval(heartbeat);
    bus.off('event', onEvent);
  }

  req.on('close', cleanup);
}
