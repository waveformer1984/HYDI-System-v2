'use strict';

/**
 * GET /api/phone/pair — hands the phone its HYDI_PHONE_READ_TOKEN so no
 * human ever copies it.
 *
 * Auth: Bearer HYDI_BOARD_HUMAN_TOKEN (the human-side token the phone
 * already holds). Answers only on loopback, the LAN (192.168.0.0/16),
 * or Tailscale (100.64.0.0/10); a forwarded hop fails closed since the
 * real peer is then unverifiable. The token is never logged — the audit
 * line records the peer address and time only.
 */

const crypto = require('crypto');

const WINDOW_MS = 60 * 1000;
const LIMIT = 10;
const hits = [];

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

function normalizeIp(remote) {
  const v = String(remote || '').trim().toLowerCase();
  return v.startsWith('::ffff:') ? v.slice(7) : v;
}

function allowedNetwork(remote) {
  const norm = normalizeIp(remote);
  if (LOOPBACK.has(norm) || LOOPBACK.has(String(remote || '').toLowerCase())) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(norm);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a > 255 || b > 255 || Number(m[3]) > 255 || Number(m[4]) > 255) return false;
  if (a === 192 && b === 168) return true;              // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true;    // 100.64.0.0/10 (Tailscale)
  return false;
}

function peerIsAllowed(req) {
  const headers = (req && req.headers) || {};
  if (headers['x-forwarded-for'] || headers['x-real-ip'] || headers.forwarded) return false;
  const socket = (req && (req.socket || req.connection)) || {};
  return allowedNetwork(socket.remoteAddress);
}

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

function createPhonePairHandler(deps = {}) {
  const env = deps.env || process.env;
  const now = deps.now || (() => Date.now());
  const log = deps.log || ((line) => console.log(line));
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    const remote = String((req.socket || req.connection || {}).remoteAddress || 'unknown');
    if (!peerIsAllowed(req)) {
      log(`[phone-pair] refused peer=${remote} reason=network`);
      return res.status(403).json({ error: 'forbidden' });
    }
    const expected = env.HYDI_BOARD_HUMAN_TOKEN || '';
    if (!expected) return res.status(503).json({ error: 'board_human_token_not_configured' });
    const readToken = env.HYDI_PHONE_READ_TOKEN || '';
    if (!readToken) return res.status(503).json({ error: 'phone_read_token_not_configured' });
    const header = String(req.headers.authorization || '');
    const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!presented || !tokenMatches(presented, expected)) {
      log(`[phone-pair] refused peer=${remote} reason=auth`);
      return res.status(401).json({ error: 'unauthorized' });
    }
    if (rateLimited(now())) return res.status(429).json({ error: 'rate_limited' });
    log(`[phone-pair] issued phone-read credential peer=${remote} at=${new Date(now()).toISOString()}`);
    return res.status(200).json({ token: readToken });
  };
}

function resetRateLimit() {
  hits.length = 0;
}

module.exports = { createPhonePairHandler, resetRateLimit, allowedNetwork, normalizeIp };
