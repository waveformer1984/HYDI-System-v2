'use strict';

/**
 * Turns one scripts/watchdog.js check cycle into subsystem heartbeats for
 * api/heartbeat.js, and posts them. Nothing else on the HYDI host sends
 * heartbeats, so without this every subsystem reads "unknown" and the phone
 * shows health 0/100 while the watchdog logs "all endpoints healthy".
 *
 * Mapping (watchdog result name -> subsystem):
 *   hydi_core  protoforge-core (critical if down), heidi-web (degraded if
 *              not HEALTHY; if it is down the POST itself fails and the
 *              heartbeat goes stale -> offline, which is the truth)
 *   database   supabase_db (critical if down), supabase_rest / supabase_kong
 *              (degraded if down)
 *   memory     supabase_db (pgvector store; critical if down), ollama
 *              (embeddings; degraded if down)
 * A subsystem whose inputs are all missing from the cycle is not reported.
 */

const crypto = require('crypto');

const RULES = {
  hydi_core: { critical: ['protoforge-core'], degraded: ['heidi-web'] },
  database: { critical: ['supabase_db'], degraded: ['supabase_rest', 'supabase_kong'] },
  memory: { critical: ['supabase_db'], degraded: ['ollama'] },
};

function isUp(r) {
  if (!r || !r.ok) return false;
  // Endpoints carry a verdict state; alive-but-DEGRADED counts as degraded.
  return !r.state || r.state === 'HEALTHY' || typeof r.state === 'number';
}

/** @param {Array<{name:string, ok:boolean, state?:string}>} results */
function deriveHeartbeats(results) {
  const byName = new Map((results || []).map((r) => [r.name, r]));
  const beats = [];
  for (const [subsystem, rule] of Object.entries(RULES)) {
    const inputs = [...rule.critical, ...rule.degraded].filter((n) => byName.has(n));
    if (!inputs.length) continue;
    const down = inputs.filter((n) => !isUp(byName.get(n)));
    let status = 'healthy';
    if (down.some((n) => rule.critical.includes(n))) status = 'critical';
    else if (down.length) status = 'degraded';
    beats.push({
      subsystem,
      status,
      metadata: {
        source: 'watchdog',
        checks: Object.fromEntries(inputs.map((n) => {
          const r = byName.get(n);
          return [n, r.ok ? (r.state || 'ok') : (r.state || 'down')];
        })),
      },
    });
  }
  return beats;
}

function serviceToken(secret, now = Date.now()) {
  const ts = String(now);
  const requestId = crypto.randomBytes(6).toString('hex');
  const service = 'watchdog';
  const sig = crypto.createHmac('sha256', secret).update(`${ts}:${requestId}:${service}`).digest('hex');
  return `${ts}.${requestId}.${service}.${sig}`;
}

/**
 * POST each heartbeat. Never throws; returns per-subsystem outcomes.
 * @param {ReturnType<typeof deriveHeartbeats>} beats
 * @param {{baseUrl:string, secret:string, fetchImpl?:typeof fetch, timeoutMs?:number}} opts
 */
async function postHeartbeats(beats, { baseUrl, secret, fetchImpl = globalThis.fetch, timeoutMs = 5000 }) {
  if (!secret) return beats.map((b) => ({ subsystem: b.subsystem, ok: false, error: 'HYDI_SERVICE_SECRET not set' }));
  const url = `${String(baseUrl).replace(/\/+$/, '')}/api/heartbeat`;
  return Promise.all(beats.map(async (b) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hydi-service-token': serviceToken(secret) },
        body: JSON.stringify(b),
        signal: ctrl.signal,
      });
      return { subsystem: b.subsystem, ok: res.ok, status: res.status };
    } catch (e) {
      return { subsystem: b.subsystem, ok: false, error: e && e.message ? e.message : String(e) };
    } finally {
      clearTimeout(timer);
    }
  }));
}

module.exports = { deriveHeartbeats, postHeartbeats, serviceToken, RULES };
