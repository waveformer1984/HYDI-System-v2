'use strict';

const crypto = require('crypto');
const { isReplayed, markConsumed } = require('./replay-cache');

function workerSecrets(env = process.env) {
  const current = env.HYDI_DISTRIBUTED_WORKER_SECRET || env.HYDI_SERVICE_SECRET || null;
  const previous = env.HYDI_DISTRIBUTED_WORKER_SECRET_PREVIOUS || null;
  return { current, previous };
}

function signWorkerToken(workerId, env = process.env, { jti = crypto.randomBytes(16).toString('hex') } = {}) {
  const { current: secret } = workerSecrets(env);
  if (!secret) return null;
  const ts = Math.floor(Date.now() / 1000);
  const payload = `${workerId}:${ts}:${jti}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `v2:${payload}:${sig}`;
}

function verifySignature(payload, sig, env = process.env) {
  const { current, previous } = workerSecrets(env);
  const keys = [current, previous].filter(Boolean);
  for (const secret of keys) {
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    if (sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return { ok: true, key: secret === current ? 'current' : 'previous' };
    }
  }
  return { ok: false, reason: 'bad_signature' };
}

function parseToken(token) {
  if (!token || typeof token !== 'string') return { format: 'invalid' };
  if (token.startsWith('v2:')) {
    const parts = token.slice(3).split(':');
    if (parts.length !== 4) return { format: 'invalid' };
    const [workerId, ts, jti, sig] = parts;
    return { format: 'v2', workerId, ts, jti, sig, payload: `${workerId}:${ts}:${jti}` };
  }
  const parts = token.split(':');
  if (parts.length === 3) {
    const [workerId, ts, sig] = parts;
    const jti = crypto.createHash('sha256').update(`v1:${workerId}:${ts}:${sig}`).digest('hex').slice(0, 32);
    return { format: 'v1', workerId, ts, jti, sig, payload: `${workerId}:${ts}` };
  }
  return { format: 'invalid' };
}

/**
 * Verify worker token. Optional replay check requires mutable state (inside store transaction).
 */
function verifyWorkerToken(token, env = process.env, state = null) {
  const parsed = parseToken(token);
  if (parsed.format === 'invalid') return { ok: false, reason: 'malformed', classification: 'auth_malformed' };

  const skew = Math.abs(Date.now() / 1000 - Number(parsed.ts));
  const maxSkew = Number(env.HYDI_DISTRIBUTED_AUTH_SKEW_SEC || 120);
  if (!Number.isFinite(skew) || skew > maxSkew) {
    return { ok: false, reason: 'stale', classification: 'auth_expired' };
  }

  const sig = verifySignature(parsed.payload, parsed.sig, env);
  if (!sig.ok) return { ok: false, reason: sig.reason, classification: 'auth_bad_signature' };

  if (state && isReplayed(state, parsed.jti)) {
    return { ok: false, reason: 'replay', classification: 'auth_replay' };
  }

  return {
    ok: true,
    workerId: parsed.workerId,
    jti: parsed.jti,
    format: parsed.format,
    classification: 'auth_ok',
  };
}

function consumeWorkerToken(state, token, env = process.env, retentionMs) {
  const v = verifyWorkerToken(token, env, state);
  if (!v.ok) return v;
  markConsumed(state, v.jti, Date.now(), retentionMs);
  return v;
}

module.exports = {
  workerSecrets,
  signWorkerToken,
  verifyWorkerToken,
  consumeWorkerToken,
  parseToken,
  verifySignature,
};