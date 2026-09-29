// Authenticated event ingestion — the write-side counterpart to
// api/events/stream.js's read-side SSE fan-out.
//
// External producers that are NOT part of this Node process (chiefly
// ProtoForge's Ursula HYDIEventBridge, which POSTs here with
// `service: protoforge_ursula`) have no way to reach the in-process
// EventEmitter in lib/realtime/eventBus.js. api/heartbeat.js already
// solves that for *subsystem status*, but it is deliberately constrained
// to the eight-subsystem health vocabulary and upserts into
// hydi_subsystem_status — it is not a general event sink. This route is
// that sink: it durably appends to heidi_events (the live event table,
// per the eventFlow repoint away from the dead event_bus_events) and
// republishes onto the shared bus so connected mobile SSE clients see
// externally-produced events in the same stream as internal ones.
//
// Auth is the repo's existing model, unchanged: lib/auth/requireAuth.js,
// so an HMAC `x-hydi-service-token` (HYDI_SERVICE_SECRET) resolves to
// 'owner', and a per-device `x-hydi-device-token` resolves to its
// registered role. Fail-closed — a missing or invalid credential is a
// 401 before any write happens, and every attempt lands in
// auth_audit_log via that same choke point.

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../lib/auth/requireAuth.js';
import { publish } from '../../lib/realtime/eventBus.js';

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

// heidi_events.verdict is the HEIDI decision vocabulary (see
// supabase/migrations/20260626130000_heidi_event_loop_schema.sql). An
// ingested event may carry one, but must not invent a new value.
const VERDICTS = ['AUTO-APPROVE', 'REVIEW', 'BLOCK'];

const MAX_PAYLOAD_BYTES = 64 * 1024;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.MOBILE_CHAT_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-hydi-service-token, x-hydi-device-token');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireAuth(req, res, supabase, {
    permission: 'events:ingest',
    routeName: 'events-ingest',
    // Events are higher-volume than the control-plane routes that default
    // to 60/min; Ursula bridges a whole subsystem's activity through here.
    rateMax: 120,
  });
  if (!auth.ok) return;

  const body = req.body || {};
  // `type` and `source` are the bridge-side field names; `event_type` and
  // `division` are the heidi_events column names. Accept both so the
  // producer doesn't have to know the storage schema.
  const eventType = body.event_type || body.type;
  const division = body.division || body.source || body.service;
  const { payload, verdict, context_snapshot: contextSnapshot } = body;

  if (!eventType || typeof eventType !== 'string') {
    return res.status(400).json({ error: 'event_type (or type) is required and must be a string' });
  }
  if (division != null && typeof division !== 'string') {
    return res.status(400).json({ error: 'division (or source/service) must be a string' });
  }
  if (verdict != null && !VERDICTS.includes(verdict)) {
    return res.status(400).json({ error: `verdict must be one of: ${VERDICTS.join(', ')}` });
  }
  if (payload != null && typeof payload !== 'object') {
    return res.status(400).json({ error: 'payload must be an object' });
  }
  if (payload != null && Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_PAYLOAD_BYTES) {
    return res.status(413).json({ error: `payload exceeds ${MAX_PAYLOAD_BYTES} bytes` });
  }

  const row = {
    event_type: eventType,
    division: division || null,
    payload: payload || {},
    verdict: verdict || null,
    context_snapshot: contextSnapshot || null,
  };

  const { data, error } = await supabase.from('heidi_events').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Republish onto the in-process bus so api/events/stream.js forwards it
  // to connected mobile clients. Deliberately after the durable write:
  // the ledger is the source of truth, the stream is a view of it.
  publish('ingested_event', {
    id: data && data.id,
    event_type: eventType,
    division: row.division,
    verdict: row.verdict,
    payload: row.payload,
  });

  return res.status(200).json({
    ok: true,
    id: data && data.id,
    event_type: eventType,
    division: row.division,
    ingested_at: (data && data.created_at) || new Date().toISOString(),
  });
}
