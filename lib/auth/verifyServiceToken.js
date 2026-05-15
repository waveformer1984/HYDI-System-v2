'use strict'

const { createHmac, timingSafeEqual } = require('crypto')

const WINDOW_MS = 5 * 60 * 1000 // 5-minute replay window

/**
 * Verify an HMAC-SHA256 service token issued by a trusted caller.
 * Token format: `{timestamp}.{requestId}.{service}.{hmac-sha256-hex}`
 *
 * @param {string|undefined} token  - Value of the x-hydi-service-token header.
 * @param {string}           secret - Shared secret; defaults to HYDI_SERVICE_SECRET env var.
 * @returns {{ valid: boolean, reason?: string, service?: string, requestId?: string, timestamp?: number }}
 */
function verifyServiceToken(token, secret) {
  secret = secret != null ? secret : process.env.HYDI_SERVICE_SECRET

  if (!token) return { valid: false, reason: 'missing token' }
  if (!secret) return { valid: false, reason: 'service secret not configured' }

  const parts = token.split('.')
  if (parts.length !== 4) return { valid: false, reason: 'malformed token' }

  const [ts, requestId, service, sig] = parts
  const timestamp = parseInt(ts, 10)

  if (isNaN(timestamp) || Math.abs(Date.now() - timestamp) > WINDOW_MS) {
    return { valid: false, reason: 'token expired or clock skew exceeds 5 minutes' }
  }

  const payload = `${ts}:${requestId}:${service}`
  const expected = createHmac('sha256', secret).update(payload).digest('hex')

  try {
    const expectedBuf = Buffer.from(expected, 'hex')
    const sigBuf = Buffer.from(sig, 'hex')
    if (expectedBuf.length !== sigBuf.length || !timingSafeEqual(expectedBuf, sigBuf)) {
      return { valid: false, reason: 'signature mismatch' }
    }
  } catch (_) {
    return { valid: false, reason: 'invalid signature encoding' }
  }

  return { valid: true, service, requestId, timestamp }
}

module.exports = { verifyServiceToken }
