/**
 * Unit tests for api/life-flow/route.js — focused on the verifyServiceToken
 * auth guard added by RFC-139.
 *
 * HYDISystem is mocked at module level (it instantiates + starts on require).
 */

// ── HYDISystem mock ────────────────────────────────────────────────────────────
const mockProcessRequest = jest.fn();
const mockStart = jest.fn().mockResolvedValue(undefined);

jest.mock('../../src/HYDISystem', () => {
  return jest.fn().mockImplementation(() => ({
    start: mockStart,
    processRequest: mockProcessRequest,
  }));
});

// ── verifyServiceToken mock ────────────────────────────────────────────────────
const mockVerifyServiceToken = jest.fn();
jest.mock('../../lib/auth/verifyServiceToken', () => ({
  verifyServiceToken: (...args) => mockVerifyServiceToken(...args),
}));

// ── environment variables ──────────────────────────────────────────────────────
beforeAll(() => {
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake_service_key';
});

// ── helpers ───────────────────────────────────────────────────────────────────

function buildReqRes({ method = 'POST', body = {}, headers = {} } = {}) {
  const req = { method, body, headers };
  const res = {
    _status: 200,
    _body: null,
    _headers: {},
    status(code) {
      this._status = code;
      return this;
    },
    json(body) {
      this._body = body;
      return this;
    },
    setHeader(name, value) {
      this._headers[name] = value;
      return this;
    },
    end() {
      return this;
    },
  };
  return { req, res };
}

// Load the handler after mocks are in place.
// The route uses `export default` (transformed to module.exports.default by Babel).
const lifeFlowModule = require('../../api/life-flow/route.js');
const handler = lifeFlowModule.default || lifeFlowModule;

// Reset between tests.
beforeEach(() => {
  jest.clearAllMocks();
  mockStart.mockResolvedValue(undefined);
  mockVerifyServiceToken.mockReturnValue({ valid: true, service: 'test-service' });
});

// ── auth guard ────────────────────────────────────────────────────────────────

describe('life-flow service token guard', () => {
  it('returns 401 when x-hydi-service-token header is missing', async () => {
    mockVerifyServiceToken.mockReturnValueOnce({ valid: false, reason: 'missing token' });

    const { req, res } = buildReqRes({
      body: { type: 'life_flow', subtype: 'real_time_analysis' },
    });
    await handler(req, res);

    expect(res._status).toBe(401);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toBe('Unauthorized');
    expect(res._body.reason).toBe('missing token');
    expect(mockProcessRequest).not.toHaveBeenCalled();
  });

  it('returns 401 when token signature is invalid', async () => {
    mockVerifyServiceToken.mockReturnValueOnce({ valid: false, reason: 'signature mismatch' });

    const { req, res } = buildReqRes({
      headers: { 'x-hydi-service-token': 'tampered.token.here.bad' },
      body: { type: 'system', subtype: 'status' },
    });
    await handler(req, res);

    expect(res._status).toBe(401);
    expect(res._body.success).toBe(false);
    expect(res._body.reason).toBe('signature mismatch');
    expect(mockProcessRequest).not.toHaveBeenCalled();
  });

  it('returns 401 when token is expired', async () => {
    mockVerifyServiceToken.mockReturnValueOnce({
      valid: false,
      reason: 'token expired or clock skew exceeds 5 minutes',
    });

    const { req, res } = buildReqRes({ body: { type: 'life_flow' } });
    await handler(req, res);

    expect(res._status).toBe(401);
    expect(res._body.reason).toMatch(/expired/i);
    expect(mockProcessRequest).not.toHaveBeenCalled();
  });

  it('passes OPTIONS preflight without auth check', async () => {
    const { req, res } = buildReqRes({ method: 'OPTIONS' });
    await handler(req, res);

    expect(res._status).toBe(200);
    // verifyServiceToken should not be called for preflight
    expect(mockVerifyServiceToken).not.toHaveBeenCalled();
  });

  it('uses tokenResult.service as context.userId when valid', async () => {
    mockVerifyServiceToken.mockReturnValueOnce({ valid: true, service: 'heidi-chat-portal' });
    mockProcessRequest.mockResolvedValueOnce({
      result: { status: 'ok' },
      requestId: 'req-123',
      duration: 42,
    });

    const { req, res } = buildReqRes({
      headers: {
        'x-hydi-service-token': 'valid.token.here.sig',
        'x-session-id': 'session-abc',
        'x-tier': 'pro',
      },
      body: { type: 'life_flow', subtype: 'real_time_analysis', params: {} },
    });
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);

    const callArg = mockProcessRequest.mock.calls[0][0];
    expect(callArg.context.userId).toBe('heidi-chat-portal');
    expect(callArg.context.sessionId).toBe('session-abc');
    expect(callArg.context.tier).toBe('pro');
  });

  it('returns 400 when type is missing from request body', async () => {
    const { req, res } = buildReqRes({ body: {} });
    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toMatch(/missing request type/i);
    expect(mockProcessRequest).not.toHaveBeenCalled();
  });

  it('forwards processRequest result with requestId and duration', async () => {
    mockProcessRequest.mockResolvedValueOnce({
      result: { analysisData: 'some data' },
      requestId: 'req-xyz',
      duration: 150,
    });

    const { req, res } = buildReqRes({
      body: { type: 'life_flow', subtype: 'weekly_report', params: {} },
    });
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({
      success: true,
      data: { analysisData: 'some data' },
      requestId: 'req-xyz',
      duration: 150,
    });
  });

  it('returns 500 when processRequest throws', async () => {
    mockProcessRequest.mockRejectedValueOnce(new Error('internal failure'));

    const { req, res } = buildReqRes({
      body: { type: 'system', subtype: 'status' },
    });
    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toBe('internal failure');
  });
});
