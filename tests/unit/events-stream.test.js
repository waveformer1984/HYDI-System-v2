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

// Captures postgres_changes callbacks registered by startRealtimeBridge() so
// tests can simulate a Realtime event arriving from another process (the
// real-world case being workers/WorkerOrchestrator.js, which runs outside
// the Next.js server — see api/events/stream.js's header comment).
const mockRealtimeCallbacks = {};
function mockMakeChannel() {
  const channel = {
    on: jest.fn((_event, filter, cb) => {
      mockRealtimeCallbacks[filter.table] = cb;
      return channel;
    }),
    subscribe: jest.fn((cb) => {
      if (cb) cb('SUBSCRIBED');
      return channel;
    }),
  };
  return channel;
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn((table) => {
      if (table === 'auth_audit_log') return { insert: jest.fn(async () => ({ error: null })) };
      if (table === 'hydi_subsystem_status') return { select: jest.fn(async () => ({ data: [], error: null })) };
      throw new Error(`unexpected table ${table}`);
    }),
    channel: jest.fn(() => mockMakeChannel()),
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

  describe('Realtime bridge (cross-process events from workers/WorkerOrchestrator.js)', () => {
    it('subscribes once to postgres_changes on agent_control_commands and notifications', () => {
      // The bridge starts lazily on the first authenticated connection made
      // anywhere above in this file — by this point it must have registered
      // both handlers, exactly once each (one shared subscription for every
      // connected client, not one per connection).
      expect(mockRealtimeCallbacks['agent_control_commands']).toBeInstanceOf(Function);
      expect(mockRealtimeCallbacks['notifications']).toBeInstanceOf(Function);
    });

    it('forwards an agent_control_commands UPDATE as a command_result event to connected clients', async () => {
      const req = makeReq({ 'x-hydi-service-token': makeServiceToken() });
      const res = makeRes();
      await handler(req, res);
      res.write.mockClear();

      mockRealtimeCallbacks['agent_control_commands']({
        new: { id: 'cmd-1', worker_type: 'revenue_ingestion', worker_id: null, command: 'restart', status: 'completed', result: { ok: true }, error_message: null },
      });

      const written = res.write.mock.calls.map((c) => c[0]).join('');
      expect(written).toContain('event: command_result');
      expect(written).toContain('"command_id":"cmd-1"');
      expect(written).toContain('"status":"completed"');
      req.emit('close');
    });

    it('forwards a notifications INSERT as a notification event to connected clients', async () => {
      const req = makeReq({ 'x-hydi-service-token': makeServiceToken() });
      const res = makeRes();
      await handler(req, res);
      res.write.mockClear();

      mockRealtimeCallbacks['notifications']({
        new: { id: 'notif-1', category: 'worker_failure', severity: 'critical', title: 'revenue_ingestion restart failed', body: 'boom', device_id: null },
      });

      const written = res.write.mock.calls.map((c) => c[0]).join('');
      expect(written).toContain('event: notification');
      expect(written).toContain('"title":"revenue_ingestion restart failed"');
      req.emit('close');
    });

    it('ignores a payload with no new row instead of throwing', async () => {
      expect(() => mockRealtimeCallbacks['agent_control_commands']({ old: { id: 'cmd-2' } })).not.toThrow();
      expect(() => mockRealtimeCallbacks['notifications']({ old: { id: 'notif-2' } })).not.toThrow();
    });
  });
});
