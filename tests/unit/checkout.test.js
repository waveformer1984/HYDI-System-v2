/**
 * Unit tests for api/checkout.js -- HYDI tier subscription checkout session
 * creation. No live Stripe calls; the SDK is mocked.
 *
 * checkout-v2.js was deleted as an exact duplicate of this file (see
 * ISSUES_FOUND.md) -- these tests are now the only coverage for that logic.
 */
const { PassThrough } = require('stream');
const { __reset } = require('../../lib/rate-limit');

const mockCreateSession = jest.fn();
jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    checkout: { sessions: { create: (...args) => mockCreateSession(...args) } },
  }))
);

function fakeReq(body, { method = 'POST', headers = {} } = {}) {
  const req = new PassThrough();
  req.method = method;
  req.headers = headers;
  process.nextTick(() => {
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
  return req;
}

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    headersSent: false,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.headersSent = true;
      return this;
    },
    end() {
      this.headersSent = true;
      return this;
    },
  };
}

describe('api/checkout.js', () => {
  let checkout;

  beforeAll(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
    process.env.STRIPE_HYDI_STARTER_PRICE_ID = 'price_starter';
    process.env.STRIPE_HYDI_PRO_PRICE_ID = 'price_pro';
    process.env.STRIPE_HYDI_ENTERPRISE_PRICE_ID = 'price_enterprise';
    checkout = require('../../api/checkout');
  });

  beforeEach(() => {
    mockCreateSession.mockReset();
    __reset();
  });

  it('responds 200 to OPTIONS preflight', async () => {
    const res = fakeRes();
    await checkout(fakeReq(undefined, { method: 'OPTIONS' }), res);
    expect(res.statusCode).toBe(200);
  });

  it('rejects non-POST methods with 405', async () => {
    const res = fakeRes();
    await checkout(fakeReq(undefined, { method: 'GET' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('creates a checkout session for a valid tier/email/company', async () => {
    mockCreateSession.mockResolvedValue({ url: 'https://checkout.stripe.com/session_1' });
    const res = fakeRes();
    await checkout(fakeReq({ tier: 'pro', email: 'a@b.com', company: 'Acme' }), res);
    await new Promise((r) => setImmediate(r));

    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({ line_items: [{ price: 'price_pro', quantity: 1 }] })
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ url: 'https://checkout.stripe.com/session_1' });
  });

  it('rejects an invalid tier', async () => {
    const res = fakeRes();
    await checkout(fakeReq({ tier: 'nonexistent', email: 'a@b.com', company: 'Acme' }), res);
    await new Promise((r) => setImmediate(r));
    expect(res.statusCode).toBe(400);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('rejects a missing email', async () => {
    const res = fakeRes();
    await checkout(fakeReq({ tier: 'pro', company: 'Acme' }), res);
    await new Promise((r) => setImmediate(r));
    expect(res.statusCode).toBe(400);
  });

  it('rejects a missing company', async () => {
    const res = fakeRes();
    await checkout(fakeReq({ tier: 'pro', email: 'a@b.com' }), res);
    await new Promise((r) => setImmediate(r));
    expect(res.statusCode).toBe(400);
  });

  it('enforces the checkout rate limit (10 requests / 10 min per IP)', async () => {
    mockCreateSession.mockResolvedValue({ url: 'https://checkout.stripe.com/session_1' });
    const reqOpts = { headers: { 'x-forwarded-for': '1.2.3.4' } };
    for (let i = 0; i < 10; i++) {
      const res = fakeRes();
      // eslint-disable-next-line no-await-in-loop
      await checkout(fakeReq({ tier: 'pro', email: 'a@b.com', company: 'Acme' }, reqOpts), res);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setImmediate(r));
    }

    const res = fakeRes();
    await checkout(fakeReq({ tier: 'pro', email: 'a@b.com', company: 'Acme' }, reqOpts), res);
    expect(res.statusCode).toBe(429);
  });
});
