/**
 * Unit tests for pages/api/traces.js's auth gate.
 *
 * Before this fix, GET /api/traces exposed raw RAW EVENT LEDGER payloads
 * (keymaker_events) to anyone with zero authentication. See ISSUES_FOUND.md.
 */

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

let mockEvents = [];

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn((table) => {
      if (table === 'auth_audit_log') return { insert: jest.fn(async () => ({ error: null })) };
      if (table === 'keymaker_events') {
        return {
          select: jest.fn(() => ({
            order: jest.fn(() => ({
              limit: jest.fn(async () => ({ data: mockEvents, error: null })),
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
  handler = require('../../pages/api/traces.js').default;
});

beforeEach(() => {
  mockEvents = [];
  require('../../lib/rate-limit').__reset();
});

describe('pages/api/traces.js', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: {}, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns trace data once a valid service token is presented', async () => {
    mockEvents = [
      { id: 1, event_id: 'evt_1', type: 'payment_intent.succeeded', source: 'stripe', severity: 'info', processed: true, occurred_at: '2026-07-17T00:00:00Z', payload: {} },
    ];
    const res = makeRes();
    await handler({ method: 'GET', headers: { 'x-hydi-service-token': makeServiceToken() }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.count).toBe(1);
    expect(payload.traces[0].eventId).toBe('evt_1');
  });
});
