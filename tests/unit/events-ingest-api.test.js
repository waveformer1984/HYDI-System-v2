'use strict';

/**
 * Contract tests for POST /api/events/ingest — the authenticated sink the
 * ProtoForge Ursula bridge posts to. The security-critical assertions are
 * the fail-closed ones: no token, a forged token, and an expired token
 * must all 401 *before* anything is written to heidi_events.
 */

const { createHmac } = require('crypto');

const SERVICE_SECRET = 'test-service-secret';

function makeServiceToken({ secret = SERVICE_SECRET, service = 'protoforge_ursula', ts = Date.now() } = {}) {
  const requestId = 'req-1';
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

function makeReq(overrides = {}) {
  return {
    method: 'POST',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    body: {},
    ...overrides,
  };
}

let mockInsertedRows = [];
let mockInsertError = null;

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn((table) => {
      if (table === 'auth_audit_log') {
        return { insert: jest.fn(async () => ({ error: null })) };
      }
      if (table === 'heidi_events') {
        return {
          insert: jest.fn((row) => {
            mockInsertedRows.push(row);
            return {
              select: jest.fn(() => ({
                single: jest.fn(async () => (mockInsertError
                  ? { data: null, error: mockInsertError }
                  : { data: { id: 'evt-uuid-1', created_at: '2026-09-19T00:00:00.000Z', ...row }, error: null })),
              })),
            };
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  })),
}));

const rateLimitModule = require('../../lib/rate-limit');
const { bus, reset: resetBus } = require('../../lib/realtime/eventBus');

let handler;

describe('POST /api/events/ingest', () => {
  const OLD_ENV = process.env;

  beforeAll(async () => {
    handler = (await import('../../api/events/ingest.js')).default;
  });

  beforeEach(() => {
    mockInsertedRows = [];
    mockInsertError = null;
    resetBus();
    if (typeof rateLimitModule.__reset === 'function') rateLimitModule.__reset();
    process.env = {
      ...OLD_ENV,
      HYDI_SERVICE_SECRET: SERVICE_SECRET,
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    };
  });

  afterAll(() => {
    process.env = OLD_ENV;
    resetBus();
  });

  it('rejects a request with no service token (401) and writes nothing', async () => {
    const res = makeRes();
    await handler(makeReq({ body: { type: 'ursula.task', service: 'protoforge_ursula' } }), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockInsertedRows).toHaveLength(0);
  });

  it('rejects a forged service token (401) and writes nothing', async () => {
    const res = makeRes();
    const req = makeReq({
      headers: { 'x-hydi-service-token': makeServiceToken({ secret: 'wrong-secret' }) },
      body: { type: 'ursula.task' },
    });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockInsertedRows).toHaveLength(0);
  });

  it('rejects a replayed/expired token outside the 5-minute window (401)', async () => {
    const res = makeRes();
    const staleTs = Date.now() - 6 * 60 * 1000;
    const req = makeReq({
      headers: { 'x-hydi-service-token': makeServiceToken({ ts: staleTs }) },
      body: { type: 'ursula.task' },
    });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockInsertedRows).toHaveLength(0);
  });

  it('never leaks the service secret in an error response', async () => {
    const res = makeRes();
    await handler(makeReq({ body: { type: 'ursula.task' } }), res);

    const serialized = JSON.stringify(res.json.mock.calls);
    expect(serialized).not.toContain(SERVICE_SECRET);
  });

  it('accepts a valid token, persists the event, and returns 200', async () => {
    const res = makeRes();
    const req = makeReq({
      headers: { 'x-hydi-service-token': makeServiceToken() },
      body: { type: 'ursula.task.completed', service: 'protoforge_ursula', payload: { taskId: 'T-1' } },
    });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockInsertedRows).toHaveLength(1);
    expect(mockInsertedRows[0]).toMatchObject({
      event_type: 'ursula.task.completed',
      division: 'protoforge_ursula',
      payload: { taskId: 'T-1' },
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, id: 'evt-uuid-1' }));
  });

  it('republishes the ingested event onto the shared bus for SSE clients', async () => {
    const seen = [];
    bus.on('event', (e) => seen.push(e));

    const res = makeRes();
    await handler(makeReq({
      headers: { 'x-hydi-service-token': makeServiceToken() },
      body: { type: 'ursula.alert', service: 'protoforge_ursula' },
    }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(seen).toEqual([
      expect.objectContaining({ type: 'ingested_event', event_type: 'ursula.alert', division: 'protoforge_ursula' }),
    ]);
  });

  it('rejects a non-POST method with 405', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('answers CORS preflight with 204 without requiring a token', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'OPTIONS' }), res);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(mockInsertedRows).toHaveLength(0);
  });

  it('rejects a body with no event_type (400) even when authenticated', async () => {
    const res = makeRes();
    await handler(makeReq({
      headers: { 'x-hydi-service-token': makeServiceToken() },
      body: { service: 'protoforge_ursula' },
    }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockInsertedRows).toHaveLength(0);
  });

  it('rejects a verdict outside the HEIDI vocabulary (400)', async () => {
    const res = makeRes();
    await handler(makeReq({
      headers: { 'x-hydi-service-token': makeServiceToken() },
      body: { type: 'ursula.task', verdict: 'YOLO' },
    }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockInsertedRows).toHaveLength(0);
  });

  it('surfaces a persistence failure as 500 and does not publish', async () => {
    mockInsertError = { message: 'db unavailable' };
    const seen = [];
    bus.on('event', (e) => seen.push(e));

    const res = makeRes();
    await handler(makeReq({
      headers: { 'x-hydi-service-token': makeServiceToken() },
      body: { type: 'ursula.task' },
    }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(seen).toHaveLength(0);
  });
});
