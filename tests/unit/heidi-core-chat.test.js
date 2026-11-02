'use strict';

const { streamChat, fetchHistory } = require('../../lib/heidi-core-chat');

function sseBody(events) {
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  let sent = false;
  return {
    getReader() {
      return {
        read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: bytes })),
        cancel: async () => {},
      };
    },
  };
}

function fakeFetch(routes) {
  const calls = [];
  const impl = jest.fn(async (url, opts) => {
    calls.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null });
    const path = new URL(url).pathname;
    const route = routes[path];
    if (!route) throw new Error(`connect ECONNREFUSED ${path}`);
    return route(opts);
  });
  return { impl, calls };
}

describe('dashboard chat → heidi-core', () => {
  it('streams the reply and returns the conversation id heidi-core assigned', async () => {
    const { impl, calls } = fakeFetch({
      '/chat-tools': () => ({ ok: true, status: 200, body: sseBody([
        { t: 'Hi ' }, { t: 'Jordan' },
        { done: true, model: 'qwen2.5:3b', conversation_id: 'c-1', persistence: { saved: true }, tools_used: [] },
      ]) }),
    });
    const out = [];
    const r = await streamChat({ message: 'hello', onText: (t) => out.push(t), fetchImpl: impl, baseUrl: 'http://core' });
    expect(r).toMatchObject({ ok: true, conversationId: 'c-1', model: 'qwen2.5:3b' });
    expect(out.join('')).toBe('Hi Jordan');
    expect(calls[0].body).toEqual({ input: 'hello' });
  });

  it('sends the stored conversation id so heidi-core continues the same thread', async () => {
    const { impl, calls } = fakeFetch({
      '/chat-tools': () => ({ ok: true, status: 200, body: sseBody([{ t: 'ok' }, { done: true, model: 'm', conversation_id: 'c-9' }]) }),
    });
    await streamChat({ message: 'and now?', conversationId: 'c-9', onText: () => {}, fetchImpl: impl, baseUrl: 'http://core' });
    expect(calls[0].body).toMatchObject({ input: 'and now?', conversation_id: 'c-9' });
  });

  it('reports an unknown conversation without sending any text', async () => {
    const { impl } = fakeFetch({
      '/chat-tools': () => ({ ok: true, status: 200, body: sseBody([{ error: 'conversation not found', conversation_not_found: true, done: true }]) }),
    });
    const out = [];
    const r = await streamChat({ message: 'hi', conversationId: 'gone', onText: (t) => out.push(t), fetchImpl: impl, baseUrl: 'http://core' });
    expect(r).toEqual({ ok: false, conversationNotFound: true });
    expect(out).toEqual([]);
  });

  it("never forwards heidi-core's canned fallback reply", async () => {
    const { impl } = fakeFetch({
      '/chat-tools': () => ({ ok: true, status: 200, body: sseBody([{ t: 'I cannot think right now' }, { done: true, model: 'fallback' }]) }),
      '/think-stream': () => ({ ok: true, status: 200, body: sseBody([{ t: 'still nothing' }, { done: true, model: 'fallback' }]) }),
    });
    const out = [];
    const r = await streamChat({ message: 'hi', onText: (t) => out.push(t), fetchImpl: impl, baseUrl: 'http://core' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/fallback/);
    expect(out).toEqual([]);
  });

  it('falls back to /think-stream when /chat-tools is missing', async () => {
    const { impl } = fakeFetch({
      '/chat-tools': () => ({ ok: false, status: 404, body: null }),
      '/think-stream': () => ({ ok: true, status: 200, body: sseBody([{ t: 'from think' }, { done: true, model: 'm', conversation_id: 'c-2' }]) }),
    });
    const out = [];
    const r = await streamChat({ message: 'hi', onText: (t) => out.push(t), fetchImpl: impl, baseUrl: 'http://core' });
    expect(r).toMatchObject({ ok: true, conversationId: 'c-2' });
    expect(out.join('')).toBe('from think');
  });

  it('never throws when heidi-core is down', async () => {
    const { impl } = fakeFetch({});
    const r = await streamChat({ message: 'hi', onText: () => {}, fetchImpl: impl, baseUrl: 'http://core' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/ECONNREFUSED/);
  });

  it('a stream that ends without a done event sends nothing', async () => {
    const { impl } = fakeFetch({
      '/chat-tools': () => ({ ok: true, status: 200, body: sseBody([{ t: 'half a rep' }]) }),
      '/think-stream': () => ({ ok: true, status: 200, body: sseBody([{ t: 'also half' }]) }),
    });
    const out = [];
    const r = await streamChat({ message: 'hi', onText: (t) => out.push(t), fetchImpl: impl, baseUrl: 'http://core' });
    expect(r.ok).toBe(false);
    expect(out).toEqual([]);
  });

  it('fetchHistory returns user/assistant turns oldest first, null for an unknown conversation', async () => {
    const impl = jest.fn(async (url) => {
      if (url.includes('/conversations/missing/')) return { ok: false, status: 404 };
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [
          { id: 1, role: 'user', content: 'remember teal', created_at: '2026-11-02T13:00:00Z' },
          { id: 2, role: 'system', content: 'internal' },
          { id: 3, role: 'assistant', content: 'noted', created_at: '2026-11-02T13:00:02Z' },
        ] }),
      };
    });
    const msgs = await fetchHistory({ conversationId: 'c-1', limit: 999, fetchImpl: impl, baseUrl: 'http://core' });
    expect(msgs).toEqual([
      { role: 'user', content: 'remember teal', created_at: '2026-11-02T13:00:00Z' },
      { role: 'assistant', content: 'noted', created_at: '2026-11-02T13:00:02Z' },
    ]);
    expect(impl.mock.calls[0][0]).toBe('http://core/conversations/c-1/messages?limit=200');
    await expect(fetchHistory({ conversationId: 'missing', fetchImpl: impl, baseUrl: 'http://core' })).resolves.toBeNull();
  });
});

describe('GET /api/heidi-core/history access', () => {
  const ORIGINAL = process.env.HYDI_SERVICE_SECRET;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.HYDI_SERVICE_SECRET; else process.env.HYDI_SERVICE_SECRET = ORIGINAL;
    jest.resetModules();
  });

  function load(fetchHistoryImpl) {
    jest.resetModules();
    jest.doMock('../../lib/heidi-core-chat', () => ({ fetchHistory: fetchHistoryImpl }));
    return require('../../pages/api/heidi-core/history').default;
  }

  function call(handler, { remote = '127.0.0.1', headers = {}, query = { conversation_id: 'c-1' } } = {}) {
    const res = {
      statusCode: 0, body: null, headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
    };
    return Promise.resolve(handler({ method: 'GET', socket: { remoteAddress: remote }, headers, query }, res)).then(() => res);
  }

  it('answers a direct request from this PC', async () => {
    const handler = load(async () => [{ role: 'user', content: 'hi', created_at: null }]);
    const res = await call(handler);
    expect(res.statusCode).toBe(200);
    expect(res.body.messages).toHaveLength(1);
  });

  it('refuses a LAN or tailnet request without the service token', async () => {
    const fh = jest.fn();
    const handler = load(fh);
    expect((await call(handler, { remote: '100.101.102.103' })).statusCode).toBe(401);
    // loopback that came through a proxy (e.g. tailscale serve) is not local
    expect((await call(handler, { headers: { 'x-forwarded-for': '100.1.2.3' } })).statusCode).toBe(401);
    expect(fh).not.toHaveBeenCalled();
  });

  it('accepts a valid service token from off the PC', async () => {
    process.env.HYDI_SERVICE_SECRET = 'test-secret-value';
    const { createHmac } = require('crypto');
    const ts = String(Date.now());
    const sig = createHmac('sha256', 'test-secret-value').update(`${ts}:r1:dashboard`).digest('hex');
    const handler = load(async () => []);
    const res = await call(handler, { remote: '100.101.102.103', headers: { 'x-hydi-service-token': `${ts}.r1.dashboard.${sig}` } });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a malformed conversation id and maps unknown to 404', async () => {
    const handler = load(async () => null);
    expect((await call(handler, { query: { conversation_id: '../etc' } })).statusCode).toBe(400);
    expect((await call(handler)).statusCode).toBe(404);
  });
});
