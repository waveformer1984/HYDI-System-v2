'use strict';

/**
 * Customer (tenant) access tokens for the billing surface.
 *
 * HYDI has no customer login today (operators authenticate with
 * x-hydi-service-token / device tokens; customers have none). Until a real
 * customer identity provider exists, an operator issues a signed, expiring
 * token bound to exactly one tenant (POST /api/billing/admin/tenants or
 * .../tenants/:id/token) and shares it with the customer — e.g. as a link.
 * This is an INTERIM mechanism and a documented launch blocker: see
 * docs/billing/REVENUE_STREAMS_MODULE.md §L.
 *
 * Format: hbc1.<base64url(JSON {t, iat, exp, n})>.<hex HMAC-SHA256>
 * Key:    BILLING_CUSTOMER_TOKEN_SECRET (≥ 32 chars, server-side only)
 *
 * The tenant id is taken ONLY from a verified token — never from a request
 * body or query — which is what enforces tenant isolation on every
 * customer-facing route.
 */

const { createHmac, timingSafeEqual, randomBytes } = require('crypto');

const PREFIX = 'hbc1';
const MAX_TTL_SECONDS = 30 * 24 * 3600;

function secretOrNull(secret) {
  const s = secret !== undefined ? secret : process.env.BILLING_CUSTOMER_TOKEN_SECRET;
  return s && s.length >= 32 ? s : null;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(body, secret) {
  return createHmac('sha256', secret).update(`${PREFIX}.${body}`).digest('hex');
}

/**
 * @returns {{ token: string, expires_at: string }}
 */
function issueCustomerToken(tenantId, { ttlSeconds = 7 * 24 * 3600, now = new Date(), secret } = {}) {
  const key = secretOrNull(secret);
  if (!key) throw new Error('BILLING_CUSTOMER_TOKEN_SECRET must be set (>= 32 chars)');
  const ttl = Math.min(Math.max(Number(ttlSeconds) || 0, 60), MAX_TTL_SECONDS);
  const iat = Math.floor(now.getTime() / 1000);
  const payload = { t: tenantId, iat, exp: iat + ttl, n: randomBytes(6).toString('hex') };
  const body = b64url(JSON.stringify(payload));
  return { token: `${PREFIX}.${body}.${sign(body, key)}`, expires_at: new Date((iat + ttl) * 1000).toISOString() };
}

/**
 * @returns {{ valid: true, tenantId: string } | { valid: false, reason: string }}
 */
function verifyCustomerToken(token, { now = new Date(), secret } = {}) {
  const key = secretOrNull(secret);
  if (!key) return { valid: false, reason: 'customer auth not configured' };
  if (typeof token !== 'string' || token.length > 2000) return { valid: false, reason: 'missing token' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return { valid: false, reason: 'malformed token' };
  const expected = Buffer.from(sign(parts[1], key), 'hex');
  let given;
  try {
    given = Buffer.from(parts[2], 'hex');
  } catch (_) {
    return { valid: false, reason: 'malformed token' };
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { valid: false, reason: 'bad signature' };
  let payload;
  try {
    payload = JSON.parse(fromB64url(parts[1]).toString('utf8'));
  } catch (_) {
    return { valid: false, reason: 'malformed token' };
  }
  if (!payload || typeof payload.t !== 'string' || typeof payload.exp !== 'number') return { valid: false, reason: 'malformed token' };
  if (payload.exp * 1000 <= now.getTime()) return { valid: false, reason: 'token expired' };
  return { valid: true, tenantId: payload.t };
}

/** Reads the bearer token from Authorization: Bearer <token>. */
function bearerFrom(req) {
  const h = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (typeof h !== 'string') return null;
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

module.exports = { issueCustomerToken, verifyCustomerToken, bearerFrom };
