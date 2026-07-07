'use strict';

/**
 * Stripe provisioning module — WEBHOOK CONFIG ONLY.
 *
 * Hard safety boundary: this module never creates charges, transfers,
 * payouts, or any money movement. It only verifies that the CLI is
 * authenticated and that webhook endpoints exist for the expected URLs.
 * Endpoint creation is gated behind provision() AND runs in TEST mode
 * unless CLOUD_BOOTSTRAP_STRIPE_LIVE=1 is explicitly set.
 */

const { run } = require('./util');

const STRIPE = process.platform === 'win32' ? 'stripe.exe' : 'stripe';

const REQUIRED_WEBHOOK_URLS = [
  // Supabase edge-function webhook (resumes working when the project is restored)
  'https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/stripe-webhook',
];

function liveFlagArgs() {
  return process.env.CLOUD_BOOTSTRAP_STRIPE_LIVE === '1' ? ['--live'] : [];
}

async function verify() {
  const cfg = run(STRIPE, ['config', '--list'], { timeoutMs: 30_000 });
  if (!cfg.ok || !/api_key/.test(cfg.stdout)) {
    return { status: 'blocked', detail: 'stripe CLI not authenticated.', actionRequired: 'Run `stripe login`.' };
  }
  const list = run(STRIPE, ['webhook_endpoints', 'list', '--limit', '30', ...liveFlagArgs()], { timeoutMs: 60_000 });
  if (!list.ok) {
    return { status: 'failed', detail: 'stripe webhook_endpoints list failed (key may be expired — run `stripe login`).' };
  }
  const missing = REQUIRED_WEBHOOK_URLS.filter((url) => !list.stdout.includes(url));
  if (missing.length > 0) {
    return { status: 'failed', detail: `Missing webhook endpoint(s): ${missing.join(', ')}` };
  }
  return { status: 'verified', detail: `All ${REQUIRED_WEBHOOK_URLS.length} required webhook endpoint(s) configured.` };
}

async function provision() {
  const list = run(STRIPE, ['webhook_endpoints', 'list', '--limit', '30', ...liveFlagArgs()], { timeoutMs: 60_000 });
  if (!list.ok) {
    return { status: 'blocked', detail: 'Cannot list webhook endpoints.', actionRequired: 'Run `stripe login` to refresh CLI keys.' };
  }
  const missing = REQUIRED_WEBHOOK_URLS.filter((url) => !list.stdout.includes(url));
  for (const url of missing) {
    const created = run(STRIPE, [
      'webhook_endpoints', 'create',
      '--url', url,
      '--enabled-events', 'checkout.session.completed',
      '--enabled-events', 'payment_intent.succeeded',
      ...liveFlagArgs(),
    ], { timeoutMs: 60_000 });
    if (!created.ok) {
      return { status: 'failed', detail: `Failed to create webhook endpoint for ${url}.` };
    }
  }
  return {
    status: 'verified',
    detail: missing.length > 0 ? `Created ${missing.length} webhook endpoint(s).` : 'All endpoints already existed.',
  };
}

module.exports = { name: 'stripe', verify, provision, REQUIRED_WEBHOOK_URLS };
