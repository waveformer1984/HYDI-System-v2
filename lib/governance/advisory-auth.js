'use strict';

/**
 * Guards for heidi-agent's advisory server (approve / reject / feedback).
 *
 * Before this module, those endpoints had no authentication, listened on
 * every interface and sent `Access-Control-Allow-Origin: *`, so anything on
 * the LAN or tailnet — or any web page open in a browser on Frank — could
 * approve and execute a task. And a human approval ran the task even with
 * HEIDI_ALLOW_EXEC off or Heidi paused.
 *
 * Rules:
 * - Every /api route needs `Authorization: Bearer <HEIDI_ADMIN_TOKEN>`
 *   (timing-safe compare). With no token configured the server refuses
 *   everything (503) rather than running open.
 * - Bind address defaults to 127.0.0.1 (HEIDI_BIND_HOST overrides).
 * - CORS is off by default; HEIDI_ADVISORY_ALLOWED_ORIGINS (comma list)
 *   names the origins (e.g. Ursula's) that may call from a browser.
 * - A human approval replaces only the confidence/bounds judgement. It
 *   never overrides HEIDI_ALLOW_EXEC, the pause kill switch, or the
 *   action registry.
 */

const crypto = require('crypto');
const { isRegisteredAction } = require('./action-registry');

const DEFAULT_BIND_HOST = '127.0.0.1';

function tokenMatches(presented, expected) {
  const a = crypto.createHash('sha256').update(String(presented)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

/** @returns {{ ok: boolean, status?: number, error?: string }} */
function checkAdvisoryAuth(req, env = process.env) {
  const expected = env.HEIDI_ADMIN_TOKEN || '';
  if (!expected) return { ok: false, status: 503, error: 'admin_token_not_configured' };
  const header = String((req.headers && req.headers.authorization) || '');
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!presented || !tokenMatches(presented, expected)) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }
  return { ok: true };
}

/** The origin to echo in Access-Control-Allow-Origin, or null for none. */
function allowedCorsOrigin(req, env = process.env) {
  const origin = req.headers && req.headers.origin;
  if (!origin) return null;
  const allowed = String(env.HEIDI_ADVISORY_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

function bindHost(env = process.env) {
  return (env.HEIDI_BIND_HOST || '').trim() || DEFAULT_BIND_HOST;
}

function isTruthy(v) {
  return v === true || v === 'true' || v === '1' || v === 1;
}

/**
 * May a human-approved task execute?
 * @returns {{ allowed: boolean, gate?: string, reason: string }}
 */
function authorizeHumanApproval({ task, env = process.env, paused = false }) {
  if (!isTruthy(env.HEIDI_ALLOW_EXEC)) {
    return { allowed: false, gate: 'exec_flag', reason: 'HEIDI_ALLOW_EXEC not set' };
  }
  if (paused) {
    return { allowed: false, gate: 'pause', reason: 'Heidi is paused (HEIDI_PAUSE)' };
  }
  if (!task || !isRegisteredAction(task.type)) {
    return { allowed: false, gate: 'action_registry', reason: `Unregistered action type: ${(task && task.type) || '(none)'}` };
  }
  return { allowed: true, reason: 'human approval' };
}

module.exports = {
  DEFAULT_BIND_HOST,
  checkAdvisoryAuth,
  allowedCorsOrigin,
  bindHost,
  authorizeHumanApproval,
};
