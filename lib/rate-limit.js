'use strict';

/**
 * In-memory fixed-window rate limiter for Next.js API routes.
 *
 * This deployment runs as a single long-lived Node process (`next dev` /
 * `next start`) -- Vercel's serverless deploy is dormant and unused (see
 * CLAUDE.md's Local-First Architecture section), and there's no PM2/cluster
 * or Redis in this stack. An in-memory Map is therefore correct here: state
 * isn't fragmented across instances, and it stays valid for as long as this
 * assumption holds.
 */

const buckets = new Map();

function getClientIp(req) {
  const xff = req.headers && req.headers['x-forwarded-for'];
  if (xff) {
    return String(xff).split(',')[0].trim();
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

/**
 * Enforce a per-IP, per-route request budget.
 *
 * @param {object} req
 * @param {object} res
 * @param {object} opts
 * @param {string} opts.name      route identifier, namespaces the bucket key
 * @param {number} opts.windowMs  window length in milliseconds
 * @param {number} opts.max       max requests allowed per window
 * @returns {boolean} true if the request may proceed. false means this
 *   function has already written a 429 response -- the caller must return
 *   immediately without sending its own response.
 */
function rateLimit(req, res, { name, windowMs, max }) {
  const key = `${name}:${getClientIp(req)}`;
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= max) {
    const retryAfterSeconds = Math.ceil((bucket.resetAt - now) / 1000);
    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.status(429).json({ error: 'Too many requests', retryAfterSeconds });
    return false;
  }

  bucket.count += 1;
  return true;
}

// Sweep expired buckets periodically so the Map doesn't grow unbounded over
// this process's lifetime. unref() so the timer never keeps the process alive.
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}, CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

/** Test-only: clear all bucket state between test cases. */
function __reset() {
  buckets.clear();
}

module.exports = { rateLimit, getClientIp, __reset };
