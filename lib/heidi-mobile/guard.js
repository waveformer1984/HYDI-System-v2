'use strict';

/**
 * Request guard shared by every pages/api/heidi-mobile/* route.
 *
 * Order: no-store headers -> method -> CSRF -> rate limit -> session.
 *
 * CSRF: the session cookie is SameSite=Strict, and every state-changing
 * request must additionally carry `x-heidi-request: 1`. A custom header
 * cannot be sent cross-origin without a CORS preflight, and these routes
 * never answer preflights with Access-Control-Allow-* headers, so a hostile
 * page cannot forge one. When the browser sends an Origin header it must
 * also match the Host the request was addressed to.
 */

const { rateLimit } = require('../rate-limit');
const { readSession } = require('./session');
const { createHydiClient } = require('./hydiClient');

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function requestHost(req) {
  const fwd = req.headers['x-forwarded-host'];
  return String(fwd || req.headers.host || '').split(',')[0].trim().toLowerCase();
}

function originMatchesHost(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin GETs and non-browser clients omit it
  try {
    return new URL(origin).host.toLowerCase() === requestHost(req);
  } catch (_) {
    return false;
  }
}

/**
 * @param {object} req
 * @param {object} res
 * @param {object} opts
 * @param {string[]} opts.methods
 * @param {string} opts.routeName
 * @param {number} [opts.rateMax]  per minute per IP (default 60)
 * @param {boolean} [opts.requireSession]  default true
 * @returns {{ok: true, session: object|null, client: object|null}|{ok: false}}
 *   On failure the response has already been written.
 */
function guard(req, res, { methods, routeName, rateMax = 60, requireSession = true }) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (!methods.includes(req.method)) {
    res.setHeader('Allow', methods.join(', '));
    res.status(405).json({ error: 'method_not_allowed' });
    return { ok: false };
  }

  if (MUTATING.has(req.method)) {
    if (req.headers['x-heidi-request'] !== '1' || !originMatchesHost(req)) {
      res.status(403).json({ error: 'csrf_rejected', message: 'Request must come from the Heidi app itself.' });
      return { ok: false };
    }
  } else if (!originMatchesHost(req)) {
    res.status(403).json({ error: 'csrf_rejected', message: 'Cross-origin requests are not accepted.' });
    return { ok: false };
  }

  if (!rateLimit(req, res, { name: `heidi-mobile-${routeName}`, windowMs: 60 * 1000, max: rateMax })) {
    return { ok: false };
  }

  const session = readSession(req);
  if (requireSession && !session) {
    res.status(401).json({ error: 'not_paired', message: 'This phone is not paired with HYDI yet.' });
    return { ok: false };
  }

  const client = session ? createHydiClient({ deviceId: session.deviceId, signingKey: session.signingKey }) : null;
  return { ok: true, session, client };
}

/**
 * Map a failed hydiClient result to the HTTP status the phone should see.
 * Upstream auth failures stay 401/403 so the UI can say "re-pair" or
 * "not permitted"; reachability failures become 502/504 so they are never
 * confused with the phone's own session being invalid.
 */
function upstreamFailureStatus(result) {
  switch (result.kind) {
    case 'unauthorized': return 401;
    case 'forbidden': return 403;
    case 'not_found': return 404;
    case 'rate_limited': return 429;
    case 'client': return 400;
    case 'timeout': return 504;
    case 'unconfigured': return 503;
    default: return 502; // network | server | malformed
  }
}

function sendUpstreamFailure(res, result) {
  res.status(upstreamFailureStatus(result)).json({
    error: result.kind,
    message: result.message,
    reason: result.reason,
  });
}

// Short-lived per-device approval cache for routes whose upstream does not
// itself authenticate (see pages/api/heidi-mobile/chat.js). Revocation still
// takes effect within APPROVAL_TTL_MS; every other route is re-verified by
// HYDI on each request.
const APPROVAL_TTL_MS = 60 * 1000;
const approvalCache = new Map();

async function ensureDeviceApproved(session, client) {
  const cached = approvalCache.get(session.deviceId);
  if (cached && cached.until > Date.now()) return { ok: true };
  const result = await client.request('/api/status/system', { timeoutMs: 8000 });
  if (result.ok) {
    approvalCache.set(session.deviceId, { until: Date.now() + APPROVAL_TTL_MS });
    return { ok: true };
  }
  approvalCache.delete(session.deviceId);
  return result;
}

function resetApprovalCache() {
  approvalCache.clear();
}

module.exports = {
  guard,
  upstreamFailureStatus,
  sendUpstreamFailure,
  ensureDeviceApproved,
  resetApprovalCache,
  originMatchesHost,
};
