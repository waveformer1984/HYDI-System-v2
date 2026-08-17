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

const mockSessions = [
  {
    id: 's1', goal: 'Summarize weekly revenue', status: 'in_progress', created_at: '2026-07-15T00:00:00Z', completed_at: null,
    steps: [{ type: 'fetch_data', status: 'completed' }, { type: 'create_task', status: 'in_progress', description: 'Draft summary' }],
  },
  {
    id: 's2', goal: 'Send onboarding email', status: 'completed', created_at: '2026-07-14T00:00:00Z', completed_at: '2026-07-14T01:00:00Z',
    steps: [{ type: 'send_email', status: 'completed' }],
  },
];

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn((table) => {
      if (table === 'auth_audit_log') return { insert: jest.fn(async () => ({ error: null })) };
      if (table === 'work_sessions') {
        return {
          select: jest.fn(() => {
            const chain = {
              order: jest.fn(() => chain),
              limit: jest.fn(async () => ({ data: mockSessions, error: null })),
              eq: jest.fn(() => chain),
            };
            return chain;
          }),
        };
      }
      if (table === 'actions') {
        return { select: jest.fn(() => ({ eq: jest.fn(async () => ({ data: [{ status: 'pending' }, { status: 'pending' }], error: null })) })) };
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
  handler = require('../../api/work-sessions/index.js').default;
});

beforeEach(() => {
  require('../../lib/rate-limit').__reset();
});

describe('api/work-sessions/index.js', () => {
  it('rejects unauthenticated requests', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: {}, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('summarizes sessions with current task and step counts', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: { 'x-hydi-service-token': makeServiceToken() }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.sessions).toHaveLength(2);
    expect(payload.sessions[0].current_task).toBe('Draft summary');
    expect(payload.sessions[0].completed_steps).toBe(1);
    expect(payload.sessions[0].total_steps).toBe(2);
  });

  it('identifies the active in-progress goal', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: { 'x-hydi-service-token': makeServiceToken() }, query: {} }, res);
    expect(res.json.mock.calls[0][0].active_goal.id).toBe('s1');
  });

  it('reports queue depth from pending actions', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: { 'x-hydi-service-token': makeServiceToken() }, query: {} }, res);
    expect(res.json.mock.calls[0][0].queue_depth).toBe(2);
  });
});
