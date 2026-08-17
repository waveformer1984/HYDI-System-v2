'use strict';

/**
 * Device-scoped HMAC authentication (Phase 4).
 *
 * Extends the existing shared-secret scheme (lib/auth/verifyServiceToken.js,
 * HYDI_SERVICE_SECRET) with a per-device secret, so a single compromised
 * phone/device can be revoked without rotating the one secret every other
 * internal caller (api/chat, termux, etc.) still depends on.
 *
 * Token format is unchanged: `{ts}.{requestId}.{deviceId}.{sig}`, same
 * replay window (5 min) and timingSafeEqual comparison as
 * verifyServiceToken.js — only the signing key differs (per-device instead
 * of the global secret).
 *
 * Secret handling: the raw secret is generated once at registration and
 * returned to the caller in that single response — it is never persisted.
 * What's stored in devices.secret_hash is sha256(rawSecret), and *that
 * derived value* (not the raw secret) is the actual HMAC signing key both
 * sides converge on afterward (deriveSigningKey() below). This means a
 * database read alone (without having captured the original registration
 * response) cannot be used to sign new requests as that device, while
 * still allowing simple, dependency-free HMAC verification server-side
 * (unlike a password hash, an HMAC key can't be "checked" without being
 * held in a usable form).
 */

const { createHmac, timingSafeEqual, randomBytes } = require('crypto');

const WINDOW_MS = 5 * 60 * 1000; // 5-minute replay window, matches verifyServiceToken.js

function generateDeviceSecret() {
  return randomBytes(32).toString('hex');
}

function deriveSigningKey(rawSecret) {
  return createHmac('sha256', 'hydi-device-key-derivation').update(rawSecret).digest('hex');
}

/**
 * Client-side helper (also used by tests / hardware agents) to sign a
 * device request. `signingKey` is deriveSigningKey(rawSecret) — the value
 * computed once right after registration, not the raw secret itself.
 */
function signDeviceToken(deviceId, signingKey, requestId) {
  const ts = Date.now().toString();
  const reqId = requestId || randomBytes(8).toString('hex');
  const payload = `${ts}:${reqId}:${deviceId}`;
  const sig = createHmac('sha256', signingKey).update(payload).digest('hex');
  return `${ts}.${reqId}.${deviceId}.${sig}`;
}

/**
 * Verify a device token against a signing key (already looked up from
 * devices.secret_hash by the caller). Pure function, no DB access, so it's
 * easy to unit test independently of Supabase.
 */
function verifyDeviceTokenSignature(token, signingKey) {
  if (!token) return { valid: false, reason: 'missing token' };
  if (!signingKey) return { valid: false, reason: 'no signing key for device' };

  const parts = token.split('.');
  if (parts.length !== 4) return { valid: false, reason: 'malformed token' };

  const [ts, requestId, deviceId, sig] = parts;
  const timestamp = parseInt(ts, 10);

  if (isNaN(timestamp) || Math.abs(Date.now() - timestamp) > WINDOW_MS) {
    return { valid: false, reason: 'token expired or clock skew exceeds 5 minutes' };
  }

  const payload = `${ts}:${requestId}:${deviceId}`;
  const expected = createHmac('sha256', signingKey).update(payload).digest('hex');

  try {
    const expectedBuf = Buffer.from(expected, 'hex');
    const sigBuf = Buffer.from(sig, 'hex');
    if (expectedBuf.length !== sigBuf.length || !timingSafeEqual(expectedBuf, sigBuf)) {
      return { valid: false, reason: 'signature mismatch' };
    }
  } catch (_) {
    return { valid: false, reason: 'invalid signature encoding' };
  }

  return { valid: true, deviceId, requestId, timestamp };
}

/**
 * Full verification against Supabase: looks up the device by the id
 * embedded in the token, checks it's approved and not revoked, verifies
 * the signature, and returns the device's role for RBAC checks. Every
 * outcome (success or failure) is the caller's responsibility to log to
 * auth_audit_log — kept out of this function so it stays a pure lookup +
 * verify and is easy to unit test with a mock Supabase client.
 */
async function verifyDeviceRequest(supabase, token) {
  if (!token) return { valid: false, reason: 'missing token' };

  const parts = token.split('.');
  if (parts.length !== 4) return { valid: false, reason: 'malformed token' };
  const deviceId = parts[2];

  const { data: device, error } = await supabase
    .from('devices')
    .select('device_id, role, status, secret_hash')
    .eq('device_id', deviceId)
    .maybeSingle();

  if (error || !device) return { valid: false, reason: 'unknown device', deviceId };
  if (device.status === 'revoked') return { valid: false, reason: 'device revoked', deviceId };
  if (device.status !== 'approved') return { valid: false, reason: 'device not approved', deviceId };

  const result = verifyDeviceTokenSignature(token, device.secret_hash);
  if (!result.valid) return { ...result, deviceId };

  return { valid: true, deviceId, role: device.role };
}

module.exports = {
  generateDeviceSecret,
  deriveSigningKey,
  signDeviceToken,
  verifyDeviceTokenSignature,
  verifyDeviceRequest,
};
