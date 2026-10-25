'use strict';

/**
 * HYDI_PHONE_READ_TOKEN check shared by the phone's read-only routes
 * (GET /api/phone/revenue-summary, GET /api/phone/observe). The token
 * grants those reads and nothing else; no route that changes state
 * accepts it.
 */

const crypto = require('crypto');

function tokenMatches(presented, expected) {
  const a = crypto.createHash('sha256').update(String(presented)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Sliding-window limiter; each route gets its own. */
function createRateLimiter({ windowMs = 60 * 1000, limit = 20 } = {}) {
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

/**
 * Applies method, token and rate checks. Returns true when the handler may
 * continue; otherwise it has already answered.
 */
function checkPhoneRead(req, res, { env, limiter, now }) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return false;
  }
  const expected = env.HYDI_PHONE_READ_TOKEN || '';
  if (!expected) {
    res.status(503).json({ error: 'phone_read_token_not_configured' });
    return false;
  }
  const header = String(req.headers.authorization || '');
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!presented || !tokenMatches(presented, expected)) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  if (limiter.limited(now())) {
    res.status(429).json({ error: 'rate_limited' });
    return false;
  }
  return true;
}

module.exports = { tokenMatches, createRateLimiter, checkPhoneRead };
