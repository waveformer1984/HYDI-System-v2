'use strict';

/**
 * GET /api/phone/revenue-summary — livemode-only revenue for the phone.
 * Bearer HYDI_PHONE_READ_TOKEN. The token grants this one read and nothing
 * else: no other route accepts it, and this route only reads.
 */

const crypto = require('crypto');
const { liveRevenueSummary } = require('./live-summary');

const WINDOW_MS = 60 * 1000;
const LIMIT = 20;
const hits = [];

function tokenMatches(presented, expected) {
  const a = crypto.createHash('sha256').update(String(presented)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

function rateLimited(now) {
  while (hits.length && now - hits[0] > WINDOW_MS) hits.shift();
  if (hits.length >= LIMIT) return true;
  hits.push(now);
  return false;
}

function createPhoneRevenueHandler(deps = {}) {
  const env = deps.env || process.env;
  const store = deps.store || (() => require('./http').getBillingService().store);
  const now = deps.now || (() => Date.now());
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    const expected = env.HYDI_PHONE_READ_TOKEN || '';
    if (!expected) return res.status(503).json({ error: 'phone_read_token_not_configured' });
    const header = String(req.headers.authorization || '');
    const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!presented || !tokenMatches(presented, expected)) return res.status(401).json({ error: 'unauthorized' });
    if (rateLimited(now())) return res.status(429).json({ error: 'rate_limited' });
    try {
      const summary = await liveRevenueSummary(store(), { now: () => new Date(now()) });
      return res.status(200).json({ ok: true, summary });
    } catch {
      return res.status(503).json({ ok: false, error: 'revenue_store_unavailable' });
    }
  };
}

function resetRateLimit() {
  hits.length = 0;
}

module.exports = { createPhoneRevenueHandler, resetRateLimit };
