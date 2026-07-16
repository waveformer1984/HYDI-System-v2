/**
 * Regression tests for api/webhooks/stripe.js.
 *
 * This file previously had a bug where `module.exports.handler = ...`
 * was immediately clobbered by a later `module.exports = { handleStripeWebhook,
 * SERVICE_TIERS }`, so the Next.js/Vercel-style default handler was silently
 * dropped and the module could never function as an API route. It also read
 * `req.body` directly for Stripe signature verification without disabling
 * Next's bodyParser or buffering the raw stream, which would fail signature
 * verification in a real deployment. These tests guard both regressions.
 */

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn().mockReturnValue({
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
    }),
    rpc: jest.fn().mockResolvedValue({ data: 'claim_test', error: null }),
  })),
}));

jest.mock('../../modules/heidi-revenue-outreach', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../modules/universal-agent-bus', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../workers/WebhookQueueAdapter', () =>
  jest.fn().mockImplementation(() => ({
    handleWebhook: jest.fn().mockResolvedValue({ status: 'queued', taskId: 'task_1', eventId: 'evt_1' }),
  }))
);

const mockConstructEvent = jest.fn();
jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    webhooks: { constructEvent: (...args) => mockConstructEvent(...args) },
  }))
);

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
}

describe('api/webhooks/stripe.js', () => {
  let stripeWebhook;

  beforeAll(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
    process.env.STRIPE_WEBHOOK_SECRET_01 = 'whsec_fake';
    process.env.WEBHOOK_PROCESSING_ENABLED = 'true';
    stripeWebhook = require('../../api/webhooks/stripe');
  });

  it('exports a callable handler as the module default (regression: export was previously clobbered)', () => {
    expect(typeof stripeWebhook).toBe('function');
  });

  it('still exposes handleStripeWebhook for the standalone Express server (stripe-webhook-server.js)', () => {
    expect(typeof stripeWebhook.handleStripeWebhook).toBe('function');
  });

  it('exposes SERVICE_TIERS', () => {
    expect(stripeWebhook.SERVICE_TIERS).toBeDefined();
    expect(stripeWebhook.SERVICE_TIERS.pro).toBeDefined();
  });

  it('disables the built-in bodyParser so signature verification gets raw bytes (regression: config was missing)', () => {
    expect(stripeWebhook.config).toEqual({ api: { bodyParser: false } });
  });

  it('responds 200 to OPTIONS preflight without reaching handleStripeWebhook', async () => {
    const res = fakeRes();
    await stripeWebhook({ method: 'OPTIONS', headers: {} }, res);
    expect(res.statusCode).toBe(200);
  });

  it('rejects non-POST methods with 405', async () => {
    const res = fakeRes();
    await stripeWebhook({ method: 'GET', headers: {} }, res);
    expect(res.statusCode).toBe(405);
  });

  it('honors the WEBHOOK_PROCESSING_ENABLED kill switch', async () => {
    process.env.WEBHOOK_PROCESSING_ENABLED = 'false';
    const res = fakeRes();
    await stripeWebhook({ method: 'POST', headers: {}, body: Buffer.from('{}') }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('paused');
    process.env.WEBHOOK_PROCESSING_ENABLED = 'true';
  });

  it('reads the raw body (Buffer passthrough) and verifies the Stripe signature before processing', async () => {
    mockConstructEvent.mockReturnValueOnce({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { object: {} },
    });
    const res = fakeRes();
    const rawBody = Buffer.from('{"id":"evt_1"}');
    await stripeWebhook({ method: 'POST', headers: { 'stripe-signature': 'sig' }, body: rawBody }, res);

    expect(mockConstructEvent).toHaveBeenCalledWith(rawBody, 'sig', 'whsec_fake');
    expect(res.statusCode ?? 200).not.toBe(400);
  });

  it('returns 400 when signature verification fails', async () => {
    mockConstructEvent.mockImplementationOnce(() => {
      throw new Error('bad signature');
    });
    const res = fakeRes();
    await stripeWebhook(
      { method: 'POST', headers: { 'stripe-signature': 'bad' }, body: Buffer.from('{}') },
      res
    );
    expect(res.statusCode).toBe(400);
  });
});
