'use strict';

const { createHmac } = require('crypto');

const SERVICE_SECRET = 'test-service-secret';

function makeServiceToken(secret = SERVICE_SECRET) {
  const ts = Date.now().toString();
  const requestId = 'req-1';
  const service = 'jest';
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

const commandRows = [];

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn((table) => {
      if (table === 'auth_audit_log') {
        return { insert: jest.fn(async () => ({ error: null })) };
      }
      if (table === 'agent_control_commands') {
        return {
          select: jest.fn(() => ({
            order: jest.fn(() => ({
              limit: jest.fn(async () => ({ data: commandRows, error: null })),
            })),
          })),
          insert: jest.fn((row) => ({
            select: jest.fn(() => ({
              single: jest.fn(async () => {
                const inserted = { id: 'cmd-1', status: 'pending', created_at: new Date().toISOString(), ...row };
                commandRows.unshift(inserted);
                return { data: inserted, error: null };
              }),
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
  handler = require('../../api/agent-manager/control.js').default;
});

beforeEach(() => {
  commandRows.length = 0;
  require('../../lib/rate-limit').__reset();
});

describe('api/agent-manager/control.js', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('queues a valid start command as owner (service token) and returns 202', async () => {
    const res = makeRes();
    await handler({
      method: 'POST',
      headers: { 'x-hydi-service-token': makeServiceToken() },
      body: { worker_type: 'decision_assist', command: 'start' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(202);
    const payload = res.json.mock.calls[0][0];
    expect(payload.command.command).toBe('start');
    expect(payload.command.status).toBe('pending');
    expect(payload.command.requested_role).toBe('owner');
  });

  it('rejects an invalid command value with 400', async () => {
    const res = makeRes();
    await handler({
      method: 'POST',
      headers: { 'x-hydi-service-token': makeServiceToken() },
      body: { worker_type: 'decision_assist', command: 'delete_everything' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects a request missing worker_type with 400', async () => {
    const res = makeRes();
    await handler({
      method: 'POST',
      headers: { 'x-hydi-service-token': makeServiceToken() },
      body: { command: 'start' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('lists recent commands on GET with a valid token', async () => {
    commandRows.push({ id: 'cmd-old', worker_type: 'sync', command: 'restart', status: 'completed' });
    const res = makeRes();
    await handler({ method: 'GET', headers: { 'x-hydi-service-token': makeServiceToken() } }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].commands).toHaveLength(1);
  });

  it('returns 405 for unsupported methods', async () => {
    const res = makeRes();
    await handler({ method: 'DELETE', headers: { 'x-hydi-service-token': makeServiceToken() } }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});
