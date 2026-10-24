'use strict';

const { createHash, timingSafeEqual } = require('crypto');
const net = require('net');

const WINDOW_MS = 60_000;
const LIMIT = 5;
const buckets = new Map();

function tokenMatches(presented, expected) {
  const left = createHash('sha256').update(String(presented)).digest();
  const right = createHash('sha256').update(String(expected)).digest();
  return timingSafeEqual(left, right);
}

function normalizeIp(value) {
  let ip = String(value || '').trim().toLowerCase();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

function isPairingNetwork(ip) {
  const normalized = normalizeIp(ip);
  if (normalized === '::1') return true;
  if (net.isIP(normalized) !== 4) return false;
  const parts = normalized.split('.').map(Number);
  return parts[0] === 127
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
}

function rateLimited(ip, now) {
  const recent = (buckets.get(ip) || []).filter((time) => now - time < WINDOW_MS);
  if (recent.length >= LIMIT) {
    buckets.set(ip, recent);
    return true;
  }
  recent.push(now);
  buckets.set(ip, recent);
  return false;
}

function safeAuditIp(ip) {
  return String(ip || 'unknown').replace(/[^a-fA-F0-9:.]/g, '').slice(0, 64) || 'unknown';
}

function createPhonePairHandler(deps = {}) {
  const env = deps.env || process.env;
  const now = deps.now || (() => Date.now());
  const logger = deps.logger || console;
  return function phonePairHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const ip = normalizeIp(req.socket && req.socket.remoteAddress);
    let result = 'denied';
    const audit = () => logger.info(`[phone-pair] ${new Date(now()).toISOString()} ip=${safeAuditIp(ip)} result=${result}`);

    if (!isPairingNetwork(ip)) {
      audit();
      return res.status(404).json({ error: 'not_found' });
    }
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      audit();
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    if (rateLimited(ip, now())) {
      audit();
      return res.status(429).json({ error: 'rate_limited' });
    }
    const expected = String(env.HYDI_BOARD_HUMAN_TOKEN || '');
    const authorization = String(req.headers.authorization || '');
    const presented = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    if (!expected || !presented || !tokenMatches(presented, expected)) {
      audit();
      return res.status(401).json({ error: 'unauthorized' });
    }
    const token = String(env.HYDI_PHONE_READ_TOKEN || '');
    if (!token) {
      audit();
      return res.status(503).json({ error: 'phone_read_token_not_configured' });
    }
    result = 'ok';
    audit();
    return res.status(200).json({ token });
  };
}

function resetPhonePairRateLimit() {
  buckets.clear();
}

module.exports = {
  createPhonePairHandler,
  isPairingNetwork,
  normalizeIp,
  resetPhonePairRateLimit,
  tokenMatches,
};
