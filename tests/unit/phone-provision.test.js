'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  TTL_MS, createProvisionCode, redeemProvisionCode, provisionDir, hashCode, newCode,
} = require('../../lib/phone/provision');
const {
  createProvisionCodeHandler, createProvisionRedeemHandler, fromFrankItself, fromOwnNetwork, frankHosts, qrSvg, resetRateLimits,
} = require('../../lib/phone/provision-routes');
const { isPublicPath } = require('../../lib/security/ingressGate');

const NOW = Date.parse('2026-10-25T14:00:00Z');
const ENV = { HYDI_BOARD_HUMAN_TOKEN: 'human-secret', HYDI_PHONE_READ_TOKEN: 'read-secret' };
const HOSTS = ['192.168.86.178', '100.118.182.126'];

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'provision-'));
}

function req({ method = 'POST', ip = '127.0.0.1', headers = {}, body } = {}) {
  return { method, headers: { host: '127.0.0.1:3000', ...headers }, socket: { remoteAddress: ip }, body };
}

function res() {
  return {
    code: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

beforeEach(() => resetRateLimits());

describe('provision codes', () => {
  it('a code is 160 random bits in QR-friendly base32, and the payload carries no key', () => {
    expect(newCode()).toMatch(/^[A-Z2-7]{32}$/);
    const root = tmpRoot();
    const issued = createProvisionCode({ root, hosts: HOSTS, now: NOW });
    expect(issued.payload).toMatch(/^hydi-provision:v1\?c=[A-Z2-7]{32}&h=192\.168\.86\.178,100\.118\.182\.126&p=3000$/);
    expect(issued.payload).not.toContain('secret');
    // Only the hash of the code is on disk.
    const files = fs.readdirSync(provisionDir(root));
    expect(files).toEqual([`${hashCode(issued.code)}.json`]);
    expect(fs.readFileSync(path.join(provisionDir(root), files[0]), 'utf8')).not.toContain(issued.code);
  });

  it('redeems once for the configured keys plus FRANK_HOSTS, then never again', () => {
    const root = tmpRoot();
    const { code } = createProvisionCode({ root, hosts: HOSTS, now: NOW });
    const first = redeemProvisionCode({ root, code, env: ENV, now: NOW + 1000 });
    expect(first).toEqual({
      ok: true,
      keys: { HYDI_BOARD_HUMAN_TOKEN: 'human-secret', HYDI_PHONE_READ_TOKEN: 'read-secret', FRANK_HOSTS: HOSTS.join(',') },
      missing: ['GROQ_API_KEY'],
    });
    expect(redeemProvisionCode({ root, code, env: ENV, now: NOW + 2000 })).toEqual({ ok: false, error: 'invalid_or_used_code' });
    expect(fs.readdirSync(provisionDir(root))).toEqual([]);
  });

  it('expires after 5 minutes and rejects malformed or unknown codes', () => {
    const root = tmpRoot();
    const { code } = createProvisionCode({ root, hosts: HOSTS, now: NOW });
    expect(redeemProvisionCode({ root, code, env: ENV, now: NOW + TTL_MS + 1 })).toEqual({ ok: false, error: 'expired_code' });
    expect(redeemProvisionCode({ root, code: 'nope', env: ENV, now: NOW })).toEqual({ ok: false, error: 'invalid_code' });
    expect(redeemProvisionCode({ root, code: newCode(), env: ENV, now: NOW })).toEqual({ ok: false, error: 'invalid_or_used_code' });
  });

  it('never hands out a key outside the allowlist, even if a code file asks for it', () => {
    const root = tmpRoot();
    const { code } = createProvisionCode({ root, hosts: HOSTS, now: NOW, keys: ['HYDI_PHONE_READ_TOKEN', 'STRIPE_SECRET_KEY'] });
    const file = path.join(provisionDir(root), `${hashCode(code)}.json`);
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(rec.keys).toEqual(['HYDI_PHONE_READ_TOKEN']);
    rec.keys.push('STRIPE_SECRET_KEY');
    fs.writeFileSync(file, JSON.stringify(rec));
    const out = redeemProvisionCode({ root, code, env: { ...ENV, STRIPE_SECRET_KEY: 'stripe-secret-not-for-phone' }, now: NOW });
    expect(out.keys).not.toHaveProperty('STRIPE_SECRET_KEY');
  });

  it('sweeps expired codes when a new one is issued', () => {
    const root = tmpRoot();
    createProvisionCode({ root, hosts: HOSTS, now: NOW });
    createProvisionCode({ root, hosts: HOSTS, now: NOW + TTL_MS + 1 });
    expect(fs.readdirSync(provisionDir(root))).toHaveLength(1);
  });
});

describe('who may issue and redeem', () => {
  it('issuing needs Frank itself: loopback socket, loopback hops, localhost Host', () => {
    expect(fromFrankItself(req(), {})).toBe(true);
    expect(fromFrankItself(req({ headers: { 'x-forwarded-for': '127.0.0.1' } }), {})).toBe(true);
    expect(fromFrankItself(req({ ip: '192.168.86.20' }), {})).toBe(false);
    expect(fromFrankItself(req({ ip: '100.87.215.90' }), {})).toBe(false);
    // ngrok connects from loopback but carries the public client in XFF.
    expect(fromFrankItself(req({ headers: { 'x-forwarded-for': '203.0.113.9' } }), {})).toBe(false);
    expect(fromFrankItself(req({ headers: { host: 'abc.ngrok-free.app' } }), {})).toBe(false);
    expect(fromFrankItself(req({ headers: { host: '192.168.86.178:3000' } }), {})).toBe(false);
  });

  it('redeeming is allowed from loopback, LAN and tailnet only', () => {
    expect(fromOwnNetwork(req({ ip: '192.168.86.20', headers: { host: '192.168.86.178:3000' } }), {})).toBe(true);
    expect(fromOwnNetwork(req({ ip: '100.87.215.90', headers: { host: '100.118.182.126:3000' } }), {})).toBe(true);
    expect(fromOwnNetwork(req({ headers: { 'x-forwarded-for': '203.0.113.9' } }), {})).toBe(false);
    expect(fromOwnNetwork(req({ ip: '8.8.8.8' }), {})).toBe(false);
  });

  it('neither route is on the public-ingress allowlist', () => {
    for (const p of ['/api/phone/provision/code', '/api/phone/provision/redeem', '/phone/provision']) {
      expect(isPublicPath(p, {})).toBe(false);
    }
  });

  it('lists LAN before tailnet addresses and ignores loopback and IPv6', () => {
    expect(frankHosts({
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      ts: [{ address: '100.118.182.126', family: 'IPv4', internal: false }],
      eth: [{ address: '192.168.86.178', family: 'IPv4', internal: false }, { address: 'fe80::1', family: 'IPv6', internal: false }],
    })).toEqual(['192.168.86.178', '100.118.182.126']);
  });
});

describe('route handlers', () => {
  const FIXED = Buffer.alloc(20, 7);
  const codeHandler = (root, extra = {}) => createProvisionCodeHandler({ env: ENV, root, now: () => NOW, hosts: () => HOSTS, log: () => {}, randomBytes: () => FIXED, ...extra });
  const redeemHandler = (root, extra = {}) => createProvisionRedeemHandler({ env: ENV, root, now: () => NOW, log: () => {}, ...extra });

  it('issues a QR on Frank, which the phone redeems from the LAN exactly once', async () => {
    const root = tmpRoot();
    const issued = res();
    await codeHandler(root)(req({ headers: { 'x-hydi-provision': '1' } }), issued);
    expect(issued.code).toBe(200);
    expect(issued.body.svg).toMatch(/^<svg/);
    // Text forms of the same one-time code, for Copy code / typing it in.
    expect(issued.body.payload).toMatch(/^hydi-provision:v1\?c=[A-Z2-7]{32}&h=[^&]+&p=3000$/);
    expect(issued.body.payload).toContain(`c=${issued.body.code}&`);
    expect(issued.body.code).toBe(newCode(() => FIXED));
    expect(issued.body.keys).toEqual(['HYDI_BOARD_HUMAN_TOKEN', 'HYDI_PHONE_READ_TOKEN']);
    expect(JSON.stringify(issued.body)).not.toContain('secret');

    const code = newCode(() => FIXED);
    const phone = req({ ip: '192.168.86.20', headers: { host: '192.168.86.178:3000' }, body: { code } });
    const first = res();
    await redeemHandler(root)(phone, first);
    expect(first.code).toBe(200);
    expect(first.body.keys.HYDI_PHONE_READ_TOKEN).toBe('read-secret');
    const again = res();
    await redeemHandler(root)(phone, again);
    expect(again.code).toBe(400);
  });

  it('refuses to issue from the LAN, through a tunnel, or without the custom header', async () => {
    const root = tmpRoot();
    const lan = res();
    await codeHandler(root)(req({ ip: '192.168.86.20', headers: { 'x-hydi-provision': '1' } }), lan);
    expect(lan.code).toBe(403);
    const tunnel = res();
    await codeHandler(root)(req({ headers: { 'x-hydi-provision': '1', 'x-forwarded-for': '203.0.113.9' } }), tunnel);
    expect(tunnel.code).toBe(403);
    const csrf = res();
    await codeHandler(root)(req(), csrf);
    expect(csrf.code).toBe(400);
    const get = res();
    await codeHandler(root)(req({ method: 'GET' }), get);
    expect(get.code).toBe(405);
    expect(fs.existsSync(provisionDir(root))).toBe(false);
  });

  it('refuses to issue when Frank has none of the phone keys', async () => {
    const out = res();
    await codeHandler(tmpRoot(), { env: {} })(req({ headers: { 'x-hydi-provision': '1' } }), out);
    expect(out.code).toBe(503);
  });

  it('refuses redeem from the public internet and rate-limits guessing', async () => {
    const root = tmpRoot();
    const pub = res();
    await redeemHandler(root)(req({ headers: { 'x-forwarded-for': '203.0.113.9' }, body: { code: newCode() } }), pub);
    expect(pub.code).toBe(403);
    let last;
    for (let i = 0; i < 11; i += 1) {
      last = res();
      await redeemHandler(root)(req({ ip: '192.168.86.20', body: { code: newCode() } }), last);
    }
    expect(last.code).toBe(429);
  });

  it('expired codes answer 410', async () => {
    const root = tmpRoot();
    const { code } = createProvisionCode({ root, hosts: HOSTS, now: NOW - TTL_MS - 1 });
    const out = res();
    await redeemHandler(root)(req({ ip: '192.168.86.20', body: { code } }), out);
    expect(out.code).toBe(410);
  });

  it('draws a scannable-size QR for the payload', () => {
    const svg = qrSvg(`hydi-provision:v1?c=${newCode()}&h=${HOSTS.join(',')}&p=3000`);
    expect(svg).toMatch(/^<svg[\s\S]*<\/svg>$/);
  });
});

