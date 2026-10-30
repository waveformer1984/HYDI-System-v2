// @vitest-environment node
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isLocalRequest } from './heidi-relay';
import { parseSse, splitToolLines } from './heidi-sse';

const h = (o: Record<string, string>) => new Headers(o);

describe('isLocalRequest (second guard behind the 127.0.0.1 bind)', () => {
  it('allows a browser on this PC', () => {
    expect(isLocalRequest(h({ host: '127.0.0.1:3100' }))).toBe(true);
    expect(isLocalRequest(h({ host: 'localhost:3100' }))).toBe(true);
    expect(isLocalRequest(h({ host: '[::1]:3100' }))).toBe(true);
    expect(isLocalRequest(h({ host: 'localhost:3100', 'x-forwarded-for': '127.0.0.1' }))).toBe(true);
  });
  it('refuses the LAN, the tailnet and anything proxied', () => {
    expect(isLocalRequest(h({ host: '192.168.86.178:3100' }))).toBe(false);
    expect(isLocalRequest(h({ host: 'heidi-pc.tailc50af2.ts.net' }))).toBe(false);
    expect(isLocalRequest(h({ host: 'localhost:3100', 'x-forwarded-for': '100.64.0.9' }))).toBe(false);
    expect(isLocalRequest(h({ host: 'localhost:3100', 'x-forwarded-for': '127.0.0.1, 100.64.0.9' }))).toBe(false);
    expect(isLocalRequest(h({ host: 'localhost:3100', 'tailscale-user-login': 'jordan@example.com' }))).toBe(false);
    expect(isLocalRequest(h({ host: 'localhost:3100', 'x-forwarded-host': 'evil.example' }))).toBe(false);
    expect(isLocalRequest(h({ host: 'localhost:3100', forwarded: 'for=1.2.3.4' }))).toBe(false);
    expect(isLocalRequest(h({}))).toBe(false);
  });
});

describe('relay routes against a fake heidi-core', () => {
  let server: http.Server;
  const seen: Array<{ url: string; body: string; secret: string | undefined }> = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        seen.push({ url: req.url || '', body, secret: req.headers['x-heidi-secret'] as string | undefined });
        if (req.url === '/chat-tools') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write('data: {"t":"⚙️ list_missions…\\n"}\n\n');
          res.write('data: {"t":"All clear."}\n\n');
          res.end('data: {"done":true,"conversation_id":"c-123"}\n\n');
        } else if (req.url?.startsWith('/conversations/c-123/messages')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ messages: [{ id: 1, role: 'user', content: 'hi' }] }));
        } else if (req.url === '/health') {
          res.writeHead(200); res.end('{}');
        } else { res.writeHead(404); res.end('{}'); }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    process.env.HEIDI_CORE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.HEIDI_SECRET = 'shared-test-value';
  });
  afterAll(() => { server.close(); delete process.env.HEIDI_CORE_URL; delete process.env.HEIDI_SECRET; });

  const local = { host: '127.0.0.1:3100', 'content-type': 'application/json' };

  it('streams /chat-tools through, with the ids and the shared secret', async () => {
    const { POST } = await import('@/app/api/heidi/chat/route');
    const res = await POST(new Request('http://127.0.0.1:3100/api/heidi/chat', { method: 'POST', headers: local, body: JSON.stringify({ message: ' tasks ', conversation_id: 'c-123', request_id: 'r-1' }) }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const { events } = parseSse(await res.text() + '\n\n');
    expect(events.map((e) => e.t ?? (e.done ? 'DONE' : ''))).toEqual(['⚙️ list_missions…\n', 'All clear.', 'DONE']);
    const call = seen.find((s) => s.url === '/chat-tools');
    expect(JSON.parse(call!.body)).toEqual({ input: 'tasks', conversation_id: 'c-123', request_id: 'r-1' });
    expect(call!.secret).toBe('shared-test-value');
  });

  it('refuses non-local callers before touching heidi-core, and validates input', async () => {
    const { POST } = await import('@/app/api/heidi/chat/route');
    const before = seen.length;
    const remote = await POST(new Request('http://x/api/heidi/chat', { method: 'POST', headers: { host: '192.168.86.178:3100' }, body: '{"message":"hi"}' }));
    expect(remote.status).toBe(403);
    expect((await remote.json()).error).toBe('local_only');
    expect(seen.length).toBe(before);
    expect((await POST(new Request('http://x', { method: 'POST', headers: local, body: '{"message":"  "}' }))).status).toBe(400);
    expect((await POST(new Request('http://x', { method: 'POST', headers: local, body: 'not json' }))).status).toBe(400);
    expect((await POST(new Request('http://x', { method: 'POST', headers: local, body: JSON.stringify({ message: 'x'.repeat(8001) }) }))).status).toBe(413);
  });

  it('relays history and health, and rejects odd conversation ids', async () => {
    const { GET } = await import('@/app/api/heidi/conversations/[id]/messages/route');
    const ok = await GET(new Request('http://x', { headers: local }), { params: Promise.resolve({ id: 'c-123' }) });
    expect((await ok.json()).messages[0].content).toBe('hi');
    const bad = await GET(new Request('http://x', { headers: local }), { params: Promise.resolve({ id: '../../system/status' }) });
    expect(bad.status).toBe(400);
    const health = await import('@/app/api/heidi/health/route');
    expect(await (await health.GET(new Request('http://x', { headers: local }))).json()).toEqual({ ok: true, status: 200 });
  });

  it('reports heidi-core down as 503, not a crash', async () => {
    const saved = process.env.HEIDI_CORE_URL;
    process.env.HEIDI_CORE_URL = 'http://127.0.0.1:9';
    try {
      const { POST } = await import('@/app/api/heidi/chat/route');
      const res = await POST(new Request('http://x', { method: 'POST', headers: local, body: '{"message":"hi"}' }));
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe('heidi_core_unreachable');
    } finally {
      process.env.HEIDI_CORE_URL = saved;
    }
  });
});

describe('heidi-sse', () => {
  it('keeps a split event for the next chunk and skips bad JSON', () => {
    const a = parseSse('data: {"t":"he');
    expect(a.events).toEqual([]);
    const b = parseSse(a.rest + 'llo"}\n\ndata: {oops}\n\ndata: {"done":true}\n\n');
    expect(b.events).toEqual([{ t: 'hello' }, { done: true }]);
    expect(b.rest).toBe('');
  });
  it('separates tool progress from the answer', () => {
    expect(splitToolLines('⚙️ run_command…\n⚙️ list_missions…\nDone: 2 tasks.')).toEqual({ tools: ['run_command', 'list_missions'], answer: 'Done: 2 tasks.' });
  });
});
