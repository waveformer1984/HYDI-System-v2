'use strict';

/**
 * Server-side client for heidi-agent advisory API (pending / approve / reject / feedback).
 * Ursula and other callers must use this — never expose HEIDI_ADMIN_TOKEN to the browser.
 */

const http = require('http');

function advisoryBaseUrl(env = process.env) {
  const fromEnv = String(env.HEIDI_ADVISORY_URL || '').trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const { bindHost } = require('./advisory-auth');
  const host = bindHost(env);
  const port = env.HEIDI_ADVISORY_PORT || '3461';
  return `http://${host}:${port}`;
}

function adminToken(env = process.env) {
  return String(env.HEIDI_ADMIN_TOKEN || '');
}

/**
 * @returns {Promise<{ ok: boolean, status: number, body: string, json?: object }>}
 */
const ADVISORY_PATH =
  /^\/api\/(decisions\/(pending|[A-Za-z0-9_-]{1,128}\/(approve|reject))|feedback\/[A-Za-z0-9_-]{1,128})$/;

function assertAdvisoryPath(path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (/[\r\n\u0000]/.test(p) || p.includes('..')) return null;
  return ADVISORY_PATH.test(p) ? p : null;
}

function advisoryRequest(path, { method = 'GET', body, env = process.env, timeoutMs = 15000 } = {}) {
  const token = adminToken(env);
  if (!token) {
    return Promise.resolve({ ok: false, status: 503, body: JSON.stringify({ error: 'admin_token_not_configured' }) });
  }

  const safePath = assertAdvisoryPath(path);
  if (!safePath) {
    return Promise.resolve({ ok: false, status: 400, body: JSON.stringify({ error: 'invalid_advisory_path' }) });
  }

  const url = new URL(safePath, `${advisoryBaseUrl(env)}/`);
  const payload = body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;

  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let json;
          try { json = JSON.parse(data); } catch (_) { /* non-json */ }
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode || 0, body: data, json });
        });
      },
    );
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, body: 'timeout' }); });
    req.on('error', (e) => resolve({ ok: false, status: 0, body: e.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = {
  advisoryBaseUrl,
  adminToken,
  advisoryRequest,
};
