'use strict';

/**
 * Tests for api/events/stream.js auth guard (RFC-139 Task 2).
 *
 * Verifies that the SSE stream endpoint requires a valid x-hydi-service-token
 * and returns 401 when it is missing or invalid.
 */

const mockVerifyServiceToken = jest.fn();

jest.mock('../../lib/auth/verifyServiceToken', () => ({
  verifyServiceToken: (...args) => mockVerifyServiceToken(...args),
}));

// Minimal mock of Node EventEmitter so requiring the module doesn't error.
jest.mock('events', () => {
  const EventEmitter = jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),
  }));
  return { EventEmitter };
});

function buildReqRes({ headers = {}, method = 'GET' } = {}) {
  const req = {
    method,
    headers,
    on: jest.fn(),
  };
  const chunks = [];
  const res = {
    _status: null,
    _body: null,
    _headers: {},
    writeHead(status, hdrs) {
      this._status = status;
      if (hdrs) Object.assign(this._headers, hdrs);
    },
    write(chunk) {
      chunks.push(chunk);
    },
    end(body) {
      if (body != null) {
        try {
          this._body = JSON.parse(body);
        } catch {
          this._body = body;
        }
      }
    },
    _chunks: chunks,
  };
  return { req, res };
}

describe('events/stream auth guard (RFC-139)', () => {
  let handler;

  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyServiceToken.mockReturnValue({ valid: true, service: 'protoforge_ursula' });

    jest.resetModules();
    // Re-mock after resetModules
    jest.mock('../../lib/auth/verifyServiceToken', () => ({
      verifyServiceToken: (...args) => mockVerifyServiceToken(...args),
    }));
    jest.mock('events', () => {
      const EventEmitter = jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn(),
      }));
      return { EventEmitter };
    });

    const mod = require('../../api/events/stream.js');
    handler = mod.default || mod;
  });

  it('returns 401 when x-hydi-service-token header is missing', () => {
    mockVerifyServiceToken.mockReturnValue({ valid: false, reason: 'missing token' });
    const { req, res } = buildReqRes({ headers: {} });
    handler(req, res);
    expect(res._status).toBe(401);
    expect(res._body.error).toBe('Unauthorized');
    expect(res._body.reason).toBe('missing token');
  });

  it('returns 401 when token signature is invalid', () => {
    mockVerifyServiceToken.mockReturnValue({ valid: false, reason: 'signature mismatch' });
    const { req, res } = buildReqRes({ headers: { 'x-hydi-service-token': 'bad.token.here.bad' } });
    handler(req, res);
    expect(res._status).toBe(401);
    expect(res._body.reason).toBe('signature mismatch');
  });

  it('returns 401 when token is expired', () => {
    mockVerifyServiceToken.mockReturnValue({ valid: false, reason: 'token expired or clock skew exceeds 5 minutes' });
    const { req, res } = buildReqRes({ headers: { 'x-hydi-service-token': 'expired.token' } });
    handler(req, res);
    expect(res._status).toBe(401);
  });

  it('opens SSE stream when token is valid', () => {
    mockVerifyServiceToken.mockReturnValue({ valid: true, service: 'protoforge_ursula' });
    const { req, res } = buildReqRes({ headers: { 'x-hydi-service-token': 'valid.token.sig.123' } });
    // Simulate req.on so close cleanup doesn't throw
    req.on.mockImplementation(() => {});
    handler(req, res);
    expect(res._status).toBe(200);
    expect(res._headers['Content-Type']).toBe('text/event-stream');
  });

  it('handles OPTIONS preflight without calling verifyServiceToken', () => {
    const { req, res } = buildReqRes({ method: 'OPTIONS' });
    handler(req, res);
    expect(res._status).toBe(204);
    expect(mockVerifyServiceToken).not.toHaveBeenCalled();
  });

  it('passes the token header value to verifyServiceToken', () => {
    const tokenValue = 'some.token.protoforge_ursula.abc123';
    const { req, res } = buildReqRes({ headers: { 'x-hydi-service-token': tokenValue } });
    req.on.mockImplementation(() => {});
    handler(req, res);
    expect(mockVerifyServiceToken).toHaveBeenCalledWith(tokenValue);
  });
});
