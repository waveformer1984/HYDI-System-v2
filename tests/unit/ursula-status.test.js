'use strict';

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.setHeader = jest.fn(() => res);
  res.end = jest.fn(() => res);
  return res;
}

let mockDashboard = null;
let mockDashboardError = null;
let mockInfra = null;
let mockHeal = { healed: 0, actions: [] };

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    rpc: jest.fn(async () => ({ data: mockHeal, error: null })),
    from: jest.fn((table) => {
      if (table === 'system_dashboard') {
        return { select: jest.fn(() => ({ single: jest.fn(async () => ({ data: mockDashboard, error: mockDashboardError })) })) };
      }
      if (table === 'infrastructure_health') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({ single: jest.fn(async () => ({ data: mockInfra, error: null })) })),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  })),
}));

let handler;

beforeAll(() => {
  process.env.SUPABASE_URL = 'http://localhost';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  handler = require('../../api/ursula/status.js').default;
});

beforeEach(() => {
  mockDashboard = null;
  mockDashboardError = null;
  mockInfra = null;
  mockHeal = { healed: 0, actions: [] };
});

describe('api/ursula/status.js', () => {
  it('returns 405 for non-GET, non-OPTIONS methods', async () => {
    const res = makeRes();
    await handler({ method: 'POST', headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('short-circuits OPTIONS with 200 for CORS preflight', async () => {
    const res = makeRes();
    await handler({ method: 'OPTIONS', headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.end).toHaveBeenCalled();
  });

  it('returns 503 when the dashboard view is unreadable', async () => {
    mockDashboardError = new Error('view broken');
    const res = makeRes();
    await handler({ method: 'GET', headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json.mock.calls[0][0].status).toBe('error');
  });

  it('returns a formatted Ursula summary on success', async () => {
    mockDashboard = {
      current_status: 'OK',
      trend_status: 'stable',
      trend_reason: 'all clear',
      escalation_level: 'OK',
      jobs_queued: 3,
      jobs_failed: 0,
      jobs_dead: 0,
      events_last_hour: 12,
      auto_heals_24h: 1,
      critical_pct: 0,
      warning_pct: 0,
      avg_queue_size: 2,
      last_check: '2026-07-17T00:00:00.000Z',
    };
    mockHeal = { healed: 2, actions: ['restart-worker'] };

    const res = makeRes();
    await handler({ method: 'GET', headers: {} }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.status).toBe('success');
    expect(payload.ursula.status).toBe('OK');
    expect(payload.ursula.is_operational).toBe(true);
    expect(payload.ursula.message).toContain('Auto-healed: 2 action(s)');
    expect(payload.auto_heal).toEqual(mockHeal);
    expect(payload.metrics.jobs_queued).toBe(3);
  });

  it('marks the system non-operational when status or escalation is CRITICAL', async () => {
    mockDashboard = { current_status: 'CRITICAL', escalation_level: 'CRITICAL' };

    const res = makeRes();
    await handler({ method: 'GET', headers: {} }, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.ursula.is_operational).toBe(false);
  });

  it('returns 500 with a safe error payload if the handler throws unexpectedly', async () => {
    process.env.SUPABASE_URL = '';
    jest.resetModules();
    const freshHandler = require('../../api/ursula/status.js').default;

    const res = makeRes();
    await freshHandler({ method: 'GET', headers: {} }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].ursula.status).toBe('ERROR');

    process.env.SUPABASE_URL = 'http://localhost';
  });
});
