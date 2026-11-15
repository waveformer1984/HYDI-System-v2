'use strict';

/**
 * Operations snapshot requires HEIDI_SECRET even on loopback so a heidi-web
 * proxy cannot be bypassed by hitting :3459 directly without the shared secret.
 */

function checkOperationsSnapshotAccess(req, env = process.env) {
  const expected = env.HEIDI_SECRET;
  if (!expected) {
    return { ok: false, status: 503, error: 'heidi_secret_not_configured' };
  }
  const presented = req.headers && req.headers['x-heidi-secret'];
  if (!presented || String(presented) !== String(expected)) {
    return { ok: false, status: 403, error: 'forbidden' };
  }
  return { ok: true };
}

module.exports = { checkOperationsSnapshotAccess };