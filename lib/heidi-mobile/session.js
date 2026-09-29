'use strict';

/**
 * Heidi Mobile session sealing.
 *
 * The phone never holds a usable HYDI credential in JavaScript-readable
 * storage. After pairing, the device's HMAC signing key (see
 * lib/auth/deviceAuth.js — the same per-device scheme every mobile-ops route
 * already verifies) is sealed server-side with AES-256-GCM and handed to the
 * browser as an HttpOnly, SameSite=Strict cookie. The browser can only send
 * it back; it cannot read, copy, or exfiltrate it via script.
 *
 * The sealing key is derived (HKDF) from HYDI_SERVICE_SECRET, so no new
 * secret has to be provisioned. Rotating HYDI_SERVICE_SECRET invalidates
 * every Heidi Mobile session (the phone just re-pairs), which is the
 * desired blast-radius property for a rotation.
 */

const { createCipheriv, createDecipheriv, hkdfSync, randomBytes } = require('crypto');

const COOKIE_NAME = 'heidi_session';
const SESSION_VERSION = 1;
const DEFAULT_TTL_DAYS = 30;
const HKDF_INFO = 'heidi-mobile-session-v1';

function sessionTtlMs() {
  const days = parseInt(process.env.HEIDI_MOBILE_SESSION_TTL_DAYS || '', 10);
  const safeDays = Number.isFinite(days) && days > 0 && days <= 365 ? days : DEFAULT_TTL_DAYS;
  return safeDays * 24 * 60 * 60 * 1000;
}

function sealingKey(secret) {
  const material = secret != null ? secret : process.env.HYDI_SERVICE_SECRET;
  if (!material) return null;
  return Buffer.from(hkdfSync('sha256', Buffer.from(material, 'utf8'), Buffer.alloc(0), Buffer.from(HKDF_INFO), 32));
}

/**
 * @param {{deviceId: string, signingKey: string, pending?: boolean}} session
 * @param {{secret?: string, now?: number}} [opts]
 * @returns {string|null} base64url token, or null when no sealing secret is configured
 */
function sealSession(session, opts = {}) {
  const key = sealingKey(opts.secret);
  if (!key) return null;
  const now = opts.now || Date.now();
  const body = JSON.stringify({
    v: SESSION_VERSION,
    d: session.deviceId,
    k: session.signingKey,
    p: Boolean(session.pending),
    iat: now,
    exp: now + sessionTtlMs(),
  });
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(body, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64url');
}

/**
 * @returns {{deviceId: string, signingKey: string, pending: boolean, issuedAt: number, expiresAt: number}|null}
 *   null for anything missing, tampered, expired, or sealed under a different secret.
 */
function unsealSession(token, opts = {}) {
  if (!token || typeof token !== 'string' || token.length > 4096) return null;
  const key = sealingKey(opts.secret);
  if (!key) return null;
  try {
    const raw = Buffer.from(token, 'base64url');
    if (raw.length < 12 + 16 + 1) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const body = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
    const now = opts.now || Date.now();
    if (body.v !== SESSION_VERSION || typeof body.d !== 'string' || typeof body.k !== 'string') return null;
    if (typeof body.exp !== 'number' || body.exp <= now) return null;
    return { deviceId: body.d, signingKey: body.k, pending: Boolean(body.p), issuedAt: body.iat, expiresAt: body.exp };
  } catch (_) {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header || typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!name || out[name] !== undefined) continue;
    try { out[name] = decodeURIComponent(value); } catch (_) { out[name] = value; }
  }
  return out;
}

/**
 * Secure flag: on whenever the request arrived over HTTPS, directly or via a
 * TLS-terminating proxy such as `tailscale serve` (x-forwarded-proto).
 * Deliberately NOT keyed on NODE_ENV: `npm run boot:prod` can serve a phone
 * over plain-HTTP LAN, and browsers silently discard a Secure cookie set over
 * http://, which would make pairing appear to do nothing. Over plain HTTP the
 * whole exchange is already unencrypted, so Secure would add no protection
 * there — HTTPS (see docs/HEIDI_MOBILE.md) is what protects the cookie.
 */
function isSecureRequest(req) {
  const proto = req.headers && req.headers['x-forwarded-proto'];
  if (proto && String(proto).split(',')[0].trim() === 'https') return true;
  return Boolean(req.socket && req.socket.encrypted);
}

function serializeCookie(value, { maxAgeSeconds, secure }) {
  const parts = [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function setSessionCookie(req, res, session) {
  const sealed = sealSession(session);
  if (!sealed) return false;
  res.setHeader('Set-Cookie', serializeCookie(sealed, {
    maxAgeSeconds: Math.floor(sessionTtlMs() / 1000),
    secure: isSecureRequest(req),
  }));
  return true;
}

function clearSessionCookie(req, res) {
  res.setHeader('Set-Cookie', serializeCookie('', { maxAgeSeconds: 0, secure: isSecureRequest(req) }));
}

function readSession(req) {
  const cookies = parseCookies(req.headers && req.headers.cookie);
  return unsealSession(cookies[COOKIE_NAME]);
}

module.exports = {
  COOKIE_NAME,
  sealSession,
  unsealSession,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  readSession,
  isSecureRequest,
};
