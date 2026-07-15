'use strict';

/**
 * Mobile ops agent control endpoint (api/agent-manager/control.js).
 * Covers auth, input validation, and the destructive-op confirmation gate.
 */

const { createHmac } = require('crypto');

let mockInsertedRows = [];
let mockListRows = [];

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn((table) => {
      if (table !== 'agent_control_commands') {
        throw new Error(`unexpected table: ${table}`);
      }
      return {
        insert: jest.fn((row) => {
          mockInsertedRows.push(row);
          return {
            select: jest.fn(() => ({
              single: jest.fn(async () => ({
                data: { id: 'cmd-test-1', ...row, created_at: new Date().toISOString() },
                error: null,
              })),
            })),
          };
        }),
        select: jest.fn(() => ({
          order: jest.fn(() => ({
            limit: jest.fn(async () => ({ data: mockListRows, error: null })),
            eq: jest.fn(() => ({
              limit: jest.fn(async () => ({ data: mockListRows, error: null })),
            })),
          })),
        })),
      };
    }),
  })),
}));

const SERVICE_SECRET = 'test-control-secret';

function makeToken(secret = SERVICE_SECRET, service = 'mobile-chat') {
  const ts = Date.now().toString();
  const requestId = 'req-control-1';
  const sig = createHmac('sha256', secret).update(`${ts}:${requestId}:${service}`).digest('hex');
  return `${ts}.${requestId}.${service}.${sig}`;
}

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.setHeader = jest.fn(() => res);
  res.end = jest.fn(() => res);
  return res;
}

function makeReq({ method = 'POST', body = {}, token = makeToken(), query = {} } = {}) {
  return {
    method,
    headers: token ? { 'x-hydi-service-token': token } : {},
    body,
    query,
  };
}

let handler;

beforeAll(() => {
  process.env.HYDI_SERVICE_SECRET = SERVICE_SECRET;
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  handler = require('../../api/agent-manager/control.js').default;
});

beforeEach(() => {
  mockInsertedRows = [];
  mockListRows = [];
});

describe('agent-manager/control — auth', () => {
  test('rejects a missing service token with 401', async () => {
    const res = makeRes();
    await handler(makeReq({ token: null }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('rejects a token signed with the wrong secret with 401', async () => {
    const res = makeRes();
    await handler(makeReq({ token: makeToken('wrong-secret') }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('agent-manager/control — validation', () => {
  test('rejects an unknown worker_type', async () => {
    const res = makeRes();
    await handler(makeReq({ body: { worker_type: 'not_a_worker', command: 'start' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(/Unknown worker_type/);
  });

  test('rejects an unknown command', async () => {
    const res = makeRes();
    await handler(makeReq({ body: { worker_type: 'sync', command: 'delete_everything' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(/command must be one of/);
  });

  test('rejects a stop command without confirm:true', async () => {
    const res = makeRes();
    await handler(makeReq({ body: { worker_type: 'sync', command: 'stop' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(/confirm: true/);
    expect(mockInsertedRows).toHaveLength(0);
  });
});

describe('agent-manager/control — command creation', () => {
  test('queues a valid start command and stamps requested_by from the verified token', async () => {
    const res = makeRes();
    await handler(makeReq({ body: { worker_type: 'sync', command: 'start', reason: 'manual restart' } }), res);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(mockInsertedRows).toHaveLength(1);
    expect(mockInsertedRows[0]).toMatchObject({
      worker_type: 'sync',
      command: 'start',
      requested_by: 'mobile-chat',
      reason: 'manual restart',
      status: 'pending',
    });
  });

  test('queues a stop command when confirm:true is set', async () => {
    const res = makeRes();
    await handler(makeReq({ body: { worker_type: 'sync', command: 'stop', confirm: true } }), res);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(mockInsertedRows[0]).toMatchObject({ worker_type: 'sync', command: 'stop' });
  });

  test('ignores a client-supplied requested_by — it always comes from the token', async () => {
    const res = makeRes();
    await handler(
      makeReq({ body: { worker_type: 'sync', command: 'start', requested_by: 'attacker' } }),
      res
    );
    expect(mockInsertedRows[0].requested_by).toBe('mobile-chat');
  });
});

describe('agent-manager/control — listing', () => {
  test('GET lists recent commands', async () => {
    mockListRows = [{ id: 'cmd-1', worker_type: 'sync', command: 'start', status: 'completed' }];
    const res = makeRes();
    await handler(makeReq({ method: 'GET', body: undefined }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].commands).toEqual(mockListRows);
  });

  test('GET requires auth too', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'GET', token: null }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('agent-manager/control — method guard', () => {
  test('rejects unsupported methods', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'DELETE' }), res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});
