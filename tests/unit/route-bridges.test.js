/**
 * Regression guard for ISSUES_FOUND.md #31/#33: Next.js (`next dev` /
 * `next start`) only ever serves `pages/api/**` — a bare top-level `api/`
 * directory is a Vercel-only convention, and Vercel deployment is disabled
 * (see CLAUDE.md's Local-First Architecture section). Money-moving routes
 * (checkout, Connect webhook) and the client financial dashboard must have
 * a live `pages/api` bridge, and the duplicate `checkout-v2.js` must not
 * silently come back.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');

describe('payment-critical route bridges are reachable', () => {
  beforeAll(() => {
    process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_fake';
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://fake.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fake_service_key';
  });

  it('checkout-v2.js was removed and did not silently come back', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'api/checkout-v2.js'))).toBe(false);
  });

  it('pages/api/checkout.js bridges to api/checkout.js and exports a callable handler', () => {
    const bridged = require('../../pages/api/checkout.js');
    const direct = require('../../api/checkout.js');
    expect(bridged.default).toBe(direct);
    expect(typeof bridged.default).toBe('function');
  });

  it('pages/api/stripe-connect-webhook.js bridges to api/stripe-connect-webhook.js, including its bodyParser-disabling config', () => {
    const bridged = require('../../pages/api/stripe-connect-webhook.js');
    const direct = require('../../api/stripe-connect-webhook.js');
    expect(bridged.default).toBe(direct);
    expect(bridged.config).toEqual({ api: { bodyParser: false } });
  });

  it('pages/api/client-dashboard.js bridges to api/client-dashboard.js', () => {
    const bridged = require('../../pages/api/client-dashboard.js');
    const direct = require('../../api/client-dashboard.js');
    expect(bridged.default).toBe(direct.default);
    expect(typeof bridged.default).toBe('function');
  });

  it('pages/api/events/stream.js bridges to api/events/stream.js with response-size limiting disabled for SSE', () => {
    const bridged = require('../../pages/api/events/stream.js');
    const direct = require('../../api/events/stream.js');
    expect(bridged.default).toBe(direct.default);
    expect(bridged.config).toEqual({ api: { responseLimit: false } });
  });

  it('the archived legacy Stripe webhook implementations are no longer on any live import path', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'api/webhooks'))).toBe(false);
    expect(fs.existsSync(path.join(REPO_ROOT, 'src/webhook-handlers'))).toBe(false);
    expect(fs.existsSync(path.join(REPO_ROOT, 'stripe-webhook-server.js'))).toBe(false);
  });
});
