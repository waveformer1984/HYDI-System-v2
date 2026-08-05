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

const mockRpc = jest.fn();
const mockHandleWebhook = jest.fn();
// Every `webhook_events` operation, so tests can assert the idempotency claim
// lifecycle (settled on a terminal verdict, released on failure).
const tableOps = [];

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(table => {
      const op = { table, action: null, payload: null, filters: [] };
      tableOps.push(op);
      const chain = {
        update(payload) {
          op.action = 'update';
          op.payload = payload;
          return chain;
        },
        delete() {
          op.action = 'delete';
          return chain;
        },
        eq(column, value) {
          op.filters.push([column, value]);
          return chain;
        },
        then(resolve) {
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      };
      return chain;
    }),
    rpc: (...args) => mockRpc(...args),
  })),
}));

jest.mock('../../modules/heidi-revenue-outreach', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../modules/universal-agent-bus', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../workers/WebhookQueueAdapter', () =>
  jest.fn().mockImplementation(() => ({
    handleWebhook: (...args) => mockHandleWebhook(...args),
  }))
);

/** Table operations recorded for `webhook_events` since the last reset. */
function claimOps() {
  return tableOps.filter(op => op.table === 'webhook_events');
}

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

  beforeEach(() => {
    tableOps.length = 0;
    mockRpc.mockReset().mockResolvedValue({ data: 'claim_test', error: null });
    mockHandleWebhook
      .mockReset()
      .mockResolvedValue({ status: 'queued', taskId: 'task_1', eventId: 'evt_1' });
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

  describe('idempotency claim lifecycle', () => {
    const postReq = () => ({
      method: 'POST',
      headers: { 'stripe-signature': 'sig' },
      body: Buffer.from('{}'),
    });

    const acceptedEvent = () => ({
      id: 'evt_claim',
      type: 'checkout.session.completed',
      data: { object: { metadata: {} } },
    });

    it('releases the claim when queueing fails, so the Stripe retry reprocesses', async () => {
      // Regression: the claim used to be parked at `queue_failed` and left in
      // place, so Stripe's retry re-claimed, got NULL, and was answered
      // `200 duplicate` -- the event was never queued and never will be.
      mockConstructEvent.mockReturnValueOnce(acceptedEvent());
      mockHandleWebhook.mockRejectedValueOnce(new Error('queue offline'));

      const res = fakeRes();
      await stripeWebhook(postReq(), res);

      expect(res.statusCode).toBe(500);
      const release = claimOps().find(op => op.action === 'delete');
      expect(release).toBeDefined();
      expect(release.filters).toContainEqual(['id', 'claim_test']);
    });

    it('settles the claim when CASCADE drops the event as a final verdict', async () => {
      mockConstructEvent.mockReturnValueOnce({
        id: 'evt_dropped',
        type: 'checkout.session.completed',
        // Below CASCADE_SETTINGS.CONFIDENCE_THRESHOLD (0.3).
        data: { object: { metadata: { hydi_confidence: '0.1' } } },
      });

      const res = fakeRes();
      await stripeWebhook(postReq(), res);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('dropped');
      const settle = claimOps().find(op => op.action === 'update');
      expect(settle).toBeDefined();
      expect(settle.payload).toEqual({ status: 'completed' });
      expect(claimOps().some(op => op.action === 'delete')).toBe(false);
    });

    it('answers 200 duplicate without queueing when the event was already claimed', async () => {
      mockConstructEvent.mockReturnValueOnce(acceptedEvent());
      mockRpc.mockResolvedValueOnce({ data: null, error: null });

      const res = fakeRes();
      await stripeWebhook(postReq(), res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('duplicate');
      expect(mockHandleWebhook).not.toHaveBeenCalled();
    });

    it('returns 500 rather than 200 when the idempotency store itself is unreachable', async () => {
      // A failed RPC is not a duplicate: a 200 would cancel every Stripe retry.
      mockConstructEvent.mockReturnValueOnce(acceptedEvent());
      mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'connection refused' } });

      const res = fakeRes();
      await stripeWebhook(postReq(), res);

      expect(res.statusCode).toBe(500);
      expect(mockHandleWebhook).not.toHaveBeenCalled();
    });
  });
});
