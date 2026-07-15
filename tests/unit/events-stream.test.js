'use strict';

const { createHmac } = require('crypto');
const { EventEmitter } = require('events');

const SERVICE_SECRET = 'test-service-secret';

function makeServiceToken(secret = SERVICE_SECRET) {
  const ts = Date.now().toString();
  const sig = createHmac('sha256', secret).update(`${ts}:req-1:jest`).digest('hex');
  return `${ts}.req-1.jest.${sig}`;
}

function makeRes() {
  const res = new EventEmitter();
  res.writeHead = jest.fn();
  res.write = jest.fn();
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.setHeader = jest.fn(() => res);
  res.end = jest.fn(() => res);
  return res;
}

function makeReq(headers = {}, query = {}) {
  const req = new EventEmitter();
  req.headers = headers;
  req.query = query;
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn((table) => {
      if (table === 'auth_audit_log') return { insert: jest.fn(async () => ({ error: null })) };
      if (table === 'hydi_subsystem_status') return { select: jest.fn(async () => ({ data: [], error: null })) };
      throw new Error(`unexpected table ${table}`);
    }),
  })),
}));

let handler;
let bus;

beforeAll(() => {
  process.env.HYDI_SERVICE_SECRET = SERVICE_SECRET;
  process.env.SUPABASE_URL = 'http://localhost';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  handler = require('../../api/events/stream.js').default;
  bus = require('../../lib/realtime/eventBus.js').bus;
});

beforeEach(() => {
  require('../../lib/rate-limit').__reset();
});

describe('api/events/stream.js', () => {
  it('rejects an unauthenticated connection attempt with 401, never writing SSE headers', async () => {
    const req = makeReq({});
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.writeHead).not.toHaveBeenCalled();
  });

  it('accepts a token passed via query string (EventSource cannot set headers)', async () => {
    const req = makeReq({}, { token: makeServiceToken() });
    const res = makeRes();
    await handler(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'text/event-stream' }));
    req.emit('close');
  });

  it('sends an initial connected event with the resolved role', async () => {
    const req = makeReq({ 'x-hydi-service-token': makeServiceToken() });
    const res = makeRes();
    await handler(req, res);

    const firstWrite = res.write.mock.calls.map((c) => c[0]).join('');
    expect(firstWrite).toContain('event: connected');
    expect(firstWrite).toContain('"role":"owner"');
    req.emit('close');
  });

  it('forwards subsequent bus events to the connected client', async () => {
    const req = makeReq({ 'x-hydi-service-token': makeServiceToken() });
    const res = makeRes();
    await handler(req, res);
    res.write.mockClear();

    bus.emit('event', { type: 'subsystem_status', subsystem: 'hydi_core', status: 'healthy', timestamp: new Date().toISOString() });

    const written = res.write.mock.calls.map((c) => c[0]).join('');
    expect(written).toContain('event: subsystem_status');
    expect(written).toContain('"subsystem":"hydi_core"');
    req.emit('close');
  });

  it('unsubscribes from the bus on client disconnect', async () => {
    const req = makeReq({ 'x-hydi-service-token': makeServiceToken() });
    const res = makeRes();
    await handler(req, res);

    const listenersBefore = bus.listenerCount('event');
    req.emit('close');
    expect(bus.listenerCount('event')).toBe(listenersBefore - 1);
  });
});
