'use strict'

const { createHmac, randomUUID } = require('crypto')

// Default identity presented to the universal chat router by the
// mobile chat bridge (launch-heidi-mobile.js / api/mobile-chat.js).
const DEFAULT_SERVICE = 'heidi-mobile'

/**
 * Mint an HMAC-SHA256 service token accepted by verifyServiceToken()
 * and by the universal chat router (api/chat/route.js).
 * Token format: `{timestamp}.{requestId}.{service}.{hmac-sha256-hex}`
 *
 * Mirrors ProtoForgeSite heidi-chat-portal/lib/auth/serviceToken.ts so
 * every client of the HYDI backend speaks the same auth convention.
 *
 * @param {string} [requestId] - Correlation ID; generated when omitted.
 * @param {string} [service]   - Caller identity; defaults to 'heidi-mobile'.
 * @param {string} [secret]    - Shared secret; defaults to HYDI_SERVICE_SECRET env var.
 * @returns {string} signed token for the x-hydi-service-token header
 */
function generateServiceToken(requestId, service, secret) {
  requestId = requestId || randomUUID()
  service = service || DEFAULT_SERVICE
  secret = secret != null ? secret : process.env.HYDI_SERVICE_SECRET

  if (!secret) throw new Error('HYDI_SERVICE_SECRET is not configured')
  // The token is dot-delimited, so neither field may contain a dot.
  if (requestId.includes('.') || service.includes('.')) {
    throw new Error('requestId and service must not contain "."')
  }

  const timestamp = Date.now()
  const payload = `${timestamp}:${requestId}:${service}`
  const sig = createHmac('sha256', secret).update(payload).digest('hex')
  return `${timestamp}.${requestId}.${service}.${sig}`
}

module.exports = { generateServiceToken, DEFAULT_SERVICE }
