'use strict';

const {
  normalizeSnapshotRow,
  normalizeEventRow,
  fetchAgentMobileState,
} = require('../../lib/heidi-mobile/agent-state-read');

describe('heidi-mobile agent-state-read', () => {
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

  it('reads latest phase-2 snapshot and last events', async () => {
    const snapshot = {
      id: 'snap',
      captured_at: '2026-11-24T12:00:00.000Z',
      cycle_id: 'i1',
      source: 'heidi-agent-phase2',
      payload: { lease_held: true, lease_holder: 'frank', instance_id: 'i1', cycle: 1 },
    };
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
    const store = {
      isAvailable: () => true,
      from(table) {
        if (table === 'heidi_state_snapshots') {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: snapshot, error: null }),
                  }),
                }),
              }),
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
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
    const r = await fetchAgentMobileState({ store, eventLimit: 20 });
    expect(r.ok).toBe(true);
    expect(r.snapshot.id).toBe('snap');
    expect(r.events).toHaveLength(1);
    expect(r.agent.allow_exec).toBe(false);
  });
});