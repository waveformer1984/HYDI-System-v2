'use strict';

/**
 * Read-only operational snapshot for Heidi Mobile (heartbeat + lead digest).
 */

const { getStore } = require('../store');
const { SOURCE: HEARTBEAT_SOURCE } = require('../../heidi-core/jobs/operational-heartbeat');

const STALE_HEARTBEAT_S = 600;

function pm2OnlineCount(payload) {
  const services = payload?.pm2_services;
  if (!Array.isArray(services)) return 0;
  return services.filter((s) => s && s.status === 'online').length;
}

function buildLeadsBlock(digestRow) {
  if (!digestRow) {
    return {
      last_digest_id: null,
      last_digest_at: null,
      lead_count: 0,
      top_builders: [],
    };
  }
  const p = digestRow.payload && typeof digestRow.payload === 'object' ? digestRow.payload : {};
  const top = Array.isArray(p.top_builders) ? p.top_builders : [];
  const top10 = Array.isArray(p.top10) ? p.top10 : [];
  return {
    last_digest_id: digestRow.id,
    last_digest_at: digestRow.created_at,
    lead_count: top10.length,
    top_builders: top.slice(0, 5).map((b) => ({
      name: b.name,
      permits: typeof b.count === 'number' ? b.count : b.permits ?? 0,
    })),
  };
}

function heartbeatAgeSeconds(capturedAt, nowMs) {
  if (!capturedAt) return null;
  const ageMs = nowMs - new Date(capturedAt).getTime();
  if (!Number.isFinite(ageMs)) return null;
  return Math.max(0, Math.round(ageMs / 1000));
}

async function fetchLatestHeartbeatSnapshot(store) {
  const { data, error } = await store
    .from('heidi_state_snapshots')
    .select('id, captured_at, payload, source')
    .eq('source', HEARTBEAT_SOURCE)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function fetchLatestLeadDigest(store) {
  const { data, error } = await store
    .from('heidi_events')
    .select('id, created_at, payload')
    .eq('event_type', 'lead_digest')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * @param {{ store?: object, nowMs?: number }} [opts]
 */
async function fetchOperationalMobileState(opts = {}) {
  const store = opts.store || getStore();
  const nowMs = typeof opts.nowMs === 'number' ? opts.nowMs : Date.now();

  if (!store.isAvailable()) {
    return {
      ok: false,
      reason: 'store_unavailable',
      message: 'Supabase store not configured on this host',
    };
  }

  try {
    const [snapshot, digest] = await Promise.all([
      fetchLatestHeartbeatSnapshot(store),
      fetchLatestLeadDigest(store),
    ]);

    if (!snapshot) {
      return { ok: false, reason: 'no_heartbeat', message: 'No operational heartbeat snapshot' };
    }

    const payload =
      snapshot.payload && typeof snapshot.payload === 'object' ? snapshot.payload : {};
    const ts = payload.ts || snapshot.captured_at;
    const heartbeat_age_s = heartbeatAgeSeconds(snapshot.captured_at, nowMs);

    if (heartbeat_age_s == null || heartbeat_age_s > STALE_HEARTBEAT_S) {
      return {
        ok: false,
        reason: 'stale_heartbeat',
        message: 'Operational heartbeat older than 10 minutes',
        ts,
        heartbeat_age_s,
      };
    }

    return {
      ok: true,
      ts,
      heartbeat_age_s,
      pm2_online: pm2OnlineCount(payload),
      ollama: payload.ollama_reachable === true,
      leads: buildLeadsBlock(digest),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'read failed';
    return { ok: false, reason: 'read_error', message };
  }
}

module.exports = {
  STALE_HEARTBEAT_S,
  HEARTBEAT_SOURCE,
  pm2OnlineCount,
  buildLeadsBlock,
  heartbeatAgeSeconds,
  fetchOperationalMobileState,
};