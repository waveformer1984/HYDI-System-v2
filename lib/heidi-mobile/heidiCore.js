'use strict';

/**
 * Server-side client for heidi-core (:3459) used by the Heidi Mobile BFF.
 *
 * heidi-core's auth middleware allows loopback requests without a secret;
 * when HEIDI_SECRET is configured we send it anyway so the call is
 * authenticated identically off-box. All calls are bounded — the phone must
 * never hang because heidi-core is busy.
 */

const DEFAULT_URL = 'http://localhost:3459';

function coreUrl(env = process.env) {
  return String(env.HEIDI_CORE_URL || DEFAULT_URL).replace(/\/+$/, '');
}

function headers(env = process.env) {
  const h = { 'Content-Type': 'application/json' };
  if (env.HEIDI_SECRET) h['x-heidi-secret'] = env.HEIDI_SECRET;
  return h;
}

async function coreFetch(pathname, { method = 'GET', body, timeoutMs = 8000, env = process.env, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${coreUrl(env)}${pathname}`, {
    method,
    headers: headers(env),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

/** Missions awaiting a human decision (the approval inbox). */
function listPendingMissions(opts = {}) {
  return coreFetch('/missions?state=awaiting_approval&limit=20', opts);
}

/**
 * Record a human approve/reject on a mission. heidi-core stamps the actor
 * `human:<owner>` and writes the mission_events audit row itself — this
 * client adds no authority of its own, it only relays the phone's decision.
 */
function decideMission(id, decision, opts = {}) {
  if (decision !== 'approve' && decision !== 'reject') {
    return Promise.resolve({ ok: false, status: 0, data: null });
  }
  return coreFetch(`/missions/${encodeURIComponent(id)}/${decision}`, {
    method: 'POST', body: { note: 'decided from /heidi mobile' }, timeoutMs: 15000, ...opts,
  });
}

module.exports = { coreUrl, coreFetch, listPendingMissions, decideMission };
