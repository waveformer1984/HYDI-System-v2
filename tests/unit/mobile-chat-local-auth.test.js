'use strict';

/**
 * Device login for the Heidi mobile chat server (lib/mobile-chat/local-auth.js
 * wired into launch-heidi-mobile.js). Runs the real server: requests that
 * carry forwarding headers count as remote even though they arrive on
 * loopback, exactly like `tailscale serve` traffic.
 */

const path = require('path');
const { spawn } = require('child_process');
const { createLocalAuth, sessionValue, readCookie } = require('../../lib/mobile-chat/local-auth');

const TOKEN = 'device-token-for-tests-123';

function fakeReq({ path: p = '/api/conversations', addr = '10.0.0.5', headers = {}, body } = {}) {
  return { path: p, url: p, socket: { remoteAddress: addr }, headers, body };
}
function fakeRes() {
  const r = { code: 200, headers: {}, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
}
const gate = (auth, req) => {
  let passed = false;
  const res = fakeRes();
  auth.middleware(req, res, () => { passed = true; });
  return { passed, res };
};

describe('local auth middleware', () => {
  it('is off (and says so) without a token, or with a too-short one', () => {
    expect(createLocalAuth({ token: '' }).enabled).toBe(false);
    expect(createLocalAuth({ token: 'short' }).enabled).toBe(false);
    expect(gate(createLocalAuth({ token: '' }), fakeReq()).passed).toBe(true);
  });

  it('lets this machine through, but not a forwarded request on loopback', () => {
    const auth = createLocalAuth({ token: TOKEN });
    expect(gate(auth, fakeReq({ addr: '127.0.0.1' })).passed).toBe(true);
    expect(gate(auth, fakeReq({ addr: '::1' })).passed).toBe(true);
    const fwd = gate(auth, fakeReq({ addr: '127.0.0.1', headers: { 'x-forwarded-for': '100.64.1.2' } }));
    expect(fwd.passed).toBe(false);
    expect(fwd.res.code).toBe(401);
    expect(gate(auth, fakeReq({ addr: '127.0.0.1', headers: { 'tailscale-user-login': 'jordan@example.com' } })).passed).toBe(false);
  });

  it('requires a session cookie or bearer token from other devices', () => {
    const auth = createLocalAuth({ token: TOKEN });
    expect(gate(auth, fakeReq()).res.body).toMatchObject({ error: 'login_required' });
    expect(gate(auth, fakeReq({ headers: { authorization: `Bearer ${TOKEN}` } })).passed).toBe(true);
    expect(gate(auth, fakeReq({ headers: { authorization: 'Bearer wrong' } })).passed).toBe(false);
    expect(gate(auth, fakeReq({ headers: { cookie: `a=1; heidi_mobile=${sessionValue(TOKEN)}` } })).passed).toBe(true);
    expect(gate(auth, fakeReq({ headers: { cookie: `heidi_mobile=${TOKEN}` } })).passed).toBe(false); // the raw token is not a session
    expect(gate(auth, fakeReq({ headers: { cookie: `heidi_mobile=${sessionValue('rotated-old-token-xyz')}` } })).passed).toBe(false);
  });

  it('keeps the page, health, pairing and the self-authenticating board open', () => {
    const auth = createLocalAuth({ token: TOKEN });
    for (const p of ['/', '/heidi', '/api/health', '/api/pair', '/api/board', '/board']) {
      expect(gate(auth, fakeReq({ path: p })).passed).toBe(true);
    }
    for (const p of ['/api/chat', '/api/conversations', '/api/conversations/x/messages', '/api/memory/status', '/api/system/status', '/api/models']) {
      expect(gate(auth, fakeReq({ path: p })).passed).toBe(false);
    }
  });

  it('pairs with the right token, refuses the wrong one, and rate-limits guessing', () => {
    let t = 0;
    const auth = createLocalAuth({ token: TOKEN, now: () => t });
    const wrong = fakeRes();
    auth.pair(fakeReq({ path: '/api/pair', body: { token: 'nope' } }), wrong);
    expect(wrong.code).toBe(401);
    const ok = fakeRes();
    auth.pair(fakeReq({ path: '/api/pair', body: { token: TOKEN } }), ok);
    expect(ok.body).toEqual({ ok: true, required: true });
    expect(readCookie(ok.headers['Set-Cookie'], 'heidi_mobile')).toBe(sessionValue(TOKEN));
    expect(ok.headers['Set-Cookie']).toMatch(/HttpOnly; SameSite=Strict/);
    expect(ok.headers['Set-Cookie']).not.toContain(TOKEN);
    for (let i = 0; i < 8; i += 1) auth.pair(fakeReq({ path: '/api/pair', body: { token: 'nope' } }), fakeRes());
    const limited = fakeRes();
    auth.pair(fakeReq({ path: '/api/pair', body: { token: TOKEN } }), limited);
    expect(limited.code).toBe(429);
    t += 61000;
    const later = fakeRes();
    auth.pair(fakeReq({ path: '/api/pair', body: { token: TOKEN } }), later);
    expect(later.code).toBe(200);
  });
});

describe('launch-heidi-mobile.js with HEIDI_MOBILE_TOKEN', () => {
  it('locks the conversation routes to paired devices', async () => {
    const port = 40000 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, [path.join(__dirname, '../../launch-heidi-mobile.js')], {
      env: { ...process.env, HEIDI_MOBILE_PORT: String(port), HEIDI_MOBILE_TOKEN: TOKEN, HEIDI_CORE_URL: 'http://127.0.0.1:9', OLLAMA_URL: 'http://127.0.0.1:9', LM_STUDIO_URL: 'http://127.0.0.1:9' },
      stdio: 'ignore',
    });
    const base = `http://127.0.0.1:${port}`;
    const remote = { 'x-forwarded-for': '100.64.0.7' }; // arrives like tailscale-serve traffic
    try {
      let health = null;
      for (let i = 0; i < 50 && !health; i += 1) {
        await new Promise((r) => setTimeout(r, 100));
        health = await fetch(`${base}/api/health`, { headers: remote }).then((r) => r.json(), () => null);
      }
      expect(health).toMatchObject({ loginRequired: true, loggedIn: false });

      expect((await fetch(`${base}/api/conversations`, { headers: remote })).status).toBe(401);
      expect((await fetch(`${base}/`, { headers: remote })).status).toBe(200); // the page loads to ask for the token

      const bad = await fetch(`${base}/api/pair`, { method: 'POST', headers: { ...remote, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'guess' }) });
      expect(bad.status).toBe(401);
      const good = await fetch(`${base}/api/pair`, { method: 'POST', headers: { ...remote, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: TOKEN }) });
      const cookie = good.headers.get('set-cookie').split(';')[0];
      // Paired: the gate lets it through to the relay (Heidi Core is down here, so 503 from the relay, not 401).
      const after = await fetch(`${base}/api/conversations`, { headers: { ...remote, cookie } });
      expect(after.status).toBe(503);
      // This machine itself needs no login.
      expect((await fetch(`${base}/api/conversations`)).status).toBe(503);
    } finally {
      child.kill();
    }
  });
});
