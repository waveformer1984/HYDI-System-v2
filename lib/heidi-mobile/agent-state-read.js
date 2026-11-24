'use strict';

/**
 * Read-only aggregate for Heidi persistent-agent state (phone BFF).
 * Uses lib/store — never exposes service keys to the client.
 */

const { getStore } = require('../store');
const { parseHeartbeat } = require('../heidi/agent-persistent-loop');

const SNAPSHOT_SOURCE = 'heidi-agent-phase2';
const DEFAULT_EVENT_LIMIT = 20;

function compactPayload(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const {
    lease_holder,
    instance_id,
    heartbeat_at,
    cycle,
    lease_held,
    lease_released,
    blocked,
    cycle_complete,
    division_status,
  } = payload;
  return {
    lease_holder: lease_holder ?? null,
    instance_id: instance_id ?? null,
    heartbeat_at: heartbeat_at ?? null,
    cycle: typeof cycle === 'number' ? cycle : null,
    lease_held: lease_held === true,
    lease_released: lease_released === true,
    blocked: blocked ?? null,
    cycle_complete: cycle_complete === true,
    division_status: division_status && typeof division_status === 'object' ? division_status : {},
  };
}

function normalizeSnapshotRow(row) {
  if (!row) return null;
  const payload = compactPayload(row.payload);
  const hb = parseHeartbeat(row);
  return {
    id: row.id,
    captured_at: row.captured_at,
    cycle_id: row.cycle_id ?? null,
    source: row.source,
    heartbeat: hb,
    payload,
  };
}

function normalizeEventRow(row) {
  if (!row) return null;
  let summary = null;
  const p = row.payload;
  if (p && typeof p === 'object') {
    summary = p.reason || p.status || p.event || null;
  }
  return {
    id: row.id,
    at: row.created_at,
    type: row.event_type,
    division: row.division ?? null,
    verdict: row.verdict ?? null,
    summary: summary ? String(summary).slice(0, 240) : null,
  };
}

async function fetchLatestAgentSnapshot(store) {
  const phase2 = await store
    .from('heidi_state_snapshots')
    .select('id, captured_at, cycle_id, source, payload')
    .eq('source', SNAPSHOT_SOURCE)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (phase2.error) throw new Error(phase2.error.message);
  if (phase2.data) return phase2.data;

  const fallback = await store
    .from('heidi_state_snapshots')
    .select('id, captured_at, cycle_id, source, payload')
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (fallback.error) throw new Error(fallback.error.message);
  return fallback.data;
}

async function fetchRecentAgentEvents(store, limit = DEFAULT_EVENT_LIMIT) {
  const types = [
    'decision',
    'agent_proposal',
    'action_proposal',
    'action_refused',
    'cognitive_cycle',
  ];
  const { data, error } = await store
    .from('heidi_events')
    .select('id, event_type, division, verdict, payload, created_at')
    .in('event_type', types)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * @param {{ eventLimit?: number, store?: object }} [opts]
 */
async function fetchAgentMobileState(opts = {}) {
  const store = opts.store || getStore();
  const eventLimit = opts.eventLimit ?? DEFAULT_EVENT_LIMIT;

  if (!store.isAvailable()) {
    return {
      ok: false,
      reason: 'store_unavailable',
      message: 'Supabase store not configured on this host',
    };
  }

  try {
    const [snapshotRow, eventRows] = await Promise.all([
      fetchLatestAgentSnapshot(store),
      fetchRecentAgentEvents(store, eventLimit),
    ]);
    const snapshot = normalizeSnapshotRow(snapshotRow);
    const events = eventRows.map(normalizeEventRow).filter(Boolean);
    const lease_live =
      snapshot &&
      snapshot.heartbeat &&
      !snapshot.heartbeat.released &&
      snapshot.payload.lease_held !== false;

    return {
      ok: true,
      checked_at: new Date().toISOString(),
      agent: {
        source: SNAPSHOT_SOURCE,
        lease_live: Boolean(lease_live),
        allow_exec: false,
      },
      snapshot,
      events,
      event_count: events.length,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'read failed';
    return { ok: false, reason: 'read_error', message };
  }
}

module.exports = {
  SNAPSHOT_SOURCE,
  DEFAULT_EVENT_LIMIT,
  compactPayload,
  normalizeSnapshotRow,
  normalizeEventRow,
  fetchAgentMobileState,
};