'use strict';

/**
 * Device login for the Heidi mobile chat server (launch-heidi-mobile.js,
 * :3006). Without it, anyone on the LAN or tailnet could read every saved
 * conversation and memory through the relayed /api/conversations routes.
 *
 * - HEIDI_MOBILE_TOKEN unset: open, as before (the system report flags it).
 * - Set: requests from this machine pass; everything else needs a session
 *   cookie, obtained once per device by POSTing the token to /api/pair, or
 *   an `Authorization: Bearer <token>` header (scripts).
 *
 * "This machine" means a loopback socket with NO forwarding headers: a
 * reverse proxy such as `tailscale serve` also connects from loopback, and
 * its requests must log in like any other remote device.
 *
 * The cookie holds a digest derived from the token, never the token itself,
 * so rotating HEIDI_MOBILE_TOKEN signs every device out.
 */

const crypto = require('crypto');

const COOKIE = 'heidi_mobile';
const OPEN_PATHS = new Set(['/', '/heidi', '/heidi-mobile', '/api/health', '/api/pair', '/favicon.ico']);
// Forge Board routes carry their own token auth (lib/forge-board).
const OWN_AUTH_PREFIXES = ['/api/board', '/board'];
const FORWARD_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'forwarded', 'x-real-ip', 'tailscale-user-login'];
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function safeEqual(a, b) {
  return crypto.timingSafeEqual(digest(a), digest(b));
}

function sessionValue(token) {
  return crypto.createHmac('sha256', String(token)).update('heidi-mobile-session-v1').digest('hex');
}

function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function isLocal(req) {
  const addr = req.socket && req.socket.remoteAddress;
  if (!LOOPBACK.has(addr)) return false;
  return !FORWARD_HEADERS.some((h) => req.headers[h] !== undefined);
}

/**
 * @param {{ token?: string|null, maxAgeDays?: number, now?: () => number }} [opts]
 * @returns {{ enabled: boolean, middleware: Function, pair: Function }}
 */
function createLocalAuth(opts = {}) {
  const token = opts.token == null ? process.env.HEIDI_MOBILE_TOKEN : opts.token;
  const enabled = Boolean(token && String(token).length >= 12);
  const maxAge = (opts.maxAgeDays || 90) * 24 * 3600;
  const now = opts.now || Date.now;
  const attempts = new Map(); // ip -> [timestamps]

  function authorized(req) {
    if (!enabled || isLocal(req)) return true;
    const auth = String(req.headers.authorization || '');
    if (auth.startsWith('Bearer ') && safeEqual(auth.slice(7).trim(), token)) return true;
    const cookie = readCookie(req.headers.cookie, COOKIE);
    return Boolean(cookie) && safeEqual(cookie, sessionValue(token));
  }

  function middleware(req, res, next) {
    if (!enabled) return next();
    const p = req.path || req.url;
    if (OPEN_PATHS.has(p) || OWN_AUTH_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`))) return next();
    if (authorized(req)) return next();
    res.status(401).json({ error: 'login_required', hint: 'Enter this device\'s Heidi mobile token (HEIDI_MOBILE_TOKEN on Frank).' });
  }

  /** POST /api/pair { token } -> session cookie. Rate-limited per address. */
  function pair(req, res) {
    if (!enabled) return res.json({ ok: true, required: false });
    const ip = (req.socket && req.socket.remoteAddress) || 'unknown';
    const t = now();
    const recent = (attempts.get(ip) || []).filter((x) => t - x < 60000);
    if (recent.length >= 10) return res.status(429).json({ ok: false, error: 'too many attempts, wait a minute' });
    recent.push(t);
    attempts.set(ip, recent);
    const given = req.body && typeof req.body.token === 'string' ? req.body.token.trim() : '';
    if (!given || !safeEqual(given, token)) return res.status(401).json({ ok: false, error: 'wrong token' });
    res.setHeader('Set-Cookie', `${COOKIE}=${sessionValue(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict`);
    return res.json({ ok: true, required: true });
  }

  return { enabled, middleware, pair, authorized };
}

module.exports = { createLocalAuth, sessionValue, readCookie, isLocal, COOKIE };
