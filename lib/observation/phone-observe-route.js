'use strict';

/**
 * GET /api/phone/observe — the combined Frank snapshot for the phone and
 * any read-only client. Bearer HYDI_PHONE_READ_TOKEN. Reads evidence files
 * only (lib/observation/frank-snapshot.js); never runs a command. Not on the
 * public-ingress allowlist, so it answers only from this PC, LAN or tailnet.
 */

const fs = require('fs');
const path = require('path');
const { buildFrankSnapshot } = require('./frank-snapshot');
const { createRateLimiter, checkPhoneRead } = require('../phone/read-auth');

const limiter = createRateLimiter({ windowMs: 60 * 1000, limit: 30 });

function fixListSummary(root) {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(root, '.runtime', 'fixlist', 'current.json'), 'utf8'));
    if (!list || !Array.isArray(list.items)) return null;
    return {
      generatedAt: list.generatedAt || null,
      counts: list.counts || {},
      top: list.items.slice(0, 3).map((i) => ({ level: i.level, kind: i.kind, subject: i.subject, detail: i.detail })),
    };
  } catch { return null; }
}

function createPhoneObserveHandler(deps = {}) {
  const env = deps.env || process.env;
  const now = deps.now || (() => Date.now());
  // heidi-web runs from the repo root (ecosystem.config.js cwd), and inside
  // the Next build __dirname no longer points into the repo, so resolve the
  // evidence files from cwd like /api/heidi-health does.
  const root = deps.root || process.cwd();
  const build = deps.build || ((t) => buildFrankSnapshot({ root, now: t }));
  return async function handler(req, res) {
    if (!checkPhoneRead(req, res, { env, limiter, now })) return undefined;
    try {
      return res.status(200).json({ ok: true, snapshot: build(now()), fixList: fixListSummary(root) });
    } catch {
      return res.status(503).json({ ok: false, error: 'snapshot_unavailable' });
    }
  };
}

function resetRateLimit() {
  limiter.reset();
}

module.exports = { createPhoneObserveHandler, resetRateLimit };
