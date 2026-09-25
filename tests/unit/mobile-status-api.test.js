'use strict';

const { createHmac } = require('crypto');

const SERVICE_SECRET = 'test-service-secret';

function makeServiceToken(secret = SERVICE_SECRET) {
  const ts = Date.now().toString();
  const sig = createHmac('sha256', secret).update(`${ts}:req-1:jest`).digest('hex');
  return `${ts}.req-1.jest.${sig}`;
}

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.setHeader = jest.fn(() => res);
  res.end = jest.fn(() => res);
  return res;
}

let mockDashboard = null;
let mockLedgerRows = [];
let mockDashboardError = null;

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn((table) => {
      if (table === 'auth_audit_log') return { insert: jest.fn(async () => ({ error: null })) };
      if (table === 'system_dashboard') {
        if (mockDashboardError) throw mockDashboardError;
        return { select: jest.fn(() => ({ single: jest.fn(async () => ({ data: mockDashboard, error: null })) })) };
      }
      if (table === 'financial_ledger') {
        return {
          select: jest.fn(() => ({
            in: jest.fn(() => ({
              order: jest.fn(() => ({ limit: jest.fn(async () => ({ data: mockLedgerRows, error: null })) })),
            })),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  })),
}));

let handler;

beforeAll(() => {
  process.env.HYDI_SERVICE_SECRET = SERVICE_SECRET;
  process.env.SUPABASE_URL = 'http://localhost';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  handler = require('../../api/mobile-status.js').default;
});

const realFetch = global.fetch;

beforeEach(() => {
  mockDashboard = null;
  mockLedgerRows = [];
  mockDashboardError = null;
  require('../../lib/rate-limit').__reset();
  // Hermetic: never reach a real protoforge-core on :3005.
  global.fetch = jest.fn(async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:3005'); });
});

afterAll(() => {
  global.fetch = realFetch;
});

describe('api/mobile-status.js', () => {
  it('rejects unauthenticated requests', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects requests signed with the wrong secret', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: { 'x-hydi-service-token': makeServiceToken('wrong-secret') } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns a status snapshot for an authenticated request', async () => {
    mockDashboard = { current_status: 'OK', escalation_level: 'NONE', trend_status: 'stable', jobs_failed: 0, auto_heals_24h: 2 };
    const res = makeRes();
    await handler({ method: 'GET', headers: { 'x-hydi-service-token': makeServiceToken() } }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.system).toBe('OK');
    expect(payload.streams).toHaveProperty('galactic_bytes');
  });

  it("reports protoforge-core's live pipeline metrics when it is reachable", async () => {
    const livePipeline = {
      runs: 3,
      last_run_at: '2026-09-24T00:00:00.000Z',
      outcomes: { escalate: 2, quarantined: 1 },
      stages: { ledger: { n: 3, errors: 0, skipped: 0, last_ms: 12, avg_ms: 10, p95_ms: 12 } },
    };
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: 'ok', pipeline: livePipeline }) }));
    process.env.PROTOFORGE_CORE_URL = 'http://core.test:3005';
    mockDashboard = { current_status: 'OK', escalation_level: 'NONE', trend_status: 'stable', jobs_failed: 0, auto_heals_24h: 0 };

    const res = makeRes();
    await handler({ method: 'GET', headers: { 'x-hydi-service-token': makeServiceToken() } }, res);
    delete process.env.PROTOFORGE_CORE_URL;

    expect(global.fetch).toHaveBeenCalledWith('http://core.test:3005/pipeline/metrics', expect.any(Object));
    const { pipeline } = res.json.mock.calls[0][0];
    expect(pipeline).toEqual({ ...livePipeline, source: 'protoforge-core' });
  });

  it('falls back to this process\'s metrics, flagged, when protoforge-core is unreachable', async () => {
    const { defaultMetrics } = require('../../lib/pipeline/metrics');
    defaultMetrics.reset();
    defaultMetrics.recordStage('ledger', 'ok', 12);
    defaultMetrics.recordStage('protoforge', 'error', 30);
    defaultMetrics.recordRun('error', '2026-09-24T00:00:00.000Z');
    mockDashboard = { current_status: 'OK', escalation_level: 'NONE', trend_status: 'stable', jobs_failed: 0, auto_heals_24h: 0 };

    const res = makeRes();
    await handler({ method: 'GET', headers: { 'x-hydi-service-token': makeServiceToken() } }, res);

    const { pipeline } = res.json.mock.calls[0][0];
    expect(pipeline.source).toBe('local');
    expect(pipeline.error).toBe('protoforge-core unreachable');
    expect(pipeline.runs).toBe(1);
    expect(pipeline.stages.ledger).toMatchObject({ n: 1, errors: 0, last_ms: 12 });
    expect(pipeline.stages.protoforge).toMatchObject({ n: 1, errors: 1, p95_ms: 30 });
    expect(Object.keys(pipeline.stages)).toEqual(['ingestion', 'ledger', 'cascade', 'kilo', 'protoforge', 'emission']);
    defaultMetrics.reset();
  });

  it('reports a protoforge-core timeout without waiting on it', async () => {
    global.fetch = jest.fn(async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });
    mockDashboard = { current_status: 'OK', escalation_level: 'NONE', trend_status: 'stable', jobs_failed: 0, auto_heals_24h: 0 };
    const res = makeRes();
    await handler({ method: 'GET', headers: { 'x-hydi-service-token': makeServiceToken() } }, res);
    expect(res.json.mock.calls[0][0].pipeline).toMatchObject({ source: 'local', error: 'protoforge-core timed out' });
  });

  it('includes pipeline metrics in the 503 response too, without leaking secrets', async () => {
    mockDashboardError = new Error('relation "system_dashboard" does not exist');
    const res = makeRes();
    await handler({ method: 'GET', headers: { 'x-hydi-service-token': makeServiceToken() } }, res);

    expect(res.status).toHaveBeenCalledWith(503);
    const body = res.json.mock.calls[0][0];
    expect(body.ok).toBe(false);
    expect(body.pipeline).toHaveProperty('stages');
    expect(body.pipeline.source).toBe('local');
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('test-key');
    expect(serialized).not.toContain(SERVICE_SECRET);
  });

  it('handles preflight requests without requiring auth', async () => {
    const res = makeRes();
    await handler({ method: 'OPTIONS', headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('returns 405 for non-GET methods', async () => {
    const res = makeRes();
    await handler({ method: 'POST', headers: { 'x-hydi-service-token': makeServiceToken() } }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});
