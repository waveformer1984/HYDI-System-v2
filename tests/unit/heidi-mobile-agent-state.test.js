'use strict';

const {
  normalizeSnapshotRow,
  normalizeEventRow,
  computeAgentStatus,
  fetchAgentMobileState,
  SNAPSHOT_SOURCE,
} = require('../../lib/heidi-mobile/agent-state-read');

const INTERVAL = 30_000;

function mockStore({ phase2Snapshot, fallbackSnapshot, events = [] }) {
  return {
    isAvailable: () => true,
    from(table) {
      if (table === 'heidi_state_snapshots') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: phase2Snapshot ?? null,
                    error: null,
                  }),
                }),
              }),
            }),
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({
                  data: fallbackSnapshot ?? null,
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'heidi_events') {
        return {
          select: () => ({
            in: () => ({
              order: () => ({
                limit: async () => ({ data: events, error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

function phase2Row(capturedAt, extraPayload = {}) {
  return {
    id: 'snap',
    captured_at: capturedAt,
    cycle_id: 'i1',
    source: SNAPSHOT_SOURCE,
    payload: {
      lease_held: true,
      lease_holder: 'frank',
      instance_id: 'i1',
      cycle: 1,
      ...extraPayload,
    },
  };
}

describe('heidi-mobile agent-state-read', () => {
  const nowMs = Date.parse('2026-11-24T12:00:00.000Z');

  it('normalizes snapshot payload for phone', () => {
    const row = {
      id: 's1',
      captured_at: '2026-11-24T00:00:00.000Z',
      cycle_id: 'c1',
      source: 'heidi-agent-phase2',
      payload: {
        lease_holder: 'frank',
        instance_id: 'inst-a',
        cycle: 3,
        lease_held: true,
        division_status: { tasks_processed: 1 },
      },
    };
    const out = normalizeSnapshotRow(row);
    expect(out.payload.lease_holder).toBe('frank');
    expect(out.payload.cycle).toBe(3);
    expect(out.heartbeat.lease_holder).toBe('frank');
  });

  it('normalizes events with truncated summary', () => {
    const row = {
      id: 'e1',
      event_type: 'decision',
      division: 'ops',
      verdict: 'REVIEW',
      payload: { reason: 'x'.repeat(300) },
      created_at: '2026-11-24T00:00:00.000Z',
    };
    const out = normalizeEventRow(row);
    expect(out.summary.length).toBeLessThanOrEqual(240);
    expect(out.verdict).toBe('REVIEW');
  });

  it('returns store_unavailable when store is not configured', async () => {
    const r = await fetchAgentMobileState({
      store: { isAvailable: () => false },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('store_unavailable');
  });

  it('fresh phase-2 heartbeat → lease_live true', async () => {
    const capturedAt = new Date(nowMs - INTERVAL).toISOString();
    const row = phase2Row(capturedAt);
    const status = computeAgentStatus({ snapshotRow: row, fromPhase2: true, nowMs });
    expect(status.lease_live).toBe(true);
    expect(status.heartbeat_age_ms).toBe(INTERVAL);
    expect(status.snapshot_source).toBe(SNAPSHOT_SOURCE);
  });

  it('stale phase-2 heartbeat (> 2× interval) → lease_live false', async () => {
    const capturedAt = new Date(nowMs - INTERVAL * 3).toISOString();
    const row = phase2Row(capturedAt);
    const status = computeAgentStatus({ snapshotRow: row, fromPhase2: true, nowMs });
    expect(status.lease_live).toBe(false);
    expect(status.heartbeat_age_ms).toBeGreaterThan(2 * INTERVAL);
  });

  it('HEIDI_ALLOW_EXEC=true → allow_exec true', () => {
    const row = phase2Row(new Date(nowMs).toISOString());
    const status = computeAgentStatus({
      snapshotRow: row,
      fromPhase2: true,
      env: { HEIDI_ALLOW_EXEC: 'true' },
      nowMs,
    });
    expect(status.allow_exec).toBe(true);
  });

  it('fallback snapshot (non phase-2 source) → lease_live false', () => {
    const row = {
      id: 'cog',
      captured_at: new Date(nowMs).toISOString(),
      cycle_id: 'c1',
      source: 'cognitive-loop',
      payload: { lease_held: true, lease_holder: 'daemon', instance_id: 'd1' },
    };
    const status = computeAgentStatus({ snapshotRow: row, fromPhase2: false, nowMs });
    expect(status.lease_live).toBe(false);
    expect(status.snapshot_source).toBe('cognitive-loop');
  });

  it('reads latest phase-2 snapshot and last events via fetchAgentMobileState', async () => {
    const capturedAt = new Date(nowMs - 10_000).toISOString();
    const snapshot = phase2Row(capturedAt);
    const events = [
      {
        id: 'ev1',
        event_type: 'decision',
        division: 'ops',
        verdict: 'BLOCK',
        payload: { reason: 'bounds' },
        created_at: '2026-11-24T11:00:00.000Z',
      },
    ];
    const r = await fetchAgentMobileState({
      store: mockStore({ phase2Snapshot: snapshot, events }),
      eventLimit: 20,
      env: { HEIDI_ALLOW_EXEC: 'false' },
      nowMs,
    });
    expect(r.ok).toBe(true);
    expect(r.snapshot.id).toBe('snap');
    expect(r.events).toHaveLength(1);
    expect(r.agent.allow_exec).toBe(false);
    expect(r.agent.lease_live).toBe(true);
    expect(r.agent.heartbeat_age_ms).toBe(10_000);
    expect(r.agent.snapshot_source).toBe(SNAPSHOT_SOURCE);
  });

  it('fetchAgentMobileState with fallback snapshot only → lease_live false', async () => {
    const fallback = {
      id: 'fb',
      captured_at: new Date(nowMs).toISOString(),
      cycle_id: 'x',
      source: 'cognitive-loop',
      payload: { lease_held: true, lease_holder: 'daemon', instance_id: 'd1' },
    };
    const r = await fetchAgentMobileState({
      store: mockStore({ phase2Snapshot: null, fallbackSnapshot: fallback }),
      nowMs,
    });
    expect(r.ok).toBe(true);
    expect(r.agent.lease_live).toBe(false);
    expect(r.agent.snapshot_source).toBe('cognitive-loop');
  });
});