'use strict';

const {
  sealSession, unsealSession, parseCookies, setSessionCookie, clearSessionCookie, readSession, COOKIE_NAME,
} = require('../../lib/heidi-mobile/session');

const SECRET = 'a'.repeat(64);
const SESSION = { deviceId: 'phone-1', signingKey: 'k'.repeat(64), pending: false };

function makeRes() {
  const headers = {};
  return { headers, setHeader: jest.fn((k, v) => { headers[k.toLowerCase()] = v; }) };
}

describe('lib/heidi-mobile/session', () => {
  const saved = { secret: process.env.HYDI_SERVICE_SECRET, env: process.env.NODE_ENV };
  beforeEach(() => { process.env.HYDI_SERVICE_SECRET = SECRET; process.env.NODE_ENV = 'test'; });
  afterAll(() => {
    if (saved.secret === undefined) delete process.env.HYDI_SERVICE_SECRET; else process.env.HYDI_SERVICE_SECRET = saved.secret;
    process.env.NODE_ENV = saved.env;
  });

  it('round-trips a sealed session', () => {
    const token = sealSession(SESSION);
    const out = unsealSession(token);
    expect(out).toMatchObject({ deviceId: 'phone-1', signingKey: SESSION.signingKey, pending: false });
    expect(out.expiresAt).toBeGreaterThan(Date.now());
  });

  it('never contains the signing key or device id in readable form', () => {
    const token = sealSession(SESSION);
    const decoded = Buffer.from(token, 'base64url').toString('latin1');
    expect(decoded).not.toContain(SESSION.signingKey);
    expect(decoded).not.toContain('phone-1');
    expect(token).not.toContain(SECRET);
  });

  it('rejects a tampered token', () => {
    const token = sealSession(SESSION);
    const raw = Buffer.from(token, 'base64url');
    raw[raw.length - 1] ^= 0x01;
    expect(unsealSession(raw.toString('base64url'))).toBeNull();
  });

  it('rejects a token sealed under a different HYDI_SERVICE_SECRET (rotation invalidates sessions)', () => {
    const token = sealSession(SESSION, { secret: 'b'.repeat(64) });
    expect(unsealSession(token)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = sealSession(SESSION, { now: Date.now() - 400 * 24 * 60 * 60 * 1000 });
    expect(unsealSession(token)).toBeNull();
  });

  it('refuses to seal when HYDI_SERVICE_SECRET is unset', () => {
    delete process.env.HYDI_SERVICE_SECRET;
    expect(sealSession(SESSION)).toBeNull();
    expect(unsealSession('anything')).toBeNull();
  });

  it('rejects garbage input without throwing', () => {
    for (const bad of [undefined, '', 'x', '!!!', 'a'.repeat(5000), 42]) {
      expect(unsealSession(bad)).toBeNull();
    }
  });

  it('parses cookies, keeping the first occurrence of a name', () => {
    expect(parseCookies('a=1; b=two%20words; a=3')).toEqual({ a: '1', b: 'two words' });
    expect(parseCookies(undefined)).toEqual({});
  });

  it('sets an HttpOnly, SameSite=Strict cookie that script cannot read', () => {
    const res = makeRes();
    setSessionCookie({ headers: {} }, res, SESSION);
    const cookie = res.headers['set-cookie'];
    expect(cookie).toMatch(new RegExp(`^${COOKIE_NAME}=`));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Secure'); // plain-http dev request
  });

  it('marks the cookie Secure for HTTPS requests (direct TLS or behind a TLS proxy)', () => {
    const res1 = makeRes();
    setSessionCookie({ headers: { 'x-forwarded-proto': 'https' } }, res1, SESSION);
    expect(res1.headers['set-cookie']).toContain('Secure');

    const res2 = makeRes();
    setSessionCookie({ headers: {}, socket: { encrypted: true } }, res2, SESSION);
    expect(res2.headers['set-cookie']).toContain('Secure');
  });

  it('does not mark it Secure over plain HTTP even in production (browsers would drop it)', () => {
    process.env.NODE_ENV = 'production';
    const res = makeRes();
    setSessionCookie({ headers: {} }, res, SESSION);
    expect(res.headers['set-cookie']).not.toContain('Secure');
  });

  it('clears the cookie with Max-Age=0', () => {
    const res = makeRes();
    clearSessionCookie({ headers: {} }, res);
    expect(res.headers['set-cookie']).toContain('Max-Age=0');
  });

  it('reads a session back from the request cookie header', () => {
    const res = makeRes();
    setSessionCookie({ headers: {} }, res, SESSION);
    const pair = res.headers['set-cookie'].split(';')[0];
    expect(readSession({ headers: { cookie: `other=1; ${pair}` } })).toMatchObject({ deviceId: 'phone-1' });
    expect(readSession({ headers: {} })).toBeNull();
  });
});
