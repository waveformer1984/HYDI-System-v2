'use strict'

/**
 * Mobile chat backend integration tests.
 *
 * Proves the mobile chat path speaks the same conventions as every other
 * HYDI backend client:
 *  1. Tokens minted by lib/auth/generateServiceToken.js are accepted by
 *     lib/auth/verifyServiceToken.js — the guard used by api/chat/route.js.
 *  2. @system message parsing routes to the same subsystem names the
 *     universal chat router exposes.
 *  3. api/mobile-chat.js dispatches to the shared system handlers and
 *     answers in the mobile UI's SSE protocol.
 */

const { generateServiceToken, DEFAULT_SERVICE } = require('../../lib/auth/generateServiceToken')
const { verifyServiceToken } = require('../../lib/auth/verifyServiceToken')
const { parseSystemMessage, KNOWN_SYSTEMS } = require('../../lib/mobile/system-router')

const TEST_SECRET = 'test-shared-secret'

describe('generateServiceToken → verifyServiceToken round-trip', () => {
  test('minted token verifies with the same secret', () => {
    const token = generateServiceToken('req-123', 'heidi-mobile', TEST_SECRET)
    const result = verifyServiceToken(token, TEST_SECRET)
    expect(result.valid).toBe(true)
    expect(result.service).toBe('heidi-mobile')
    expect(result.requestId).toBe('req-123')
  })

  test('defaults: generated requestId and heidi-mobile service', () => {
    const token = generateServiceToken(undefined, undefined, TEST_SECRET)
    const result = verifyServiceToken(token, TEST_SECRET)
    expect(result.valid).toBe(true)
    expect(result.service).toBe(DEFAULT_SERVICE)
    expect(result.requestId).toBeTruthy()
  })

  test('rejected when verified with a different secret', () => {
    const token = generateServiceToken('req-123', 'heidi-mobile', TEST_SECRET)
    const result = verifyServiceToken(token, 'another-secret')
    expect(result.valid).toBe(false)
  })

  test('tampered service name is rejected', () => {
    const token = generateServiceToken('req-123', 'heidi-mobile', TEST_SECRET)
    const parts = token.split('.')
    parts[2] = 'evil-service'
    const result = verifyServiceToken(parts.join('.'), TEST_SECRET)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('signature mismatch')
  })

  test('throws without a secret', () => {
    const prev = process.env.HYDI_SERVICE_SECRET
    delete process.env.HYDI_SERVICE_SECRET
    try {
      expect(() => generateServiceToken('req-123', 'svc')).toThrow(/HYDI_SERVICE_SECRET/)
    } finally {
      if (prev !== undefined) process.env.HYDI_SERVICE_SECRET = prev
    }
  })

  test('rejects dot in requestId or service (would corrupt token format)', () => {
    expect(() => generateServiceToken('req.123', 'svc', TEST_SECRET)).toThrow(/must not contain/)
    expect(() => generateServiceToken('req-123', 'svc.name', TEST_SECRET)).toThrow(/must not contain/)
  })
})

describe('parseSystemMessage', () => {
  test('@ursula prefix routes to ursula with prefix stripped', () => {
    expect(parseSystemMessage('@ursula system status')).toEqual({
      system: 'ursula',
      text: 'system status',
    })
  })

  test('prefix is case-insensitive and tolerates a colon', () => {
    expect(parseSystemMessage('@URSULA: What is going on?')).toEqual({
      system: 'ursula',
      text: 'What is going on?',
    })
  })

  test('bare @system defaults to a status query', () => {
    expect(parseSystemMessage('@infrastructure')).toEqual({
      system: 'infrastructure',
      text: 'status',
    })
  })

  test('explicit system field wins over plain text', () => {
    expect(parseSystemMessage('health please', 'cascade')).toEqual({
      system: 'cascade',
      text: 'health please',
    })
  })

  test('unknown @prefix is treated as plain conversation', () => {
    expect(parseSystemMessage('@bogus hello')).toEqual({
      system: null,
      text: '@bogus hello',
    })
  })

  test('plain message routes locally (system null)', () => {
    expect(parseSystemMessage('hey heidi, how are you?')).toEqual({
      system: null,
      text: 'hey heidi, how are you?',
    })
  })

  test('every routable system exists in the universal chat router', async () => {
    const { systemHandlers } = await import('../../api/chat/route.js')
    for (const system of KNOWN_SYSTEMS) {
      expect(typeof systemHandlers[system]).toBe('function')
    }
  })
})

describe('api/mobile-chat handler', () => {
  function mockRes() {
    return {
      headers: {},
      statusCode: 200,
      body: null,
      chunks: [],
      ended: false,
      setHeader(k, v) { this.headers[k] = v },
      status(code) { this.statusCode = code; return this },
      json(obj) { this.body = obj; return this },
      write(chunk) { this.chunks.push(chunk); return true },
      end() { this.ended = true },
    }
  }

  function sseFrames(res) {
    return res.chunks
      .join('')
      .split('\n\n')
      .filter(Boolean)
      .map(f => JSON.parse(f.replace(/^data: /, '')))
  }

  let handler
  beforeAll(async () => {
    handler = (await import('../../api/mobile-chat.js')).default
  })

  test('rejects non-POST and missing message', async () => {
    const res1 = mockRes()
    await handler({ method: 'GET' }, res1)
    expect(res1.statusCode).toBe(405)

    const res2 = mockRes()
    await handler({ method: 'POST', body: {} }, res2)
    expect(res2.statusCode).toBe(400)
  })

  test('dispatches @heidi message to the shared heidi handler over SSE', async () => {
    const res = mockRes()
    await handler({ method: 'POST', body: { message: '@heidi build the weekly report' } }, res)

    expect(res.headers['Content-Type']).toBe('text/event-stream')
    expect(res.ended).toBe(true)

    const frames = sseFrames(res)
    const textFrame = frames.find(f => f.t !== undefined)
    const doneFrame = frames.find(f => f.done)
    expect(textFrame.t).toContain('[Heidi] Task received')
    expect(doneFrame).toMatchObject({ done: true, provider: 'hydi', system: 'heidi' })
  })

  test('plain messages default to the heidi system', async () => {
    const res = mockRes()
    await handler({ method: 'POST', body: { message: 'hello there' } }, res)
    const doneFrame = sseFrames(res).find(f => f.done)
    expect(doneFrame.system).toBe('heidi')
  })
})
