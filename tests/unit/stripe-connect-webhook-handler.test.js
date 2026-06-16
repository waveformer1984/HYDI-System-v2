/**
 * HTTP handler tests for the Stripe Connect webhook.
 *
 * Covers the end-to-end request path: signature verification → event dispatch →
 * ledger write. The existing stripe-connect-webhook.test.js covers the pure
 * helper functions (determineRevenueStream, FEE_STRUCTURE, REVENUE_STREAM_ACCOUNTS).
 * This file covers everything that runs inside the HTTP handler itself.
 *
 * No live services required — Stripe and Supabase are mocked.
 */

'use strict';

// ── Mocks (must be declared before any require) ───────────────────────────────

let mockStripeInstance;

jest.mock('stripe', () => {
  const instance = {
    webhooks: { constructEvent: jest.fn() },
    charges: { retrieve: jest.fn() },
  };
  mockStripeInstance = instance;
  return jest.fn().mockImplementation(() => instance);
});

// Capture the supabase mock client so tests can inspect calls.
let mockSupabaseFrom;

jest.mock('@supabase/supabase-js', () => {
  mockSupabaseFrom = jest.fn();
  return {
    createClient: jest.fn(() => ({ from: mockSupabaseFrom })),
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a minimal mock Express-style req object. */
function makeReq({ method = 'POST', sig = 'stripe_sig_test', body = Buffer.from('{}') } = {}) {
  return {
    method,
    headers: { 'stripe-signature': sig },
    body,
  };
}

/** Create a mock res object that captures calls to status().json(). */
function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

/**
 * Build a chainable Supabase mock that resolves with the given value.
 * Binds each method to the same chain object so `.insert().select().single()`
 * returns the final promise.
 */
function buildChain(resolveValue) {
  const chain = {};
  ['insert', 'update', 'select', 'eq', 'in'].forEach(m => {
    chain[m] = jest.fn().mockReturnValue(chain);
  });
  chain.single = jest.fn().mockResolvedValue(resolveValue);
  mockSupabaseFrom.mockReturnValue(chain);
  return chain;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let handler;

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake_service_key';
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_fake';
  process.env.STRIPE_ACCOUNT_GALACTIC_BYTES = 'acct_galactic';
  process.env.STRIPE_ACCOUNT_DETAILER_BOT = 'acct_detailer';
  process.env.STRIPE_ACCOUNT_LIPI_V2 = 'acct_lipi';
  process.env.STRIPE_ACCOUNT_PROTOGRANCE_AROMATICS = 'acct_protogrance';
  process.env.STRIPE_ACCOUNT_REZONATE = 'acct_rezonate';
  process.env.STRIPE_ACCOUNT_WAVEFORMER_STUDIO = 'acct_waveformer';

  // Stripe instance is captured inside the jest.mock factory above.
  // Supabase from() chain is controlled per-test via buildChain().

  handler = require('../../api/stripe-connect-webhook');
});

beforeEach(() => {
  // Reset the stripe constructEvent mock before each test so tests are isolated.
  mockStripeInstance.webhooks.constructEvent.mockReset();
  mockStripeInstance.charges.retrieve.mockReset();
  mockStripeInstance.charges.retrieve.mockResolvedValue({
    id: 'ch_test',
    billing_details: { email: 'buyer@example.com', name: 'Test Buyer' },
  });
  mockSupabaseFrom.mockReset();
});

// ── HTTP layer ────────────────────────────────────────────────────────────────

describe('HTTP handler — method and config guard', () => {
  it('returns 405 for non-POST requests', async () => {
    const req = makeReq({ method: 'GET' });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('returns 500 when STRIPE_CONNECT_WEBHOOK_SECRET is not set', async () => {
    const saved = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = saved;
  });

  it('returns 400 when Stripe signature verification fails', async () => {
    mockStripeInstance.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('No signatures found');
    });
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Invalid signature' }));
  });

  it('returns 200 with { received: true } for unhandled event types', async () => {
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      type: 'payment_method.attached',
      id: 'evt_unhandled',
      data: { object: {} },
    });
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('returns 500 when an internal handler throws', async () => {
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      id: 'evt_err',
      data: {
        object: {
          id: 'pi_err',
          amount: 5000,
          currency: 'usd',
          metadata: { revenue_stream: 'galactic_bytes' },
          latest_charge: null,
          description: null,
          receipt_email: null,
          shipping: null,
        },
      },
    });
    // DB insert fails immediately
    const chain = {};
    ['insert', 'select'].forEach(m => { chain[m] = jest.fn().mockReturnValue(chain); });
    chain.single = jest.fn().mockResolvedValue({ data: null, error: { message: 'DB down', code: '500' } });
    mockSupabaseFrom.mockReturnValue(chain);

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ── payment_intent.succeeded → ledger write ───────────────────────────────────

describe('payment_intent.succeeded — ledger entry creation', () => {
  function makePaymentIntent(overrides = {}) {
    return {
      id: 'pi_test_123',
      amount: 10000, // $100.00 in cents
      currency: 'usd',
      metadata: { revenue_stream: 'rezonate' },
      latest_charge: 'ch_test',
      description: null,
      receipt_email: 'buyer@example.com',
      shipping: null,
      ...overrides,
    };
  }

  async function dispatchSucceeded(pi) {
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      id: 'evt_pi_succ',
      data: { object: pi },
    });
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    return res;
  }

  it('inserts a ledger row with correct gross amount for $100 payment', async () => {
    const chain = buildChain({ data: { transaction_id: 'txn_1' }, error: null });
    await dispatchSucceeded(makePaymentIntent({ amount: 10000 }));

    const insertCall = chain.insert.mock.calls[0][0];
    expect(insertCall.amount_gross).toBeCloseTo(100, 2);
  });

  it('calculates platform fee as 5% of gross', async () => {
    const chain = buildChain({ data: { transaction_id: 'txn_1' }, error: null });
    await dispatchSucceeded(makePaymentIntent({ amount: 10000 }));

    const insertCall = chain.insert.mock.calls[0][0];
    expect(insertCall.platform_fee_amount).toBeCloseTo(5.0, 2);
  });

  it('calculates agent fee as 10% of gross', async () => {
    const chain = buildChain({ data: { transaction_id: 'txn_1' }, error: null });
    await dispatchSucceeded(makePaymentIntent({ amount: 10000 }));

    const insertCall = chain.insert.mock.calls[0][0];
    expect(insertCall.agent_fee_amount).toBeCloseTo(10.0, 2);
  });

  it('calculates Stripe fee as 2.9% + $0.30 of gross', async () => {
    const chain = buildChain({ data: { transaction_id: 'txn_1' }, error: null });
    await dispatchSucceeded(makePaymentIntent({ amount: 10000 }));

    const insertCall = chain.insert.mock.calls[0][0];
    expect(insertCall.stripe_fee_amount).toBeCloseTo(3.2, 2); // 2.9 + 0.30
  });

  it('calculates net as ~$81.80 on a $100 payment', async () => {
    const chain = buildChain({ data: { transaction_id: 'txn_1' }, error: null });
    await dispatchSucceeded(makePaymentIntent({ amount: 10000 }));

    const insertCall = chain.insert.mock.calls[0][0];
    expect(insertCall.net_amount).toBeCloseTo(81.8, 2);
  });

  it('sets status to "completed"', async () => {
    const chain = buildChain({ data: { transaction_id: 'txn_1' }, error: null });
    await dispatchSucceeded(makePaymentIntent());

    const insertCall = chain.insert.mock.calls[0][0];
    expect(insertCall.status).toBe('completed');
  });

  it('records revenue_stream from payment intent metadata', async () => {
    const chain = buildChain({ data: { transaction_id: 'txn_1' }, error: null });
    await dispatchSucceeded(makePaymentIntent({ metadata: { revenue_stream: 'rezonate' } }));

    const insertCall = chain.insert.mock.calls[0][0];
    expect(insertCall.revenue_stream).toBe('rezonate');
  });

  it('writes to the ledger table (not another table)', async () => {
    const chain = buildChain({ data: { transaction_id: 'txn_1' }, error: null });
    await dispatchSucceeded(makePaymentIntent());

    expect(mockSupabaseFrom).toHaveBeenCalledWith('ledger');
  });

  it('stores the stripe_payment_intent_id', async () => {
    const chain = buildChain({ data: { transaction_id: 'txn_1' }, error: null });
    await dispatchSucceeded(makePaymentIntent({ id: 'pi_exact_123' }));

    const insertCall = chain.insert.mock.calls[0][0];
    expect(insertCall.stripe_payment_intent_id).toBe('pi_exact_123');
  });

  it('returns 500 and does not swallow a DB insert error', async () => {
    const chain = {};
    ['insert', 'select'].forEach(m => { chain[m] = jest.fn().mockReturnValue(chain); });
    chain.single = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'unique constraint violation', code: '23505' },
    });
    mockSupabaseFrom.mockReturnValue(chain);

    const res = await dispatchSucceeded(makePaymentIntent());
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('throws when revenue stream has no configured Connect account', async () => {
    const chain = buildChain({ data: { transaction_id: 'txn_x' }, error: null });
    const pi = makePaymentIntent({ metadata: { revenue_stream: 'unknown_stream_xyz' } });
    const res = await dispatchSucceeded(pi);
    // unknown stream → handler throws → 500
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ── payment_intent.payment_failed ─────────────────────────────────────────────

describe('payment_intent.payment_failed — ledger status update', () => {
  it('updates ledger status to "failed" for the matching payment intent', async () => {
    const chain = {};
    ['update', 'eq'].forEach(m => { chain[m] = jest.fn().mockReturnValue(chain); });
    chain.single = jest.fn().mockResolvedValue({ data: {}, error: null });
    mockSupabaseFrom.mockReturnValue(chain);

    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      type: 'payment_intent.payment_failed',
      id: 'evt_fail',
      data: { object: { id: 'pi_failed_abc' } },
    });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(chain.update).toHaveBeenCalledWith({ status: 'failed' });
    expect(chain.eq).toHaveBeenCalledWith('stripe_payment_intent_id', 'pi_failed_abc');
  });
});

// ── charge.refunded ───────────────────────────────────────────────────────────

describe('charge.refunded — ledger refund update', () => {
  it('updates ledger status to "refunded"', async () => {
    const chain = {};
    ['update', 'eq'].forEach(m => { chain[m] = jest.fn().mockReturnValue(chain); });
    chain.single = jest.fn().mockResolvedValue({ data: {}, error: null });
    mockSupabaseFrom.mockReturnValue(chain);

    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      type: 'charge.refunded',
      id: 'evt_refund',
      data: {
        object: {
          id: 'ch_refund_test',
          amount_refunded: 5000,
          refunds: { data: [{ reason: 'fraudulent' }] },
        },
      },
    });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'refunded' })
    );
    expect(chain.eq).toHaveBeenCalledWith('stripe_charge_id', 'ch_refund_test');
  });

  it('includes refund_amount and refund_reason in metadata', async () => {
    const chain = {};
    ['update', 'eq'].forEach(m => { chain[m] = jest.fn().mockReturnValue(chain); });
    chain.single = jest.fn().mockResolvedValue({ data: {}, error: null });
    mockSupabaseFrom.mockReturnValue(chain);

    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      type: 'charge.refunded',
      id: 'evt_refund_2',
      data: {
        object: {
          id: 'ch_refund_2',
          amount_refunded: 2500, // $25.00
          refunds: { data: [{ reason: 'duplicate' }] },
        },
      },
    });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    const updateArg = chain.update.mock.calls[0][0];
    expect(updateArg.metadata.refund_amount).toBeCloseTo(25.0, 2);
    expect(updateArg.metadata.refund_reason).toBe('duplicate');
  });
});

// ── payout lifecycle ──────────────────────────────────────────────────────────

describe('payout.created — payout initiation', () => {
  it('sets status to "payout_initiated" and stores the payout id', async () => {
    const chain = {};
    ['update', 'eq', 'in'].forEach(m => { chain[m] = jest.fn().mockReturnValue(chain); });
    chain.single = jest.fn().mockResolvedValue({ data: {}, error: null });
    mockSupabaseFrom.mockReturnValue(chain);

    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      type: 'payout.created',
      id: 'evt_payout_created',
      data: { object: { id: 'po_test_abc', destination: 'acct_galactic', amount: 8180 } },
    });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'payout_initiated', stripe_payout_id: 'po_test_abc' })
    );
    expect(chain.eq).toHaveBeenCalledWith('source_account', 'acct_galactic');
  });
});

describe('payout.paid — payout settlement', () => {
  it('sets status to "payout_completed"', async () => {
    const chain = {};
    ['update', 'eq'].forEach(m => { chain[m] = jest.fn().mockReturnValue(chain); });
    chain.single = jest.fn().mockResolvedValue({ data: {}, error: null });
    mockSupabaseFrom.mockReturnValue(chain);

    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      type: 'payout.paid',
      id: 'evt_payout_paid',
      data: { object: { id: 'po_test_abc', amount: 8180 } },
    });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'payout_completed' })
    );
    expect(chain.eq).toHaveBeenCalledWith('payout_batch_id', 'po_test_abc');
  });
});
