'use strict';

const crypto = require('crypto');

const COOKIE_NAME = 'makeready_crew_session';
const MAX_AGE_SEC = 60 * 60 * 12;

function sessionSecret() {
  return (
    process.env.MAKEREADY_CREW_SESSION_SECRET ||
    process.env.HYDI_SERVICE_SECRET ||
    process.env.AUTH_SECRET ||
    ''
  );
}

function expectedPin() {
  return process.env.MAKEREADY_CREW_PIN || '';
}

function signPayload(payload) {
  const secret = sessionSecret();
  if (!secret) return null;
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  const secret = sessionSecret();
  if (!secret || !token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expect = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function verifyPin(pin) {
  const expected = expectedPin();
  if (!expected || typeof pin !== 'string') return false;
  const a = Buffer.from(String(pin).trim());
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function createSession(companySlug) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  return signPayload({ v: 1, role: 'crew', company_slug: companySlug || null, exp });
}

function parseCookieHeader(header) {
  if (!header) return null;
  const parts = String(header).split(';');
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=');
    if (k === COOKIE_NAME) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function requireCrewSession(req) {
  const token = parseCookieHeader(req.headers.cookie);
  const session = verifyToken(token);
  if (!session || session.role !== 'crew') {
    const err = new Error('unauthorized');
    err.status = 401;
    throw err;
  }
  return session;
}

function sessionCookieHeader(token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/makeready-crew; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}${secure}`;
}

function clearSessionCookieHeader() {
  return `${COOKIE_NAME}=; Path=/makeready-crew; HttpOnly; SameSite=Lax; Max-Age=0`;
}

module.exports = {
  COOKIE_NAME,
  verifyPin,
  createSession,
  verifyToken,
  requireCrewSession,
  sessionCookieHeader,
  clearSessionCookieHeader,
  sessionSecret,
  expectedPin,
};