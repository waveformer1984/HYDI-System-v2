'use strict';

/**
 * Read-only probe of heidi-agent Phase 2 health (loopback :3462). No execution,
 * no env mutation. Used by GET /api/phone/observe so the phone never needs a
 * route to loopback-only agent bind.
 */

function parseAgentPort(env = process.env) {
  const n = parseInt(env.HEIDI_AGENT_PORT || '3462', 10);
  return Number.isFinite(n) && n > 0 ? n : 3462;
}

function parseBindHost(env = process.env) {
  const h = env.HEIDI_BIND_HOST || '127.0.0.1';
  return h.trim() || '127.0.0.1';
}

/**
 * @returns {Promise<{ reachable: boolean, lease_held?: boolean, cycles?: number|null, allow_exec?: boolean, last_cycle_at?: string|null, reason?: string }>}
 */
async function probeHeidiAgentLoopHealth(env = process.env, fetchFn = global.fetch) {
  if (typeof fetchFn !== 'function') {
    return { reachable: false, reason: 'fetch_unavailable' };
  }
  const host = parseBindHost(env);
  const port = parseAgentPort(env);
  const url = `http://${host}:${port}/health`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetchFn(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) {
      return { reachable: false, reason: `http_${res.status}` };
    }
    const body = await res.json();
    if (!body || typeof body !== 'object') {
      return { reachable: false, reason: 'invalid_json' };
    }
    return {
      reachable: true,
      lease_held: Boolean(body.lease_held),
      cycles: typeof body.cycles === 'number' ? body.cycles : null,
      allow_exec: Boolean(body.allow_exec),
      last_cycle_at: typeof body.last_cycle_at === 'string' ? body.last_cycle_at : null,
    };
  } catch (err) {
    const msg = err && typeof err === 'object' && 'name' in err && err.name === 'AbortError'
      ? 'timeout'
      : 'unreachable';
    return { reachable: false, reason: msg };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { probeHeidiAgentLoopHealth, parseAgentPort, parseBindHost };