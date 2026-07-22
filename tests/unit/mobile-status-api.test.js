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

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn((table) => {
      if (table === 'auth_audit_log') return { insert: jest.fn(async () => ({ error: null })) };
      if (table === 'system_dashboard') {
        return { select: jest.fn(() => ({ single: jest.fn(async () => ({ data: mockDashboard, error: null })) })) };
      }
      if (table === 'ledger') {
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

beforeEach(() => {
  mockDashboard = null;
  mockLedgerRows = [];
  require('../../lib/rate-limit').__reset();
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
