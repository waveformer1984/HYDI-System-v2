'use strict';

// Deliberately excludes the empty string: an unknown peer address is not
// evidence of a local connection, so it must fail closed.
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);
const LOOPBACK_HOSTS = new Set([...LOOPBACK, '', '0.0.0.0', '[::1]']);

function normalize(address) {
  if (!address) return '';
  const value = String(address).trim().toLowerCase();
  if (value.startsWith('::ffff:')) return value;
  return value;
}

/**
 * True only when the request originated from the machine running the server.
 *
 * The cockpit exposes unredacted business memory, pipeline value, and approval
 * controls, so the route is local-first by construction: remote requests are
 * refused rather than authenticated. Forwarded headers are treated as evidence
 * of a proxy hop and therefore as non-local, since they can be spoofed.
 */
function isLocalRequest(req) {
  if (!req) return false;

  const headers = req.headers || {};
  if (headers['x-forwarded-for'] || headers['x-real-ip'] || headers['forwarded']) return false;

  const socket = req.socket || req.connection || {};
  const remote = normalize(socket.remoteAddress);
  if (!LOOPBACK.has(remote)) return false;

  const host = normalize(headers.host).split(':')[0];
  if (!LOOPBACK_HOSTS.has(host)) return false;

  return true;
}

/**
 * Express/Next-style guard. Responds 403 and returns false when the request is
 * not local; returns true when the handler may proceed.
 */
function requireLocal(req, res) {
  if (isLocalRequest(req)) return true;
  res.status(403).json({
    error: 'forbidden',
    message: 'The executive cockpit is available from localhost only.',
  });
  return false;
}

module.exports = { isLocalRequest, requireLocal, LOOPBACK, LOOPBACK_HOSTS };
