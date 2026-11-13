'use strict';

/**
 * Shared listen/CORS helpers for local HTTP services (heidi-core, mobile, sync).
 * Mirrors heidi-agent advisory hardening: loopback-by-default bind, no CORS *,
 * fail loudly on EADDRINUSE.
 */

const { bindHost, allowedCorsOrigin } = require('./advisory-auth');
const { logSafe } = require('./log-safe');

function attachListenErrorHandler(server, { label = 'http', host, port, onFatal } = {}) {
  server.on('error', (error) => {
    const code = error && error.code;
    console.error(
      `[${logSafe(label)}] listen error on ${logSafe(host)}:${logSafe(port)}:`,
      logSafe(code || ''),
      logSafe(error && error.message ? error.message : ''),
    );
    if (typeof onFatal === 'function') onFatal(error);
    else process.exit(1);
  });
}

function listenWithGuard(server, { port, host, label, onFatal } = {}) {
  const h = host || bindHost(process.env);
  attachListenErrorHandler(server, { label, host: h, port, onFatal });
  server.listen(port, h);
  return h;
}

/**
 * Express middleware: echo Access-Control-Allow-Origin only for listed origins.
 * @param {string} [originsEnv] env var name (comma-separated origins)
 */
function expressAllowedCorsMiddleware(originsEnv = 'HEIDI_ALLOWED_ORIGINS') {
  return (req, res, next) => {
    const env = { ...process.env, HEIDI_ADVISORY_ALLOWED_ORIGINS: process.env[originsEnv] || process.env.HEIDI_ADVISORY_ALLOWED_ORIGINS || '' };
    const origin = allowedCorsOrigin(req, env);
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-heidi-secret, x-hydi-service-token, x-hydi-device-token');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(origin ? 204 : 403);
    }
    next();
  };
}

/** Mobile chat may bind all interfaces when device login is configured. */
function mobileBindHost(env = process.env) {
  const explicit = String(env.HEIDI_MOBILE_BIND_HOST || '').trim();
  if (explicit) return explicit;
  if (env.HEIDI_MOBILE_TOKEN) return '0.0.0.0';
  return bindHost(env);
}

module.exports = {
  attachListenErrorHandler,
  listenWithGuard,
  expressAllowedCorsMiddleware,
  mobileBindHost,
};
