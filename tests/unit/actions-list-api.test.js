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

let mockRows = [];
let mockError = null;
const mockFilters = [];

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn((table) => {
      if (table === 'auth_audit_log') return { insert: jest.fn(async () => ({ error: null })) };
      if (table === 'devices') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
      if (table !== 'actions') throw new Error(`unexpected table ${table}`);
      const q = {
        select: jest.fn(() => q),
        eq: jest.fn((col, val) => { mockFilters.push([col, val]); return q; }),
        order: jest.fn(() => q),
        limit: jest.fn(async () => ({ data: mockRows, error: mockError })),
      };
      return q;
    }),
  })),
}));

let handler;

beforeAll(() => {
  process.env.HYDI_SERVICE_SECRET = SERVICE_SECRET;
  process.env.SUPABASE_URL = 'http://localhost';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  handler = require('../../pages/api/actions/index.ts').default;
});

beforeEach(() => {
  mockRows = [];
  mockError = null;
  mockFilters.length = 0;
  require('../../lib/rate-limit').__reset();
});

describe('GET /api/actions (pending approvals)', () => {
  it('rejects unauthenticated requests', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: {}, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects non-GET methods', async () => {
    const res = makeRes();
    await handler({ method: 'POST', headers: { 'x-hydi-service-token': makeServiceToken() }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('lists only escalated pending actions, without the raw action payload', async () => {
    mockRows = [
      {
        id: 'a1', session_id: 's1', task_name: 'send_email', status: 'pending', created_at: '2026-09-24T00:00:00Z',
        payload: {
          protoforge_pending_approval: true,
          protoforge_action_type: 'send_email',
          protoforge_reasoning: 'External send requires review',
          protoforge_confidence: 0.4,
          protoforge_action_payload: { to: 'x@example.com', body: 'private body text' },
        },
      },
      // Belt-and-braces: a row the DB filter should have excluded is still dropped.
      { id: 'a2', status: 'pending', task_name: 'create_task', payload: { note: 'bookkeeping row' } },
    ];
    const res = makeRes();
    await handler({ method: 'GET', headers: { 'x-hydi-service-token': makeServiceToken() }, query: {} }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const { actions } = res.json.mock.calls[0][0];
    expect(actions).toEqual([{
      id: 'a1',
      action_type: 'send_email',
      summary: 'External send requires review — params: to, body',
      confidence: 0.4,
      session_id: 's1',
      created_at: '2026-09-24T00:00:00Z',
    }]);
    expect(JSON.stringify(actions)).not.toContain('private body text');
    expect(mockFilters).toEqual(expect.arrayContaining([['status', 'pending'], ['payload->>protoforge_pending_approval', 'true']]));
  });

  it('reports database errors', async () => {
    mockError = { message: 'relation "actions" does not exist' };
    const res = makeRes();
    await handler({ method: 'GET', headers: { 'x-hydi-service-token': makeServiceToken() }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
