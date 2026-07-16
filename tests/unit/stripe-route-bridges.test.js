/**
 * Reachability regression tests for the payment-critical routes bridged
 * into pages/api/ (see ISSUES_FOUND.md #33 / DEPLOYMENT.md): Next.js's
 * `next dev`/`next start` only ever serves pages/api/**, never the
 * top-level api/ directory (a Vercel-only convention, and Vercel
 * deployment is disabled -- see CLAUDE.md's Local-First Architecture
 * section). Checkout and both Stripe webhook handlers were completely
 * unreachable in production until these bridge files were added. These
 * tests guard against the bridge files silently breaking (e.g. a typo'd
 * relative path, or losing the `config` re-export).
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
  jest.fn().mockImplementation(() => ({ handleWebhook: jest.fn() }))
);
jest.mock('stripe', () => jest.fn().mockImplementation(() => ({ webhooks: { constructEvent: jest.fn() } })));

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  process.env.STRIPE_HYDI_STARTER_PRICE_ID = 'price_starter';
  process.env.STRIPE_HYDI_PRO_PRICE_ID = 'price_pro';
  process.env.STRIPE_HYDI_ENTERPRISE_PRICE_ID = 'price_enterprise';
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect_fake';
  process.env.STRIPE_WEBHOOK_SECRET_01 = 'whsec_fake';
});

describe('pages/api bridge files', () => {
  it('pages/api/checkout.js resolves to a callable handler', () => {
    const mod = require('../../pages/api/checkout.js');
    expect(typeof mod.default).toBe('function');
  });

  it('pages/api/stripe-connect-webhook.js resolves to a callable handler with bodyParser disabled', () => {
    const mod = require('../../pages/api/stripe-connect-webhook.js');
    expect(typeof mod.default).toBe('function');
    expect(mod.config).toEqual({ api: { bodyParser: false } });
  });

  it('pages/api/webhooks/stripe.js resolves to a callable handler with bodyParser disabled', () => {
    const mod = require('../../pages/api/webhooks/stripe.js');
    expect(typeof mod.default).toBe('function');
    expect(mod.config).toEqual({ api: { bodyParser: false } });
  });

  it('each bridge points at the still-existing source file under api/ (no dangling path)', () => {
    const fs = require('fs');
    const path = require('path');
    expect(fs.existsSync(path.join(__dirname, '../../api/checkout.js'))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, '../../api/stripe-connect-webhook.js'))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, '../../api/webhooks/stripe.js'))).toBe(true);
    // checkout-v2.js was deleted as a duplicate -- guard against it (or a bridge to it) coming back.
    expect(fs.existsSync(path.join(__dirname, '../../api/checkout-v2.js'))).toBe(false);
    expect(fs.existsSync(path.join(__dirname, '../../pages/api/checkout-v2.js'))).toBe(false);
  });
});
