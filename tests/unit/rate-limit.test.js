'use strict';

const { rateLimit, getClientIp, __reset } = require('../../lib/rate-limit');

function fakeReq({ ip = '1.2.3.4', xff } = {}) {
  return {
    headers: xff ? { 'x-forwarded-for': xff } : {},
    socket: { remoteAddress: ip },
  };
}

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('rateLimit', () => {
  beforeEach(() => {
    __reset();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows requests under the limit', () => {
    const req = fakeReq();
    for (let i = 0; i < 5; i++) {
      const res = fakeRes();
      expect(rateLimit(req, res, { name: 'test', windowMs: 60000, max: 5 })).toBe(true);
      expect(res.statusCode).toBeNull();
    }
  });

  it('blocks the request once the limit is exceeded', () => {
    const req = fakeReq();
    for (let i = 0; i < 5; i++) {
      rateLimit(req, fakeRes(), { name: 'test', windowMs: 60000, max: 5 });
    }
    const res = fakeRes();
    const allowed = rateLimit(req, res, { name: 'test', windowMs: 60000, max: 5 });

    expect(allowed).toBe(false);
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: 'Too many requests', retryAfterSeconds: 60 });
    expect(res.headers['Retry-After']).toBe('60');
  });

  it('resets after the window elapses', () => {
    const req = fakeReq();
    for (let i = 0; i < 5; i++) {
      rateLimit(req, fakeRes(), { name: 'test', windowMs: 60000, max: 5 });
    }
    expect(rateLimit(req, fakeRes(), { name: 'test', windowMs: 60000, max: 5 })).toBe(false);

    jest.advanceTimersByTime(60001);

    const res = fakeRes();
    expect(rateLimit(req, res, { name: 'test', windowMs: 60000, max: 5 })).toBe(true);
    expect(res.statusCode).toBeNull();
  });

  it('tracks separate buckets per route name', () => {
    const req = fakeReq();
    for (let i = 0; i < 5; i++) {
      rateLimit(req, fakeRes(), { name: 'route-a', windowMs: 60000, max: 5 });
    }
    expect(rateLimit(req, fakeRes(), { name: 'route-a', windowMs: 60000, max: 5 })).toBe(false);

    const res = fakeRes();
    expect(rateLimit(req, res, { name: 'route-b', windowMs: 60000, max: 5 })).toBe(true);
  });

  it('tracks separate buckets per client IP', () => {
    const reqA = fakeReq({ ip: '1.1.1.1' });
    const reqB = fakeReq({ ip: '2.2.2.2' });
    for (let i = 0; i < 5; i++) {
      rateLimit(reqA, fakeRes(), { name: 'test', windowMs: 60000, max: 5 });
    }
    expect(rateLimit(reqA, fakeRes(), { name: 'test', windowMs: 60000, max: 5 })).toBe(false);

    const res = fakeRes();
    expect(rateLimit(reqB, res, { name: 'test', windowMs: 60000, max: 5 })).toBe(true);
  });
});

describe('getClientIp', () => {
  it('prefers the first hop of x-forwarded-for', () => {
    const req = fakeReq({ ip: '9.9.9.9', xff: '1.2.3.4, 5.6.7.8' });
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  it('falls back to socket.remoteAddress when there is no x-forwarded-for', () => {
    const req = fakeReq({ ip: '9.9.9.9' });
    expect(getClientIp(req)).toBe('9.9.9.9');
  });

  it('falls back to "unknown" when neither is present', () => {
    expect(getClientIp({ headers: {}, socket: {} })).toBe('unknown');
  });
});
