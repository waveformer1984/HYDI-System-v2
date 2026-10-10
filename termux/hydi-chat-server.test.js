// Thin-client (HYDI_UPSTREAM) routing tests for hydi-chat-server.js.
// Run: node --test termux/hydi-chat-server.test.js   (no network, no Supabase)
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.HYDI_SERVICE_SECRET;
delete process.env.HYDI_UPSTREAM;

const { createHandler, normalizeUpstream } = require('./hydi-chat-server.js');

const UP = 'https://heidi-pc.example.ts.net';
let calls;
let replies;

function fakeFetch(url, opts = {}) {
  calls.push({ url, headers: opts.headers || {} });
  const reply = replies[new URL(url).pathname];
  if (reply instanceof Error) return Promise.reject(reply);
  const { status = 200, body = {} } = reply || { status: 404, body: { error: 'nope' } };
  return Promise.resolve({ status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
}

let srv;
let base;
let mode = 'upstream';
before(async () => {
  const handlers = {
    upstream: createHandler({ upstream: UP, fetchImpl: fakeFetch }),
    direct: createHandler({ upstream: '', fetchImpl: fakeFetch }),
  };
  srv = http.createServer((req, res) => handlers[mode](req, res));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => new Promise((r) => srv.close(r)));

function reset(m = 'upstream') { mode = m; calls = []; replies = {}; }

test('health is relayed to the PC and tagged', async () => {
  reset();
  replies['/api/health'] = { body: { status: 'healthy', hydi_status: 'OK' } };
  const r = await fetch(`${base}/api/health`);
  const b = await r.json();
  assert.equal(r.status, 200);
  assert.equal(b.status, 'healthy');
  assert.equal(b.via, 'upstream');
  assert.equal(calls[0].url, `${UP}/api/health`);
});

test('no incoming credentials are forwarded upstream', async () => {
  reset();
  replies['/api/mobile-status'] = { body: { ok: true } };
  await fetch(`${base}/api/mobile-status`, {
    headers: { 'x-hydi-service-token': 'secret-ish', authorization: 'Bearer x', cookie: 'a=b' },
  });
  const sent = Object.keys(calls[0].headers).map((k) => k.toLowerCase());
  assert.deepEqual(sent, ['accept']);
});

test('401 upstream is passed through with a pointer to the paired app', async () => {
  reset();
  replies['/api/mobile-status'] = { status: 401, body: { error: 'Unauthorized' } };
  const r = await fetch(`${base}/api/mobile-status`);
  const b = await r.json();
  assert.equal(r.status, 401);
  assert.match(b.hint, /heidi-pc\.example\.ts\.net\/heidi/);
});

test('unreachable PC gives 502 with a Tailscale hint', async () => {
  reset();
  replies['/api/health'] = new TypeError('fetch failed');
  const r = await fetch(`${base}/api/health`);
  const b = await r.json();
  assert.equal(r.status, 502);
  assert.match(b.hint, /Tailscale/);
});

test('non-JSON and non-object upstream bodies are wrapped, not crashed on', async () => {
  reset();
  replies['/api/health'] = { status: 503, body: '<html>bad gateway</html>' };
  let r = await fetch(`${base}/api/health`);
  assert.equal(r.status, 503);
  assert.match((await r.json()).raw, /bad gateway/);
  replies['/api/health'] = { body: [1, 2] };
  r = await fetch(`${base}/api/health`);
  assert.deepEqual((await r.json()).data, [1, 2]);
});

test('relay is GET-only', async () => {
  reset();
  const r = await fetch(`${base}/api/health`, { method: 'POST' });
  assert.equal(r.status, 405);
  assert.equal(calls.length, 0);
});

test('chat without Supabase in thin-client mode points to the paired app', async () => {
  reset();
  const r = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'status', system: 'ursula' }),
  });
  const b = await r.json();
  assert.equal(r.status, 200);
  assert.match(b.response, /\/heidi/);
  assert.equal(calls.length, 0);
});

test('without HYDI_UPSTREAM the existing offline mode is unchanged', async () => {
  reset('direct');
  const r = await fetch(`${base}/api/health`);
  const b = await r.json();
  assert.equal(b.status, 'offline-mode');
  assert.equal(calls.length, 0);
});

test('normalizeUpstream accepts only http(s) URLs and trims slashes', () => {
  assert.equal(normalizeUpstream('https://a.ts.net/'), 'https://a.ts.net');
  assert.equal(normalizeUpstream('  https://a.ts.net//  '), 'https://a.ts.net');
  assert.equal(normalizeUpstream('ftp://a'), '');
  assert.equal(normalizeUpstream('heidi-pc'), '');
  assert.equal(normalizeUpstream(''), '');
});
