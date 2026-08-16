/**
 * Shared CORS helpers for HYDI API routes.
 *
 * Reads MOBILE_CHAT_ORIGIN from the environment. Defaults to
 * http://localhost:3000 for local development. A value of '*' restores the
 * legacy wildcard behavior for webhooks and other public surfaces; it is not
 * recommended for authenticated/mobile endpoints.
 */

const DEFAULT_ORIGIN = 'http://localhost:3000';

function getAllowedOrigin() {
  return process.env.MOBILE_CHAT_ORIGIN || DEFAULT_ORIGIN;
}

function isOriginAllowed(origin, allowed) {
  if (allowed === '*') {
    return true;
  }
  // Missing origin header usually means same-origin or non-browser; allow it
  // but still validate when an origin is explicitly supplied.
  if (!origin) {
    return true;
  }
  return origin === allowed;
}

/**
 * Apply CORS headers and return a boolean indicating whether the request
 * should proceed. If it returns false, the response has already been ended.
 */
function handleCors(req, res, options = {}) {
  const allowed = options.allowedOrigin || getAllowedOrigin();
  const methods = options.allowedMethods || 'POST, OPTIONS';
  const origin = req.headers?.origin || req.headers?.Origin;

  const allowedOrigin = allowed === '*' ? '*' : origin;

  if (req.method === 'OPTIONS') {
    if (!isOriginAllowed(origin, allowed)) {
      if (typeof res.status === 'function') {
        res.status(403).json({ error: 'Origin not allowed' });
      } else {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'Origin not allowed' }));
      }
      return false;
    }
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', methods);
    res.setHeader('Access-Control-Allow-Headers', options.allowedHeaders || 'Content-Type, Authorization');
    res.setHeader('Vary', 'Origin');
    if (typeof res.status === 'function') {
      res.status(200).end();
    } else {
      res.statusCode = 200;
      res.end();
    }
    return false;
  }

  if (!isOriginAllowed(origin, allowed)) {
    res.setHeader('Content-Type', 'application/json');
    if (typeof res.status === 'function') {
      res.status(403).json({ error: 'Origin not allowed' });
    } else {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: 'Origin not allowed' }));
    }
    return false;
  }

  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', options.allowedHeaders || 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
  return true;
}

module.exports = {
  DEFAULT_ORIGIN,
  getAllowedOrigin,
  isOriginAllowed,
  handleCors,
};
