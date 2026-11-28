'use strict';

const {
  STALE_HEARTBEAT_S,
  pm2OnlineCount,
  buildLeadsBlock,
  heartbeatAgeSeconds,
  fetchOperationalMobileState,
  HEARTBEAT_SOURCE,
} = require('../../lib/heidi-mobile/operational-state-read');

const NOW = Date.parse('2026-11-28T18:30:00.000Z');

function mockStore({ heartbeat, digest }) {
  return {
    isAvailable: () => true,
    from(table) {
      if (table === 'heidi_state_snapshots') {
        return {
          select: () => ({
            eq: (_col, source) => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => {
                    if (source !== HEARTBEAT_SOURCE) return { data: null, error: null };
                    return { data: heartbeat, error: null };
                  },
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'heidi_events') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: digest, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

describe('heidi-mobile operational-state-read', () => {
  test('fresh heartbeat + digest', async () => {
    const captured = new Date(NOW - 120_000).toISOString();
    const r = await fetchOperationalMobileState({
      store: mockStore({
        heartbeat: {
          captured_at: captured,
          payload: {
            ts: captured,
            pm2_services: [{ name: 'a', status: 'online' }, { name: 'b', status: 'stopped' }],
            ollama_reachable: true,
          },
        },
        digest: {
          id: 'dig-1',
          created_at: '2026-11-28T06:30:00.000Z',
          payload: {
            top10: [{ title: 'a' }, { title: 'b' }],
            top_builders: [{ name: 'Alamo Ranch Builders LLC', count: 3 }],
          },
        },
      }),
      nowMs: NOW,
    });
    expect(r.ok).toBe(true);
    expect(r.ts).toBe(captured);
    expect(r.heartbeat_age_s).toBe(120);
    expect(r.pm2_online).toBe(1);
    expect(r.ollama).toBe(true);
    expect(r.leads.lead_count).toBe(2);
    expect(r.leads.last_digest_id).toBe('dig-1');
    expect(r.leads.top_builders[0]).toEqual({ name: 'Alamo Ranch Builders LLC', permits: 3 });
  });

  test('stale heartbeat → not ok', async () => {
    const captured = new Date(NOW - (STALE_HEARTBEAT_S + 60) * 1000).toISOString();
    const r = await fetchOperationalMobileState({
      store: mockStore({
        heartbeat: { captured_at: captured, payload: { ts: captured, pm2_services: [] } },
        digest: null,
      }),
      nowMs: NOW,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('stale_heartbeat');
    expect(heartbeatAgeSeconds(captured, NOW)).toBeGreaterThan(STALE_HEARTBEAT_S);
  });

  test('no digest still returns leads block', async () => {
    const captured = new Date(NOW - 30_000).toISOString();
    const r = await fetchOperationalMobileState({
      store: mockStore({
        heartbeat: { captured_at: captured, payload: { ts: captured, pm2_services: [] } },
        digest: null,
      }),
      nowMs: NOW,
    });
    expect(r.ok).toBe(true);
    expect(r.leads).toEqual({
      last_digest_id: null,
      last_digest_at: null,
      lead_count: 0,
      top_builders: [],
    });
    expect(buildLeadsBlock(null).lead_count).toBe(0);
    expect(pm2OnlineCount({ pm2_services: [{ status: 'online' }] })).toBe(1);
  });
});