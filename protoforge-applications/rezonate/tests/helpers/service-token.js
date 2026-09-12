const crypto = require('crypto');

/**
 * Generates a valid `x-hydi-service-token` header value for tests, matching the
 * exact algorithm lib/auth/verifyServiceToken.js expects:
 *   `{timestamp}.{requestId}.{service}.{hmac-sha256-hex}`
 * where the signed payload is `${timestamp}:${requestId}:${service}`.
 *
 * Used by tests that exercise protoforge-applications/rezonate/src/api/router.js
 * with auth enabled (the default since P1 #6, docs/REZONATE_CONSOLIDATION_PLAN.md).
 * The secret here is test-local only — never a real credential.
 */
function makeServiceToken(secret, service = 'rezonate-tests') {
  const ts = Date.now();
  const requestId = crypto.randomUUID();
  const payload = `${ts}:${requestId}:${service}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${ts}.${requestId}.${service}.${sig}`;
}

module.exports = { makeServiceToken };
