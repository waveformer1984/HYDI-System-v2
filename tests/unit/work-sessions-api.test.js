'use strict';

const { createHmac } = require('crypto');
const { generateDeviceSecret, deriveSigningKey, signDeviceToken } = require('../../lib/auth/deviceAuth');

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

let mockDevices = {};
const eqCalls = [];

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn((table) => {
      if (table === 'auth_audit_log') return { insert: jest.fn(async () => ({ error: null })) };
      if (table === 'devices') {
        return {
          select: () => ({
            eq: (_f, value) => ({ maybeSingle: async () => ({ data: mockDevices[value] || null, error: null }) }),
          }),
        };
      }
      if (table === 'work_sessions') {
        return {
          select: jest.fn(() => {
            const chain = {
              order: jest.fn(() => chain),
              limit: jest.fn(() => chain),
              eq: jest.fn((field, value) => {
                eqCalls.push([field, value]);
                return chain;
              }),
              then: (resolve) => resolve({ data: mockSessions, error: null }),
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
  mockDevices = {};
  eqCalls.length = 0;
  require('../../lib/rate-limit').__reset();
});

function agentToken() {
  const secret = generateDeviceSecret();
  const signingKey = deriveSigningKey(secret);
  mockDevices['agent-phone'] = { device_id: 'agent-phone', role: 'agent', status: 'approved', secret_hash: signingKey };
  return signDeviceToken('agent-phone', signingKey);
}

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

  it('rejects own=true with no user_id instead of returning every user\'s sessions unfiltered', async () => {
    const res = makeRes();
    await handler(
      { method: 'GET', headers: { 'x-hydi-device-token': agentToken() }, query: { own: 'true' } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(eqCalls).toHaveLength(0);
  });

  it('scopes own=true to the supplied user_id', async () => {
    const res = makeRes();
    await handler(
      { method: 'GET', headers: { 'x-hydi-device-token': agentToken() }, query: { own: 'true', user_id: 'user-42' } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(eqCalls).toContainEqual(['user_id', 'user-42']);
  });
});
