/**
 * Unit tests for api/checkout.js — checkout session creation.
 * Mocks the `stripe` package so no live Stripe calls are made. Follows the
 * same mock style as tests/unit/stripe-connect-webhook.test.js.
 */

const { EventEmitter } = require('events');

const mockSessionsCreate = jest.fn();

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    checkout: { sessions: { create: (...args) => mockSessionsCreate(...args) } },
  }))
);

function fakeReq({ method = 'POST', body = null, ip = '127.0.0.1' } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = { 'x-forwarded-for': ip };
  req.socket = { remoteAddress: ip };
  process.nextTick(() => {
    if (body !== null) req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  });
  return req;
}

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    ended: false,
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
    end() {
      this.ended = true;
      return this;
    },
  };
}

describe('api/checkout.js', () => {
  let handler;
  let ip = 0;
  const nextIp = () => `10.0.0.${++ip}`;

  beforeEach(() => {
    jest.resetModules();
    mockSessionsCreate.mockReset();
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
    process.env.STRIPE_HYDI_STARTER_PRICE_ID = 'price_starter';
    process.env.STRIPE_HYDI_PRO_PRICE_ID = 'price_pro';
    process.env.STRIPE_HYDI_ENTERPRISE_PRICE_ID = 'price_enterprise';
    handler = require('../../api/checkout');
  });

  it('responds to OPTIONS with 200 and CORS headers, without touching Stripe', async () => {
    const req = fakeReq({ method: 'OPTIONS', ip: nextIp() });
    const res = fakeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.ended).toBe(true);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it('rejects non-POST/OPTIONS methods with 405', async () => {
    const req = fakeReq({ method: 'GET', ip: nextIp() });
    const res = fakeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
  });

  it('rejects an unknown tier with 400', async () => {
    const req = fakeReq({ ip: nextIp(), body: { tier: 'bogus', email: 'a@b.com', company: 'Acme' } });
    const res = fakeRes();
    await handler(req, res);
    await new Promise((r) => process.nextTick(r));
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid tier' });
  });

  it('rejects a missing email with 400', async () => {
    const req = fakeReq({ ip: nextIp(), body: { tier: 'starter', company: 'Acme' } });
    const res = fakeRes();
    await handler(req, res);
    await new Promise((r) => process.nextTick(r));
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Email required' });
  });

  it('rejects a missing company with 400', async () => {
    const req = fakeReq({ ip: nextIp(), body: { tier: 'starter', email: 'a@b.com' } });
    const res = fakeRes();
    await handler(req, res);
    await new Promise((r) => process.nextTick(r));
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Company required' });
  });

  it('creates a Stripe checkout session and returns its url for valid input', async () => {
    mockSessionsCreate.mockResolvedValueOnce({ url: 'https://checkout.stripe.com/session_123' });
    const req = fakeReq({ ip: nextIp(), body: { tier: 'pro', email: 'a@b.com', company: 'Acme' } });
    const res = fakeRes();
    await handler(req, res);
    await new Promise((r) => process.nextTick(r));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ url: 'https://checkout.stripe.com/session_123' });
    expect(mockSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        customer_email: 'a@b.com',
        line_items: [{ price: 'price_pro', quantity: 1 }],
        metadata: { tier: 'pro', company: 'Acme' },
      })
    );
  });

  it('returns 500 with a clean error, not a crash, when STRIPE_SECRET_KEY is unset', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const req = fakeReq({ ip: nextIp(), body: { tier: 'starter', email: 'a@b.com', company: 'Acme' } });
    const res = fakeRes();
    await handler(req, res);
    await new Promise((r) => process.nextTick(r));
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to create checkout session' });
  });

  it('enforces the per-IP rate limit (10 requests / 10 min)', async () => {
    const ipAddr = nextIp();
    mockSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/session' });

    for (let i = 0; i < 10; i++) {
      const req = fakeReq({ ip: ipAddr, body: { tier: 'starter', email: 'a@b.com', company: 'Acme' } });
      const res = fakeRes();
      await handler(req, res);
      await new Promise((r) => process.nextTick(r));
    }

    const req = fakeReq({ ip: ipAddr, body: { tier: 'starter', email: 'a@b.com', company: 'Acme' } });
    const res = fakeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(429);
  });
});
