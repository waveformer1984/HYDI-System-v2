'use strict';

const crypto = require('crypto');

/**
 * Home workers authenticate outbound with a shared HMAC secret (never logged).
 */
function workerSecret(env = process.env) {
  return env.HYDI_DISTRIBUTED_WORKER_SECRET || env.HYDI_SERVICE_SECRET || null;
}

function signWorkerToken(workerId, env = process.env) {
  const secret = workerSecret(env);
  if (!secret) return null;
  const ts = Math.floor(Date.now() / 1000);
  const payload = `${workerId}:${ts}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}:${sig}`;
}

function verifyWorkerToken(token, env = process.env) {
  const secret = workerSecret(env);
  if (!secret || !token || typeof token !== 'string') return { ok: false, reason: 'missing_token' };
  const parts = token.split(':');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [workerId, ts, sig] = parts;
  const skew = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(skew) || skew > 600) return { ok: false, reason: 'stale' };
  const expected = crypto.createHmac('sha256', secret).update(`${workerId}:${ts}`).digest('hex');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return { ok: false, reason: 'bad_signature' };
  }
  return { ok: true, workerId };
}

module.exports = { workerSecret, signWorkerToken, verifyWorkerToken };