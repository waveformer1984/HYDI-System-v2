'use strict';

/**
 * Server-side HYDI client for the Heidi Mobile backend-for-frontend.
 *
 * Every request is signed with the per-device HMAC token scheme that
 * lib/auth/requireAuth.js already verifies (x-hydi-device-token, built by
 * lib/auth/deviceAuth.js#signDeviceToken). That keeps HYDI as the single
 * authority: device approval, revocation, RBAC role, rate limiting and the
 * auth_audit_log all apply to the phone exactly as they would to any other
 * paired device. Nothing here grants authority of its own.
 *
 * Failures are classified rather than thrown, so each route can report a
 * truthful state to the phone instead of a generic "error":
 *   unconfigured | network | timeout | unauthorized | forbidden |
 *   not_found | rate_limited | client | server | malformed
 */

const { signDeviceToken } = require('../auth/deviceAuth');

const DEFAULT_TIMEOUT_MS = 10000;

function resolveBaseUrl() {
  const raw = process.env.HYDI_API_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url.origin + url.pathname.replace(/\/+$/, '');
}

function classifyStatus(status) {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'client';
}

/** Trim upstream error text so internal detail doesn't flood the phone. */
function safeMessage(value) {
  if (typeof value !== 'string') return undefined;
  return value.length > 300 ? `${value.slice(0, 300)}…` : value;
}

/**
 * @param {object} opts
 * @param {string} opts.deviceId
 * @param {string} opts.signingKey
 * @param {string} [opts.baseUrl]   overrides HYDI_API_URL (tests)
 * @param {Function} [opts.fetchImpl]
 */
function createHydiClient({ deviceId, signingKey, baseUrl, fetchImpl } = {}) {
  const base = baseUrl || resolveBaseUrl();
  const doFetch = fetchImpl || globalThis.fetch;

  function headers(extra) {
    const h = { Accept: 'application/json', ...(extra || {}) };
    if (deviceId && signingKey) h['x-hydi-device-token'] = signDeviceToken(deviceId, signingKey);
    return h;
  }

  /**
   * Low-level call that returns the raw Response (for streaming routes).
   * @returns {Promise<{ok: true, response: Response}|{ok: false, kind: string, status?: number, message: string}>}
   */
  async function raw(path, { method = 'GET', body, signal, timeoutMs = DEFAULT_TIMEOUT_MS, extraHeaders } = {}) {
    if (!base) {
      return { ok: false, kind: 'unconfigured', message: 'HYDI_API_URL is not a valid http(s) URL' };
    }
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const onAbort = () => controller.abort();
    // The caller's signal must stay linked for as long as the body is being
    // read (streaming routes), so it is only unhooked by release(), which the
    // caller invokes once it is done with the response. clearTimer() stops
    // just the timeout (e.g. a connect timeout on a long-lived stream).
    const clearTimer = () => clearTimeout(timer);
    const cleanup = () => {
      clearTimer();
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const init = { method, headers: headers(extraHeaders), signal: controller.signal };
      if (body !== undefined) {
        init.body = JSON.stringify(body);
        init.headers['Content-Type'] = 'application/json';
      }
      const response = await doFetch(`${base}${path}`, init);
      return { ok: true, response, clearTimer, release: cleanup, timedOut: () => timedOut };
    } catch (err) {
      cleanup();
      if (timedOut) return { ok: false, kind: 'timeout', message: `HYDI did not respond within ${Math.round(timeoutMs / 1000)}s` };
      if (signal && signal.aborted) return { ok: false, kind: 'aborted', message: 'Request cancelled' };
      return { ok: false, kind: 'network', message: 'HYDI is unreachable' };
    }
  }

  /**
   * JSON request/response.
   * @returns {Promise<{ok: true, status: number, data: any, latencyMs: number}|{ok: false, kind: string, status?: number, message: string, reason?: string, latencyMs: number}>}
   */
  async function request(path, opts = {}) {
    const started = Date.now();
    const r = await raw(path, opts);
    if (!r.ok) return { ...r, latencyMs: Date.now() - started };
    const { response } = r;
    let text;
    try {
      text = await response.text();
    } catch (_) {
      r.release();
      if (r.timedOut()) return { ok: false, kind: 'timeout', message: 'HYDI response timed out', latencyMs: Date.now() - started };
      return { ok: false, kind: 'network', message: 'HYDI connection dropped mid-response', latencyMs: Date.now() - started };
    }
    r.release();
    const latencyMs = Date.now() - started;

    let data = null;
    let parsed = true;
    if (text) {
      try { data = JSON.parse(text); } catch (_) { parsed = false; }
    }

    if (!response.ok) {
      const errBody = parsed && data && typeof data === 'object' ? data : {};
      return {
        ok: false,
        kind: classifyStatus(response.status),
        status: response.status,
        message: safeMessage(errBody.error) || `HYDI returned HTTP ${response.status}`,
        reason: safeMessage(errBody.reason),
        latencyMs,
      };
    }
    if (!parsed || data === null || typeof data !== 'object') {
      return { ok: false, kind: 'malformed', status: response.status, message: 'HYDI returned a response that is not valid JSON', latencyMs };
    }
    return { ok: true, status: response.status, data, latencyMs };
  }

  return { request, raw, baseUrl: base };
}

module.exports = { createHydiClient, resolveBaseUrl, classifyStatus, DEFAULT_TIMEOUT_MS };
