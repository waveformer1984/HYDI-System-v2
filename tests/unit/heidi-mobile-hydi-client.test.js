'use strict';

const { createHydiClient, resolveBaseUrl } = require('../../lib/heidi-mobile/hydiClient');
const { verifyDeviceTokenSignature } = require('../../lib/auth/deviceAuth');

const KEY = 'f'.repeat(64);

function jsonResponse(status, body) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('lib/heidi-mobile/hydiClient', () => {
  const savedUrl = process.env.HYDI_API_URL;
  afterEach(() => {
    if (savedUrl === undefined) delete process.env.HYDI_API_URL; else process.env.HYDI_API_URL = savedUrl;
  });

  it('signs each request with a valid per-device HMAC token', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, { ok: true }));
    const client = createHydiClient({ deviceId: 'phone-1', signingKey: KEY, baseUrl: 'http://hydi.test', fetchImpl });
    const r = await client.request('/api/status/system');
    expect(r.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://hydi.test/api/status/system');
    const token = init.headers['x-hydi-device-token'];
    expect(verifyDeviceTokenSignature(token, KEY)).toMatchObject({ valid: true, deviceId: 'phone-1' });
    expect(init.headers['x-hydi-service-token']).toBeUndefined();
  });

  it('sends no credential header when it has no device session', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(201, { ok: true }));
    const client = createHydiClient({ baseUrl: 'http://hydi.test', fetchImpl });
    await client.request('/api/devices', { method: 'POST', body: { action: 'register' } });
    const init = fetchImpl.mock.calls[0][1];
    expect(init.headers['x-hydi-device-token']).toBeUndefined();
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ action: 'register' });
  });

  it.each([
    [401, 'unauthorized'], [403, 'forbidden'], [404, 'not_found'], [429, 'rate_limited'], [400, 'client'], [500, 'server'], [503, 'server'],
  ])('classifies HTTP %i as %s and surfaces the upstream reason', async (status, kind) => {
    const fetchImpl = jest.fn(async () => jsonResponse(status, { error: 'Nope', reason: 'device not approved' }));
    const client = createHydiClient({ deviceId: 'd', signingKey: KEY, baseUrl: 'http://hydi.test', fetchImpl });
    const r = await client.request('/x');
    expect(r).toMatchObject({ ok: false, kind, status, message: 'Nope', reason: 'device not approved' });
  });

  it('reports malformed (non-JSON) success bodies instead of passing them through', async () => {
    const fetchImpl = jest.fn(async () => new Response('<html>proxy error</html>', { status: 200 }));
    const client = createHydiClient({ baseUrl: 'http://hydi.test', fetchImpl });
    expect(await client.request('/x')).toMatchObject({ ok: false, kind: 'malformed' });
  });

  it('reports network failures as network', async () => {
    const fetchImpl = jest.fn(async () => { throw new TypeError('fetch failed: ECONNREFUSED'); });
    const client = createHydiClient({ baseUrl: 'http://hydi.test', fetchImpl });
    const r = await client.request('/x');
    expect(r).toMatchObject({ ok: false, kind: 'network', message: 'HYDI is unreachable' });
    expect(r.message).not.toContain('ECONNREFUSED');
  });

  it('times out a hung upstream', async () => {
    const fetchImpl = jest.fn((url, init) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const client = createHydiClient({ baseUrl: 'http://hydi.test', fetchImpl });
    const r = await client.request('/x', { timeoutMs: 30 });
    expect(r).toMatchObject({ ok: false, kind: 'timeout' });
  });

  it('distinguishes caller cancellation from a timeout', async () => {
    const fetchImpl = jest.fn((url, init) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const client = createHydiClient({ baseUrl: 'http://hydi.test', fetchImpl });
    const ac = new AbortController();
    const p = client.request('/x', { signal: ac.signal, timeoutMs: 5000 });
    ac.abort();
    expect(await p).toMatchObject({ ok: false, kind: 'aborted' });
  });

  it('refuses a non-http(s) HYDI_API_URL', async () => {
    process.env.HYDI_API_URL = 'file:///etc/passwd';
    expect(resolveBaseUrl()).toBeNull();
    const client = createHydiClient({ fetchImpl: jest.fn() });
    expect(await client.request('/x')).toMatchObject({ ok: false, kind: 'unconfigured' });
  });

  it('defaults to the local HYDI web layer and strips trailing slashes', () => {
    delete process.env.HYDI_API_URL;
    expect(resolveBaseUrl()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    process.env.HYDI_API_URL = 'https://heidi-pc.example.ts.net/';
    expect(resolveBaseUrl()).toBe('https://heidi-pc.example.ts.net');
  });
});
