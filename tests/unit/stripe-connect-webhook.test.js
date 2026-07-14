/**
 * Unit tests for Stripe Connect webhook — revenue stream routing, fee structure,
 * and ledger entry creation. No live services required.
 */

const mockConstructEvent = jest.fn();

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    webhooks: { constructEvent: (...args) => mockConstructEvent(...args) },
    charges: {
      retrieve: jest.fn().mockResolvedValue({
        id: 'ch_test',
        billing_details: { email: 'test@example.com', name: 'Test User' },
      }),
    },
  }))
);

const mockRpc = jest.fn().mockResolvedValue({ data: 'claim_test', error: null });

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn().mockReturnValue({
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest
        .fn()
        .mockResolvedValue({
          data: { transaction_id: 'txn_test', amount_gross: 100, net_amount: 81.8 },
          error: null,
        }),
    }),
    rpc: (...args) => mockRpc(...args),
  })),
}));

let handler, determineRevenueStream, FEE_STRUCTURE, REVENUE_STREAM_ACCOUNTS;

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

  handler = require('../../api/stripe-connect-webhook');
  determineRevenueStream = handler.determineRevenueStream;
  FEE_STRUCTURE = handler.FEE_STRUCTURE;
  REVENUE_STREAM_ACCOUNTS = handler.REVENUE_STREAM_ACCOUNTS;
});

function fakeRes() {
  return {
    statusCode: null,
    body: null,
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

describe('webhook idempotency', () => {
  beforeEach(() => {
    mockRpc.mockClear();
    mockConstructEvent.mockReset();
    mockConstructEvent.mockReturnValue({
      id: 'evt_dup_test',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_test', amount: 1000, currency: 'usd', metadata: {} } },
    });
  });

  it('claims the event via claim_webhook_event before processing', async () => {
    mockRpc.mockResolvedValueOnce({ data: 'claim_1', error: null });
    const req = { method: 'POST', headers: { 'stripe-signature': 'sig' }, body: Buffer.from('{}') };
    await handler(req, fakeRes());

    expect(mockRpc).toHaveBeenCalledWith('claim_webhook_event', {
      p_event_id: 'evt_dup_test',
      p_type: 'connect:payment_intent.succeeded',
    });
  });

  it('short-circuits with 200 and does not reprocess when the RPC reports a duplicate', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    const req = { method: 'POST', headers: { 'stripe-signature': 'sig' }, body: Buffer.from('{}') };
    const res = fakeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true, duplicate: true });
  });
});

describe('determineRevenueStream', () => {
  it('uses metadata.revenue_stream when present', () => {
    expect(determineRevenueStream({ metadata: { revenue_stream: 'rezonate' } })).toBe('rezonate');
  });

  it('uses metadata.project_code as fallback', () => {
    expect(determineRevenueStream({ metadata: { project_code: 'lipi_v2' } })).toBe('lipi_v2');
  });

  it('detects galactic_bytes from description', () => {
    expect(
      determineRevenueStream({ metadata: {}, description: 'Galactic Bytes subscription' })
    ).toBe('galactic_bytes');
  });

  it('detects detailer_bot from description', () => {
    expect(
      determineRevenueStream({ metadata: {}, description: 'Detailer Bot monthly plan' })
    ).toBe('detailer_bot');
  });

  it('detects lipi_v2 from description', () => {
    expect(determineRevenueStream({ metadata: {}, description: 'Lipi v2 tier' })).toBe('lipi_v2');
  });

  it('detects protogrance_aromatics from description', () => {
    expect(
      determineRevenueStream({ metadata: {}, description: 'Protogrance aromatic kit' })
    ).toBe('protogrance_aromatics');
  });

  it('detects rezonate from description', () => {
    expect(
      determineRevenueStream({ metadata: {}, description: 'Rezonate premium tier' })
    ).toBe('rezonate');
  });

  it('detects waveformer_studio from description', () => {
    expect(
      determineRevenueStream({ metadata: {}, description: 'Waveformer Studio pro' })
    ).toBe('waveformer_studio');
  });

  it('defaults to galactic_bytes for unknown description', () => {
    expect(
      determineRevenueStream({ metadata: {}, description: 'some unknown service' })
    ).toBe('galactic_bytes');
  });

  it('handles missing metadata gracefully', () => {
    expect(() => determineRevenueStream({ description: 'rezonate plan' })).not.toThrow();
  });
});

describe('FEE_STRUCTURE', () => {
  it('platform fee is 5%', () => {
    expect(FEE_STRUCTURE.platform_fee_percent).toBe(5.0);
  });

  it('agent fee is 10%', () => {
    expect(FEE_STRUCTURE.agent_fee_percent).toBe(10.0);
  });

  it('Stripe percentage fee is 2.9%', () => {
    expect(FEE_STRUCTURE.stripe_fee_percent).toBe(2.9);
  });

  it('Stripe fixed fee is $0.30', () => {
    expect(FEE_STRUCTURE.stripe_fixed_fee).toBe(0.3);
  });

  it('net on $100 payment is ~$81.80', () => {
    const gross = 100;
    const platform = (gross * FEE_STRUCTURE.platform_fee_percent) / 100;
    const agent = (gross * FEE_STRUCTURE.agent_fee_percent) / 100;
    const stripeFee =
      (gross * FEE_STRUCTURE.stripe_fee_percent) / 100 + FEE_STRUCTURE.stripe_fixed_fee;
    expect(gross - platform - agent - stripeFee).toBeCloseTo(81.8, 2);
  });

  it('total deductions on $100 are ~$18.20', () => {
    const gross = 100;
    const platform = (gross * FEE_STRUCTURE.platform_fee_percent) / 100;
    const agent = (gross * FEE_STRUCTURE.agent_fee_percent) / 100;
    const stripeFee =
      (gross * FEE_STRUCTURE.stripe_fee_percent) / 100 + FEE_STRUCTURE.stripe_fixed_fee;
    expect(platform + agent + stripeFee).toBeCloseTo(18.2, 2);
  });
});

describe('REVENUE_STREAM_ACCOUNTS', () => {
  const EXPECTED_STREAMS = [
    'galactic_bytes',
    'detailer_bot',
    'lipi_v2',
    'protogrance_aromatics',
    'rezonate',
    'waveformer_studio',
  ];

  it('contains all 6 revenue streams', () => {
    expect(Object.keys(REVENUE_STREAM_ACCOUNTS)).toEqual(expect.arrayContaining(EXPECTED_STREAMS));
  });

  EXPECTED_STREAMS.forEach(stream => {
    it(`${stream} account is configured`, () => {
      expect(REVENUE_STREAM_ACCOUNTS[stream]).toBeDefined();
      expect(typeof REVENUE_STREAM_ACCOUNTS[stream]).toBe('string');
    });
  });
});
