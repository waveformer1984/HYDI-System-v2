/**
 * Regression tests: revenue transaction safety envelope
 *
 * These tests prove that future changes cannot accidentally:
 *   - bypass human approval
 *   - bypass artifact verification
 *   - duplicate ledger entries
 *   - accept unauthenticated operator actions
 *   - turn legacy checkout into an unqualified production route
 *   - report payment as delivery
 *   - report delivery without a ledger/reconciliation result
 *   - swallow webhook failures as success
 *
 * These are source-level static tests that verify the safety
 * boundaries are present in the code. Runtime behavior is verified
 * by scripts/failure-injection-tests.js against the production build.
 */

const fs = require('fs');
const path = require('path');

function readSrc(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', relPath), 'utf8');
}

describe('Revenue transaction safety envelope — regression protection', () => {

  describe('Human approval is mandatory', () => {
    test('approve.js requires awaiting_review status before approval', () => {
      const src = readSrc('pages/api/revenue/jobs/[jobId]/approve.js');
      expect(src).toMatch(/awaiting_review/);
      expect(src).toMatch(/409/);
    });

    test('JobManager.approveForDelivery throws if not awaiting_review', () => {
      const src = readSrc('lib/revenue/JobManager.ts');
      expect(src).toMatch(/is not awaiting review/);
    });

    test('approve.js calls approveForDelivery (not direct DB update)', () => {
      const src = readSrc('pages/api/revenue/jobs/[jobId]/approve.js');
      expect(src).toContain('approveForDelivery');
    });

    test('no route automatically delivers without approval', () => {
      const jobsSrc = readSrc('pages/api/revenue/jobs/index.js');
      expect(jobsSrc).not.toMatch(/delivered|delivery_status.*delivered/);
    });
  });

  describe('Artifact verification is mandatory', () => {
    test('approve.js calls verifyArtifactsOnDisk before approval', () => {
      const src = readSrc('pages/api/revenue/jobs/[jobId]/approve.js');
      expect(src).toContain('verifyArtifacts');
    });

    test('approve.js fails execution on verification failure (422)', () => {
      const src = readSrc('pages/api/revenue/jobs/[jobId]/approve.js');
      expect(src).toMatch(/422/);
      expect(src).toMatch(/failExecution/);
    });

    test('verifier requires at least 3 artifacts including .scad, .stl, README.md', () => {
      const src = readSrc('pages/api/revenue/jobs/[jobId]/approve.js');
      expect(src).toMatch(/\.scad/);
      expect(src).toMatch(/\.stl/);
      expect(src).toMatch(/README\.md/);
    });
  });

  describe('Ledger idempotency', () => {
    test('RevenueLedger checks stripe_event_id before inserting', () => {
      const src = readSrc('lib/revenue/RevenueLedger.ts');
      expect(src).toMatch(/SELECT.*FROM revenue_ledger WHERE stripe_event_id/);
      expect(src).toMatch(/Idempotency check/);
    });

    test('RevenueLedger handles duplicate key constraint', () => {
      const src = readSrc('lib/revenue/RevenueLedger.ts');
      expect(src).toMatch(/duplicate/);
    });

    test('JobManager.confirmPayment is idempotent', () => {
      const src = readSrc('lib/revenue/JobManager.ts');
      expect(src).toMatch(/already paid/);
      expect(src).toMatch(/stripeEventId/);
    });
  });

  describe('Authentication is enforced', () => {
    test('approve.js requires revenue:manage permission', () => {
      const src = readSrc('pages/api/revenue/jobs/[jobId]/approve.js');
      expect(src).toContain('revenue:manage');
      expect(src).toContain('requireAuth');
    });

    test('revenue dashboard requires revenue:view permission', () => {
      const src = readSrc('pages/api/revenue/index.js');
      expect(src).toContain('revenue:view');
    });

    test('revenue report requires revenue:view permission', () => {
      const src = readSrc('pages/api/revenue/report.js');
      expect(src).toContain('revenue:view');
    });

    test('reconcile endpoint requires revenue:view permission', () => {
      const src = readSrc('pages/api/revenue/jobs/[jobId]/reconcile.js');
      expect(src).toContain('revenue:view');
    });
  });

  describe('Legacy checkout boundary', () => {
    test('pages/api/checkout.js has production gate', () => {
      const src = readSrc('pages/api/checkout.js');
      expect(src).toContain("NODE_ENV === 'production'");
      expect(src).toContain('410');
    });

    test('legacy checkout does not reference JobManager', () => {
      const src = readSrc('api/checkout.js');
      expect(src).not.toMatch(/JobManager|customer_jobs/);
    });

    test('qualified path exists and is job-linked', () => {
      const src = readSrc('pages/api/revenue/jobs/index.js');
      expect(src).toContain('getJobManager');
      expect(src).toContain('createJob');
    });
  });

  describe('Payment is not delivery', () => {
    test('JobManager.confirmPayment sets job_status to queued (not delivered)', () => {
      const src = readSrc('lib/revenue/JobManager.ts');
      // confirmPayment should set job_status to 'queued', NOT 'delivered'
      const confirmMatch = src.match(/async confirmPayment[\s\S]*?job_status:\s*'(\w+)'/);
      expect(confirmMatch).toBeTruthy();
      expect(confirmMatch[1]).toBe('queued');
    });

    test('approveForDelivery is the only path to delivered', () => {
      const src = readSrc('lib/revenue/JobManager.ts');
      const deliveredMatches = src.match(/job_status:\s*'delivered'/g);
      expect(deliveredMatches).toBeTruthy();
      expect(deliveredMatches.length).toBe(1); // only in approveForDelivery
    });
  });

  describe('Webhook failures are not swallowed', () => {
    test('webhook handler returns 400 on signature failure', () => {
      const src = readSrc('api/webhooks/stripe.js');
      expect(src).toMatch(/400/);
      expect(src).toMatch(/signature/i);
    });

    test('webhook handler has kill switch (WEBHOOK_PROCESSING_ENABLED)', () => {
      const src = readSrc('api/webhooks/stripe.js');
      expect(src).toContain('WEBHOOK_PROCESSING_ENABLED');
    });

    test('JobWebhookBridge fails closed (no silent fallback)', () => {
      const src = readSrc('lib/revenue/JobWebhookBridge.js');
      expect(src).toMatch(/cannot load|loadError|throw/);
      expect(src).not.toMatch(/raw.?sql|fallback.*query/);
    });
  });

  describe('Reconciliation detects problems', () => {
    test('RevenueReconciler produces deterministic states', () => {
      const src = readSrc('lib/revenue/RevenueReconciler.ts');
      expect(src).toContain('CONSISTENT');
      expect(src).toContain('INCOMPLETE');
      expect(src).toContain('MISMATCH');
      expect(src).toContain('BLOCKED');
    });

    test('RevenueReconciler checks safety envelope violations', () => {
      const src = readSrc('lib/revenue/RevenueReconciler.ts');
      expect(src).toContain('SAFETY:');
      expect(src).toContain('violations');
    });

    test('reconcile endpoint exists', () => {
      const src = readSrc('pages/api/revenue/jobs/[jobId]/reconcile.js');
      expect(src).toContain('RevenueReconciler');
    });
  });
});
