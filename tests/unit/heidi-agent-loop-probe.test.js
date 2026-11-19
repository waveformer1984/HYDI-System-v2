'use strict';

const { probeHeidiAgentLoopHealth } = require('../../lib/observation/heidi-agent-loop-probe');

describe('probeHeidiAgentLoopHealth', () => {
  it('returns loopback health JSON without allow_exec', async () => {
    const fetchFn = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        lease_held: true,
        cycles: 4,
        allow_exec: false,
        last_cycle_at: '2026-01-01T00:00:00.000Z',
      }),
    }));
    const r = await probeHeidiAgentLoopHealth(
      { HEIDI_BIND_HOST: '127.0.0.1', HEIDI_AGENT_PORT: '3462' },
      fetchFn
    );
    expect(r).toEqual({
      reachable: true,
      lease_held: true,
      cycles: 4,
      allow_exec: false,
      last_cycle_at: '2026-01-01T00:00:00.000Z',
    });
    expect(fetchFn).toHaveBeenCalledWith(
      'http://127.0.0.1:3462/health',
      expect.objectContaining({ headers: { Accept: 'application/json' } })
    );
  });

  it('fails closed when health is down', async () => {
    const r = await probeHeidiAgentLoopHealth(
      {},
      async () => {
        throw new Error('conn refused');
      }
    );
    expect(r.reachable).toBe(false);
    expect(r.reason).toBe('unreachable');
  });
});