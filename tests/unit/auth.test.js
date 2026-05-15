'use strict'

const { verifyServiceToken } = require('../../lib/auth/verifyServiceToken')
const { createHmac } = require('crypto')

const TEST_SECRET = 'test-secret-for-unit-tests-only'

function makeToken(requestId, service, offsetMs) {
  requestId = requestId || 'req-1'
  service = service || 'heidi-chat-portal'
  offsetMs = offsetMs || 0
  const timestamp = Date.now() + offsetMs
  const payload = `${timestamp}:${requestId}:${service}`
  const sig = createHmac('sha256', TEST_SECRET).update(payload).digest('hex')
  return `${timestamp}.${requestId}.${service}.${sig}`
}

describe('verifyServiceToken', () => {
  it('accepts a valid token', () => {
    const token = makeToken()
    const result = verifyServiceToken(token, TEST_SECRET)
    expect(result.valid).toBe(true)
    expect(result.service).toBe('heidi-chat-portal')
    expect(result.requestId).toBe('req-1')
    expect(typeof result.timestamp).toBe('number')
  })

  it('rejects when token is missing', () => {
    const result = verifyServiceToken(undefined, TEST_SECRET)
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/missing/)
  })

  it('rejects when service secret is empty', () => {
    const token = makeToken()
    const result = verifyServiceToken(token, '')
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/secret/)
  })

  it('rejects a malformed token (wrong number of segments)', () => {
    const result = verifyServiceToken('bad.token', TEST_SECRET)
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/malformed/)
  })

  it('rejects an expired token (more than 5 minutes old)', () => {
    const token = makeToken('req-expired', 'heidi-chat-portal', -(6 * 60 * 1000))
    const result = verifyServiceToken(token, TEST_SECRET)
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/expired/)
  })

  it('rejects a tampered signature', () => {
    const token = makeToken('req-tamper', 'heidi-chat-portal')
    const tampered = token.slice(0, -4) + 'dead'
    const result = verifyServiceToken(tampered, TEST_SECRET)
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/mismatch|encoding/)
  })

  it('rejects a token signed with a different secret', () => {
    const token = makeToken('req-wrong-secret', 'heidi-chat-portal')
    const result = verifyServiceToken(token, 'a-completely-different-secret')
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/mismatch/)
  })

  it('accepts a token generated near the start of the 5-minute window', () => {
    const token = makeToken('req-edge', 'heidi-chat-portal', -(4 * 60 * 1000))
    const result = verifyServiceToken(token, TEST_SECRET)
    expect(result.valid).toBe(true)
  })

  it('preserves the service name in the result', () => {
    const token = makeToken('req-svc', 'heidi-chat-portal')
    const result = verifyServiceToken(token, TEST_SECRET)
    expect(result.service).toBe('heidi-chat-portal')
  })

  it('preserves the requestId in the result', () => {
    const token = makeToken('my-special-request-id', 'heidi-chat-portal')
    const result = verifyServiceToken(token, TEST_SECRET)
    expect(result.requestId).toBe('my-special-request-id')
  })
})
