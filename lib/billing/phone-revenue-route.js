'use strict';

/**
 * GET /api/phone/revenue-summary — livemode-only revenue for the phone.
 * Bearer HYDI_PHONE_READ_TOKEN (lib/phone/read-auth.js). The token grants
 * the phone's read-only routes and nothing else, and this route only reads.
 */

const { liveRevenueSummary } = require('./live-summary');
const { createRateLimiter, checkPhoneRead } = require('../phone/read-auth');

const limiter = createRateLimiter({ windowMs: 60 * 1000, limit: 20 });

function createPhoneRevenueHandler(deps = {}) {
  const env = deps.env || process.env;
  const store = deps.store || (() => require('./http').getBillingService().store);
  const now = deps.now || (() => Date.now());
  return async function handler(req, res) {
    if (!checkPhoneRead(req, res, { env, limiter, now })) return undefined;
    try {
      const summary = await liveRevenueSummary(store(), { now: () => new Date(now()) });
      return res.status(200).json({ ok: true, summary });
    } catch {
      return res.status(503).json({ ok: false, error: 'revenue_store_unavailable' });
    }
  };
}

function resetRateLimit() {
  limiter.reset();
}

module.exports = { createPhoneRevenueHandler, resetRateLimit };
