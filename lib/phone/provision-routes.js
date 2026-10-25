'use strict';

/**
 * POST /api/phone/provision/code   — issue a one-time code + QR. Only from
 *                                    Frank itself (loopback, no proxy hop).
 * POST /api/phone/provision/redeem — trade a code for the phone keys. From
 *                                    loopback, LAN or tailnet only.
 *
 * Neither path is on the public-ingress allowlist, so the ngrok tunnel
 * already answers 404. These checks are the second wall: every forwarded
 * hop must be internal (lib/security/ingressGate.js), which also catches a
 * tunnel that connects from 127.0.0.1 but carries the real client's address
 * in X-Forwarded-For.
 */

const os = require('os');
const { classify, isInternalIp } = require('../security/ingressGate');
const { createProvisionCode, redeemProvisionCode, PROVISIONABLE_KEYS } = require('./provision');

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function normalizeIp(ip) {
  const v = String(ip || '').trim().toLowerCase();
  return v.startsWith('::ffff:') ? v.slice(7) : v;
}

function isLoopbackIp(ip) {
  const v = normalizeIp(ip);
  return v === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v);
}

/** Every address the request passed through: forwarded hops plus the socket peer. */
function requestHops(req) {
  const h = req.headers || {};
  const hops = [];
  for (const part of String(h['x-forwarded-for'] || '').split(',')) if (part.trim()) hops.push(part.trim());
  if (h['x-real-ip']) hops.push(String(h['x-real-ip']).trim());
  const socket = req.socket || req.connection || {};
  if (socket.remoteAddress) hops.push(String(socket.remoteAddress));
  return hops;
}

function fromFrankItself(req, env) {
  if (!classify(req.headers || {}, env).internal) return false;
  const hops = requestHops(req);
  if (!hops.length || !hops.every(isLoopbackIp)) return false;
  const host = String((req.headers || {}).host || '').toLowerCase().replace(/:\d+$/, '');
  return LOOPBACK_HOSTS.has(host);
}

function fromOwnNetwork(req, env) {
  if (!classify(req.headers || {}, env).internal) return false;
  const hops = requestHops(req);
  return hops.length > 0 && hops.every((ip) => isInternalIp(ip));
}

/** Frank's addresses the phone can reach: LAN first, then tailnet. */
function frankHosts(interfaces = os.networkInterfaces()) {
  const lan = [];
  const tailnet = [];
  for (const list of Object.values(interfaces || {})) {
    for (const a of list || []) {
      if (!a || a.internal || (a.family !== 'IPv4' && a.family !== 4)) continue;
      const [x, y] = a.address.split('.').map(Number);
      if (x === 100 && y >= 64 && y <= 127) tailnet.push(a.address);
      else if (x === 10 || (x === 192 && y === 168) || (x === 172 && y >= 16 && y <= 31)) lan.push(a.address);
    }
  }
  return [...new Set([...lan, ...tailnet])];
}

function qrSvg(text, qrcode = require('../third_party/qrcode-generator.js')) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 24, scalable: true });
}

function createLimiter(limit, windowMs = 60 * 1000) {
  const hits = [];
  return {
    limited(now) {
      while (hits.length && now - hits[0] > windowMs) hits.shift();
      if (hits.length >= limit) return true;
      hits.push(now);
      return false;
    },
    reset() { hits.length = 0; },
  };
}

const codeLimiter = createLimiter(10);
const redeemLimiter = createLimiter(10);

function createProvisionCodeHandler(deps = {}) {
  const env = deps.env || process.env;
  const root = deps.root || process.cwd();
  const now = deps.now || (() => Date.now());
  const hosts = deps.hosts || (() => frankHosts());
  const log = deps.log || ((line) => console.log(line));
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    if (!fromFrankItself(req, env)) return res.status(403).json({ error: 'open this page on Frank itself (http://127.0.0.1:3000/phone/provision)' });
    // A custom header forces a CORS preflight, so another site open in
    // Frank's browser cannot quietly mint codes.
    if (String((req.headers || {})['x-hydi-provision'] || '') !== '1') return res.status(400).json({ error: 'missing_header' });
    if (codeLimiter.limited(now())) return res.status(429).json({ error: 'rate_limited' });
    const available = PROVISIONABLE_KEYS.filter((k) => String(env[k] || '').trim());
    if (!available.length) return res.status(503).json({ error: 'no phone keys are configured on Frank' });
    const frank = hosts();
    let issued;
    try {
      issued = createProvisionCode({ root, hosts: frank, keys: available, now: now(), randomBytes: deps.randomBytes });
    } catch (error) {
      return res.status(503).json({ error: error instanceof Error ? error.message : 'cannot issue code' });
    }
    log(`[phone-provision] issued code for ${issued.keys.join(',')} expires=${new Date(issued.expiresAt).toISOString()}`);
    return res.status(200).json({
      ok: true,
      svg: qrSvg(issued.payload),
      expiresAt: issued.expiresAt,
      keys: issued.keys,
      hosts: frank,
    });
  };
}

function createProvisionRedeemHandler(deps = {}) {
  const env = deps.env || process.env;
  const root = deps.root || process.cwd();
  const now = deps.now || (() => Date.now());
  const log = deps.log || ((line) => console.log(line));
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    const peer = normalizeIp((req.socket || req.connection || {}).remoteAddress) || 'unknown';
    if (!fromOwnNetwork(req, env)) {
      log(`[phone-provision] refused redeem peer=${peer} reason=network`);
      return res.status(403).json({ error: 'forbidden' });
    }
    if (redeemLimiter.limited(now())) return res.status(429).json({ error: 'rate_limited' });
    const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
    const result = redeemProvisionCode({ root, code: String(body.code || '').trim().toUpperCase(), env, now: now() });
    if (!result.ok) {
      log(`[phone-provision] refused redeem peer=${peer} reason=${result.error}`);
      return res.status(result.error === 'expired_code' ? 410 : 400).json({ ok: false, error: result.error });
    }
    log(`[phone-provision] redeemed peer=${peer} keys=${Object.keys(result.keys).join(',')}${result.missing.length ? ` missing=${result.missing.join(',')}` : ''}`);
    return res.status(200).json({ ok: true, keys: result.keys, missing: result.missing });
  };
}

function resetRateLimits() {
  codeLimiter.reset();
  redeemLimiter.reset();
}

module.exports = {
  createProvisionCodeHandler,
  createProvisionRedeemHandler,
  fromFrankItself,
  fromOwnNetwork,
  frankHosts,
  qrSvg,
  resetRateLimits,
};
