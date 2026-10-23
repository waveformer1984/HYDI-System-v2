'use strict';

const { createPhonePairHandler, resetRateLimit, allowedNetwork } = require('../../lib/phone/pair-route');

const HUMAN = 'human-token-for-tests';
const READ = 'phone-read-secret-for-tests';

describe('GET /api/phone/pair', () => {
  function res() {
    const r = { code: 0, body: null, headers: {} };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
    return r;
  }
  function req(over = {}) {
    return {
      method: 'GET',
      headers: { authorization: `Bearer ${HUMAN}` },
      socket: { remoteAddress: '100.100.64.7' },
      ...over,
    };
  }
  const env = { HYDI_BOARD_HUMAN_TOKEN: HUMAN, HYDI_PHONE_READ_TOKEN: READ };
  beforeEach(() => resetRateLimit());

  it('returns the phone read token to an authed in-network peer and sets no-store', async () => {
    const r = res();
    await createPhonePairHandler({ env, now: () => 0 })(req(), r);
    expect(r.code).toBe(200);
    expect(r.body).toEqual({ token: READ });
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('rejects missing, wrong, and malformed bearer with 401 and never echoes a token', async () => {
    const handler = createPhonePairHandler({ env, now: () => 0 });
    for (const authorization of [undefined, 'Bearer nope', HUMAN, 'Bearer  ']) {
      const r = res();
      await handler(req({ headers: { authorization } }), r);
      expect(r.code).toBe(401);
      expect(JSON.stringify(r.body)).not.toContain(READ);
    }
  });

  it('is 503 when either token env is unset', async () => {
    for (const e of [{}, { HYDI_BOARD_HUMAN_TOKEN: HUMAN }, { HYDI_PHONE_READ_TOKEN: READ }]) {
      const r = res();
      await createPhonePairHandler({ env: e, now: () => 0 })(req(), r);
      expect(r.code).toBe(503);
      expect(JSON.stringify(r.body)).not.toContain(READ);
    }
  });

  it.each([
    ['127.0.0.1', true],
    ['::1', true],
    ['::ffff:127.0.0.1', true],
    ['192.168.1.50', true],
    ['192.168.255.254', true],
    ['100.64.0.1', true],
    ['100.127.255.255', true],
    ['100.63.255.255', false],
    ['100.128.0.1', false],
    ['101.64.0.1', false],
    ['192.167.0.1', false],
    ['10.0.0.5', false],
    ['8.8.8.8', false],
    ['', false],
    [undefined, false],
  ])('allowedNetwork(%s) === %s', (addr, expected) => {
    expect(allowedNetwork(addr)).toBe(expected);
  });

  it('rejects out-of-network peers with 403 before auth', async () => {
    const r = res();
    await createPhonePairHandler({ env, now: () => 0 })(req({ socket: { remoteAddress: '8.8.8.8' } }), r);
    expect(r.code).toBe(403);
  });

  it('fails closed on any forwarded-hop header', async () => {
    for (const extra of [{ 'x-forwarded-for': '192.168.1.2' }, { 'x-real-ip': '100.64.0.2' }, { forwarded: 'for=127.0.0.1' }]) {
      const r = res();
      await createPhonePairHandler({ env, now: () => 0 })(req({ headers: { authorization: `Bearer ${HUMAN}`, ...extra } }), r);
      expect(r.code).toBe(403);
    }
  });

  it('rate-limits after 10 requests in a minute', async () => {
    let t = 0;
    const handler = createPhonePairHandler({ env, now: () => t });
    for (let i = 0; i < 10; i += 1) {
      const r = res();
      await handler(req(), r);
      expect(r.code).toBe(200);
    }
    const r = res();
    await handler(req(), r);
    expect(r.code).toBe(429);
    t = 61_000;
    const r2 = res();
    await handler(req(), r2);
    expect(r2.code).toBe(200);
  });

  it('rejects non-GET methods', async () => {
    const r = res();
    await createPhonePairHandler({ env, now: () => 0 })(req({ method: 'POST' }), r);
    expect(r.code).toBe(405);
    expect(r.headers.allow).toBe('GET');
  });

  it('never logs the token value on accept or refuse paths', async () => {
    const lines = [];
    const log = (line) => lines.push(line);
    let t = 0;
    const handler = createPhonePairHandler({ env, now: () => t, log });
    const ok = res();
    await handler(req(), ok);
    expect(ok.code).toBe(200);
    t = 62_000;
    const bad = res();
    await handler(req({ headers: { authorization: 'Bearer wrong' } }), bad);
    const refused = res();
    await handler(req({ socket: { remoteAddress: '8.8.8.8' } }), refused);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain(READ);
      expect(line).not.toContain(HUMAN);
    }
    expect(lines.some((l) => l.includes('peer=100.100.64.7'))).toBe(true);
  });
});
