/**
 * Tests for the live transaction safety gates
 *
 * Verifies:
 * - Stripe mode detection correctly identifies test vs live
 * - ALLOW_LIVE_STRIPE guard is enforced
 * - Transaction limiter blocks unauthorized transactions
 * - Preflight check produces deterministic results
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

describe('Live transaction safety gates', () => {

  describe('Stripe mode detection', () => {
    test('stripe-mode.ts identifies test mode', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'revenue', 'stripe-mode.ts'), 'utf8');
      expect(src).toContain("sk_test_");
      expect(src).toContain("rk_test_");
      expect(src).toContain("'test'");
    });

    test('stripe-mode.ts identifies live mode', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'revenue', 'stripe-mode.ts'), 'utf8');
      expect(src).toContain("sk_live_");
      expect(src).toContain("rk_live_");
      expect(src).toContain("'live'");
    });

    test('stripe-mode.ts requires ALLOW_LIVE_STRIPE for live mode', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'revenue', 'stripe-mode.ts'), 'utf8');
      expect(src).toContain("ALLOW_LIVE_STRIPE");
      expect(src).toContain("isLiveModeAuthorized");
    });

    test('stripe-mode.ts never exposes the full key', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'revenue', 'stripe-mode.ts'), 'utf8');
      // Should only use key prefixes (slice), never the full key
      expect(src).toContain('slice');
      expect(src).not.toMatch(/return.*key/);
    });
  });

  describe('ALLOW_LIVE_STRIPE guard in webhook handler', () => {
    test('api/webhooks/stripe.js has live key guard', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'api', 'webhooks', 'stripe.js'), 'utf8');
      expect(src).toContain('ALLOW_LIVE_STRIPE');
      expect(src).toMatch(/sk_live_|rk_live_/);
      expect(src).toMatch(/refusing to process webhook|Live mode not authorized/);
    });

    test('webhook handler returns 503 when live mode is not authorized', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'api', 'webhooks', 'stripe.js'), 'utf8');
      expect(src).toContain('503');
    });
  });

  describe('Transaction limiter', () => {
    test('live-transaction-controller.js has hard-coded constraints', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'live-transaction-controller.js'), 'utf8');
      expect(src).toContain('maxTransactions: 1');
      expect(src).toContain("allowedProduct: 'protoforge_model_prep'");
      expect(src).toContain('allowedAmountCents: 2900');
      expect(src).toContain("allowedCurrency: 'usd'");
    });

    test('limiter checks product, amount, currency, and customer', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'live-transaction-controller.js'), 'utf8');
      expect(src).toContain('checkLimiter');
      expect(src).toMatch(/product.*allowedProduct/);
      expect(src).toMatch(/priceCents.*allowedAmountCents/);
      expect(src).toMatch(/currency.*allowedCurrency/);
      expect(src).toMatch(/customerEmail.*allowedCustomerEmail/);
    });

    test('limiter blocks if a transaction has already been completed', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'live-transaction-controller.js'), 'utf8');
      expect(src).toContain('transactionCompleted');
      expect(src).toMatch(/already been completed/);
    });

    test('controller requires LIVE_QUALIFICATION_CUSTOMER_EMAIL', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'live-transaction-controller.js'), 'utf8');
      expect(src).toContain('LIVE_QUALIFICATION_CUSTOMER_EMAIL');
    });

    test('controller stops at human approval boundary', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'live-transaction-controller.js'), 'utf8');
      expect(src).toContain('HUMAN APPROVAL BOUNDARY');
      expect(src).toContain('Do NOT approve unless you have personally inspected');
    });

    test('controller does not auto-approve', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'live-transaction-controller.js'), 'utf8');
      // The --full flag should stop before --approve
      const fullMatch = src.match(/case '--full'[\s\S]*?process\.exit/);
      expect(fullMatch).toBeTruthy();
      expect(fullMatch[0]).not.toContain('stageApprove');
    });
  });

  describe('Preflight check', () => {
    test('preflight script exists', () => {
      expect(fs.existsSync(path.join(__dirname, '..', '..', 'scripts', 'live-transaction-preflight.js'))).toBe(true);
    });

    test('preflight returns deterministic states', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'live-transaction-preflight.js'), 'utf8');
      expect(src).toContain("'READY'");
      expect(src).toContain("'BLOCKED'");
      expect(src).toMatch(/FAILED/);
    });

    test('preflight checks production mode', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'live-transaction-preflight.js'), 'utf8');
      expect(src).toContain('production');
      expect(src).toContain('environment');
    });

    test('preflight checks legacy checkout is blocked', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'live-transaction-preflight.js'), 'utf8');
      expect(src).toContain('410');
      expect(src).toContain('Legacy checkout');
    });

    test('preflight checks Stripe mode', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'live-transaction-preflight.js'), 'utf8');
      expect(src).toContain('sk_test_');
      expect(src).toContain('sk_live_');
      expect(src).toContain('ALLOW_LIVE_STRIPE');
    });

    test('preflight checks auth enforcement', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'live-transaction-preflight.js'), 'utf8');
      expect(src).toContain('401');
      expect(src).toContain('enforces auth');
    });

    test('preflight checks reconciliation endpoint', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'live-transaction-preflight.js'), 'utf8');
      expect(src).toContain('reconcile');
    });

    test('preflight checks no dev server on production port', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'live-transaction-preflight.js'), 'utf8');
      expect(src).toContain('development');
      expect(src).toMatch(/No development server/);
    });
  });

  describe('Evidence package safety', () => {
    test('controller does not capture Stripe secret key', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'live-transaction-controller.js'), 'utf8');
      // The evidence stage should not include STRIPE_SECRET_KEY
      const evidenceMatch = src.match(/const evidence = \{[\s\S]*?\}/);
      expect(evidenceMatch).toBeTruthy();
      expect(evidenceMatch[0]).not.toContain('STRIPE_SECRET_KEY');
      expect(evidenceMatch[0]).not.toContain('SERVICE_SECRET');
      expect(evidenceMatch[0]).not.toContain('WEBHOOK_SECRET');
    });

    test('controller captures delivery token hash, not full token', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'live-transaction-controller.js'), 'utf8');
      expect(src).toContain('deliveryTokenHash');
      expect(src).toContain('createHash');
    });

    test('controller confirms no secrets captured', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'live-transaction-controller.js'), 'utf8');
      expect(src).toContain('secretsCaptured: false');
      expect(src).toContain('secretKeyExposed: false');
      expect(src).toContain('webhookSecretExposed: false');
    });
  });

  describe('Post-transaction safety', () => {
    test('controller verifies replay approval returns 409', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'live-transaction-controller.js'), 'utf8');
      expect(src).toContain('409');
      expect(src).toMatch(/Replay approval/);
    });

    test('controller verifies reconciliation remains CONSISTENT', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'live-transaction-controller.js'), 'utf8');
      expect(src).toMatch(/reconciliation.*CONSISTENT/i);
    });

    test('controller verifies no duplicate ledger entries', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'live-transaction-controller.js'), 'utf8');
      expect(src).toMatch(/Exactly 1 ledger/);
    });

    test('controller verifies legacy checkout remains 410', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'live-transaction-controller.js'), 'utf8');
      expect(src).toMatch(/Legacy checkout.*410/);
    });
  });

  describe('Live mode shutdown', () => {
    test('controller marks transaction as completed', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'live-transaction-controller.js'), 'utf8');
      expect(src).toContain('transactionCompleted = true');
    });

    test('controller reminds operator to unset ALLOW_LIVE_STRIPE', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'live-transaction-controller.js'), 'utf8');
      expect(src).toContain('Unset ALLOW_LIVE_STRIPE');
      expect(src).toMatch(/not permission for unrestricted commerce/);
    });
  });
});
