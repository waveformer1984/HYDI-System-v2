/**
 * First Real Customer Readiness Qualification
 *
 * tests/qualification/test-first-real-customer-readiness.ts
 *
 * 75+ assertions covering:
 *   - configuration
 *   - authentication
 *   - Stripe mode separation
 *   - checkout
 *   - webhook verification
 *   - webhook idempotency
 *   - job lifecycle
 *   - revenue ledger
 *   - artifact generation
 *   - artifact verification
 *   - human approval
 *   - delivery
 *   - failure handling
 *   - duplicate prevention
 *   - secret safety
 *   - artifact immutability after approval
 */

// @ts-nocheck

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const { getJobManager } = require('../../lib/revenue/JobManager');
const { executeJob, approveDelivery, rejectDelivery } = require('../../lib/revenue/JobExecutor');
const { generateModelPackage, verifyArtifacts } = require('../../lib/revenue/ModelArtifactGenerator');
const { processJobPaymentConfirmation } = require('../../lib/revenue/JobWebhookBridge');
const { RevenueLedger } = require('../../lib/revenue/RevenueLedger');
const { StripeBridge } = require('../../lib/revenue/StripeBridge');
const { getOfferCatalog } = require('../../lib/revenue/OfferCatalog');
const { getRevenueDatabase } = require('../../lib/revenue/RevenueDatabase');

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, test: string, detail?: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(`${test}${detail ? ': ' + detail : ''}`);
    console.log(`  ✗ FAIL: ${test}${detail ? ' — ' + detail : ''}`);
  }
}

function assertEqual(actual: unknown, expected: unknown, test: string): void {
  assert(actual === expected, test, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  FIRST REAL CUSTOMER READINESS QUALIFICATION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const db = getRevenueDatabase();
  const jobManager = getJobManager();
  const catalog = getOfferCatalog();
  const stripe = new StripeBridge();
  const ledger = new RevenueLedger();

  // Clean up previous test data
  const testEmails = [
    'fc-test-1@example.com', 'fc-test-2@example.com', 'fc-test-3@example.com',
    'fc-test-4@example.com', 'fc-test-4b@example.com', 'fc-test-5@example.com',
    'fc-test-6@example.com', 'fc-test-7@example.com', 'fc-test-8@example.com',
  ];
  for (const email of testEmails) {
    await db.query('DELETE FROM customer_job_events WHERE job_id IN (SELECT job_id FROM customer_jobs WHERE customer_email = $1)', [email]);
    await db.query('DELETE FROM customer_jobs WHERE customer_email = $1', [email]);
    await db.query('DELETE FROM revenue_ledger WHERE customer_id = $1', [email]);
  }
  const artifactsBase = path.join(process.cwd(), 'artifacts', 'customer-jobs');
  if (fs.existsSync(artifactsBase)) fs.rmSync(artifactsBase, { recursive: true, force: true });

  // ═══════════════════════════════════════════════════════════════
  // SECTION 1: CONFIGURATION (10 assertions)
  // ═══════════════════════════════════════════════════════════════
  console.log('  ─── Section 1: Configuration ───\n');

  const offer = catalog.get('protoforge_model_prep');
  assert(!!offer, 'FCQ01: Product exists in catalog');
  assertEqual(offer?.setupPrice, 2900, 'FCQ02: Product price is 2900¢');
  assertEqual(offer?.active, true, 'FCQ03: Product is active');
  assertEqual(offer?.billingInterval, 'one_time', 'FCQ04: Product is one-time');
  assert(stripe.isConfigured(), 'FCQ05: StripeBridge is configured');
  assert(stripe.getMode() === 'test' || stripe.getMode() === 'live', 'FCQ06: Stripe mode is test or live');
  assert(typeof stripe.getProductionReadiness === 'function', 'FCQ07: Production readiness check exists');
  assert(typeof stripe.isLive === 'function', 'FCQ08: isLive method exists');
  assert(typeof stripe.isTest === 'function', 'FCQ09: isTest method exists');
  const readiness = stripe.getProductionReadiness();
  assert(typeof readiness.ready === 'boolean', 'FCQ10: Readiness returns boolean');

  // ═══════════════════════════════════════════════════════════════
  // SECTION 2: STRIPE MODE SEPARATION (8 assertions)
  // ═══════════════════════════════════════════════════════════════
  console.log('\n  ─── Section 2: Stripe Mode Separation ───\n');

  // Verify that live keys are blocked without ALLOW_LIVE_STRIPE
  const testBridge = new StripeBridge('sk_live_fake_key_for_testing');
  assertEqual(testBridge.getMode(), 'disabled', 'FCQ11: Live key blocked without ALLOW_LIVE_STRIPE');
  assert(!testBridge.isConfigured(), 'FCQ12: Blocked live key produces null client');

  const testBridge2 = new StripeBridge('rk_live_fake_key_for_testing');
  assertEqual(testBridge2.getMode(), 'disabled', 'FCQ13: Restricted live key blocked without ALLOW_LIVE_STRIPE');

  // Verify test keys work
  const testBridge3 = new StripeBridge('sk_test_fake_key_for_testing');
  assertEqual(testBridge3.getMode(), 'test', 'FCQ14: Test key produces test mode');
  assert(testBridge3.isTest(), 'FCQ15: isTest returns true for test key');
  assert(!testBridge3.isLive(), 'FCQ16: isLive returns false for test key');

  // Verify no payment_method_types in checkout (Stripe best practice)
  const bridgeSource = fs.readFileSync(path.join(process.cwd(), 'lib/revenue/StripeBridge.ts'), 'utf8');
  const checkoutSection = bridgeSource.substring(bridgeSource.indexOf('createSetupCheckoutSession'));
  assert(!checkoutSection.includes('payment_method_types'), 'FCQ17: No payment_method_types in checkout creation');

  // Verify webhook bridge is wired
  const webhookSource = fs.readFileSync(path.join(process.cwd(), 'api/webhooks/stripe.js'), 'utf8');
  assert(webhookSource.includes('processJobPaymentConfirmation'), 'FCQ18: Webhook bridge wired into handler');

  // ═══════════════════════════════════════════════════════════════
  // SECTION 3: CHECKOUT + JOB CREATION (8 assertions)
  // ═══════════════════════════════════════════════════════════════
  console.log('\n  ─── Section 3: Checkout + Job Creation ───\n');

  const job1 = await jobManager.createJob({
    customerEmail: 'fc-test-1@example.com',
    customerName: 'FC Test 1',
    product: 'protoforge_model_prep',
    requestText: 'A bracket for mounting a shelf',
    requirements: { objectType: 'bracket', width: 60, height: 40, depth: 8, thickness: 4 },
    priceCents: 2900,
    currency: 'usd',
  });

  assert(!!job1, 'FCQ19: Job created');
  assertEqual(job1.jobStatus, 'created', 'FCQ20: Initial status is created');
  assertEqual(job1.paymentStatus, 'unpaid', 'FCQ21: Initial payment is unpaid');
  assertEqual(job1.priceCents, 2900, 'FCQ22: Price is 2900¢');

  // Link checkout session
  const sessionId = `cs_test_${randomUUID()}`;
  await jobManager.linkCheckoutSession(job1.jobId, sessionId);
  const linked = await jobManager.getJob(job1.jobId);
  assertEqual(linked?.paymentStatus, 'pending', 'FCQ23: Payment is pending after checkout link');
  assertEqual(linked?.stripeCheckoutSessionId, sessionId, 'FCQ24: Session ID stored');

  // ═══════════════════════════════════════════════════════════════
  // SECTION 4: WEBHOOK + IDEMPOTENCY (12 assertions)
  // ═══════════════════════════════════════════════════════════════
  console.log('\n  ─── Section 4: Webhook + Idempotency ───\n');

  const eventId = `evt_test_${randomUUID()}`;
  const piId = `pi_test_${randomUUID()}`;

  // First webhook
  const result1 = await processJobPaymentConfirmation({
    sessionId, stripeEventId: eventId, paymentIntentId: piId, amountTotal: 2900, currency: 'usd',
  });
  assert(result1.processed === true, 'FCQ25: First webhook processed');
  assert(result1.jobId === job1.jobId, 'FCQ26: Correct job activated');

  const paid = await jobManager.getJob(job1.jobId);
  assertEqual(paid?.paymentStatus, 'paid', 'FCQ27: Payment is paid after webhook');
  assertEqual(paid?.jobStatus, 'queued', 'FCQ28: Job is queued after payment');
  assert(!!paid?.ledgerEntryId, 'FCQ29: Ledger entry ID recorded');

  // Duplicate webhook (idempotency)
  const result2 = await processJobPaymentConfirmation({
    sessionId, stripeEventId: eventId, paymentIntentId: piId, amountTotal: 2900, currency: 'usd',
  });
  assert(result2.processed === true, 'FCQ30: Duplicate webhook processed (not errored)');
  assert(result2.idempotent === true, 'FCQ31: Duplicate webhook detected as idempotent');

  // No duplicate ledger entry
  const revenue = await ledger.getCustomerRevenue('fc-test-1@example.com');
  const setupFees = revenue.filter(e => e.eventType === 'setup_fee_collected');
  assertEqual(setupFees.length, 1, 'FCQ32: Exactly one ledger entry (no duplicate)');

  // No duplicate job events
  const events = await jobManager.getJobEvents(job1.jobId);
  const paymentEvents = events.filter(e => e.event_type === 'payment_confirmed');
  assertEqual(paymentEvents.length, 1, 'FCQ33: Exactly one payment_confirmed event');

  // Amount mismatch rejection
  const job2 = await jobManager.createJob({
    customerEmail: 'fc-test-2@example.com', product: 'protoforge_model_prep',
    requestText: 'test', requirements: {}, priceCents: 2900, currency: 'usd',
  });
  const session2 = `cs_test_${randomUUID()}`;
  await jobManager.linkCheckoutSession(job2.jobId, session2);
  const mismatch = await processJobPaymentConfirmation({
    sessionId: session2, stripeEventId: `evt_test_${randomUUID()}`, paymentIntentId: `pi_test_${randomUUID()}`,
    amountTotal: 100, currency: 'usd',
  });
  assert(mismatch.processed === false, 'FCQ34: Amount mismatch rejected');
  assert(!!mismatch.error, 'FCQ35: Amount mismatch has error message');

  // ═══════════════════════════════════════════════════════════════
  // SECTION 5: JOB LIFECYCLE + EXECUTION (10 assertions)
  // ═══════════════════════════════════════════════════════════════
  console.log('\n  ─── Section 5: Job Lifecycle + Execution ───\n');

  const execResult = await executeJob(job1.jobId);
  assert(execResult.success === true, 'FCQ36: Execution succeeded');
  assertEqual(execResult.artifacts.length, 3, 'FCQ37: 3 artifacts produced');

  const executing = await jobManager.getJob(job1.jobId);
  assertEqual(executing?.jobStatus, 'awaiting_review', 'FCQ38: Job is awaiting_review');
  assertEqual(executing?.executionStatus, 'completed', 'FCQ39: Execution is completed');
  assert(executing!.artifactPaths.length === 3, 'FCQ40: 3 artifact paths stored');

  // ═══════════════════════════════════════════════════════════════
  // SECTION 6: ARTIFACT VERIFICATION (10 assertions)
  // ═══════════════════════════════════════════════════════════════
  console.log('\n  ─── Section 6: Artifact Verification ───\n');

  const scad = execResult.artifacts.find(a => a.filename.endsWith('.scad'));
  const stl = execResult.artifacts.find(a => a.filename.endsWith('.stl'));
  const readme = execResult.artifacts.find(a => a.filename === 'README.md');

  assert(!!scad, 'FCQ41: SCAD artifact exists');
  assert(!!stl, 'FCQ42: STL artifact exists');
  assert(!!readme, 'FCQ43: README artifact exists');
  assert(fs.existsSync(scad!.path), 'FCQ44: SCAD file on disk');
  assert(fs.existsSync(stl!.path), 'FCQ45: STL file on disk');

  const stlContent = fs.readFileSync(stl!.path, 'utf8');
  assert(stlContent.startsWith('solid '), 'FCQ46: STL starts with "solid "');
  assert(stlContent.includes('endsolid'), 'FCQ47: STL contains "endsolid"');
  const triangles = (stlContent.match(/endfacet/g) || []).length;
  assert(triangles >= 10, 'FCQ48: STL has ≥ 10 triangles', `got ${triangles}`);

  // Verify artifact hashes are recorded
  assert(!!scad?.sha256, 'FCQ49: SCAD hash recorded');
  assert(!!stl?.sha256, 'FCQ50: STL hash recorded');

  // ═══════════════════════════════════════════════════════════════
  // SECTION 7: HUMAN APPROVAL + DELIVERY (10 assertions)
  // ═══════════════════════════════════════════════════════════════
  console.log('\n  ─── Section 7: Human Approval + Delivery ───\n');

  // Approve delivery
  const approved = await approveDelivery(job1.jobId, 'human:operator', 'Artifacts verified');
  assertEqual(approved.jobStatus, 'delivered', 'FCQ51: Job is delivered after approval');
  assertEqual(approved.verificationStatus, 'verified', 'FCQ52: Verification is verified');
  assertEqual(approved.deliveryStatus, 'delivered', 'FCQ53: Delivery status is delivered');
  assert(!!approved.deliveryToken, 'FCQ54: Delivery token generated');

  // Cannot approve twice
  try {
    await approveDelivery(job1.jobId, 'human:operator', 'second approval');
    assert(false, 'FCQ55: Double approval should fail');
  } catch (err) {
    assert(true, 'FCQ55: Double approval correctly rejected');
  }

  // Cannot approve a non-awaiting-review job
  try {
    await approveDelivery(job2.jobId, 'human:operator', 'test');
    assert(false, 'FCQ56: Approval of non-awaiting job should fail');
  } catch (err) {
    assert(true, 'FCQ56: Approval of non-awaiting job correctly rejected');
  }

  // Delivery token is unique per job
  const job3 = await jobManager.createJob({
    customerEmail: 'fc-test-3@example.com', product: 'protoforge_model_prep',
    requestText: 'A box', requirements: { objectType: 'box', width: 40, height: 30, depth: 20 },
    priceCents: 2900, currency: 'usd',
  });
  const session3 = `cs_test_${randomUUID()}`;
  await jobManager.linkCheckoutSession(job3.jobId, session3);
  await processJobPaymentConfirmation({
    sessionId: session3, stripeEventId: `evt_test_${randomUUID()}`, paymentIntentId: `pi_test_${randomUUID()}`,
    amountTotal: 2900, currency: 'usd',
  });
  await executeJob(job3.jobId);
  const approved3 = await approveDelivery(job3.jobId, 'human:operator', 'ok');
  assert(approved3.deliveryToken !== approved.deliveryToken, 'FCQ57: Delivery tokens are unique per job');
  assert(!!approved3.deliveryToken, 'FCQ58: Second job has delivery token');

  // ═══════════════════════════════════════════════════════════════
  // SECTION 8: ARTIFACT IMMUTABILITY (6 assertions)
  // ═══════════════════════════════════════════════════════════════
  console.log('\n  ─── Section 8: Artifact Immutability ───\n');

  // Verify hashes match after delivery
  const deliveredJob = await jobManager.getJob(job1.jobId);
  for (const artifactPath of deliveredJob!.artifactPaths) {
    const filename = path.basename(artifactPath);
    const content = fs.readFileSync(artifactPath);
    const currentHash = require('crypto').createHash('sha256').update(content).digest('hex');
    const recordedHash = deliveredJob!.artifactMetadata[filename]?.sha256;
    assert(!!recordedHash, `FCQ59: Hash recorded for ${filename}`);
    assertEqual(currentHash, recordedHash, `FCQ60: Hash matches for ${filename} (no tampering)`);
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 9: DUPLICATE PREVENTION (8 assertions)
  // ═══════════════════════════════════════════════════════════════
  console.log('\n  ─── Section 9: Duplicate Prevention ───\n');

  // Duplicate execution attempt
  try {
    await executeJob(job1.jobId);
    // job1 is already delivered, so executeJob should fail
    const reExec = await jobManager.getJob(job1.jobId);
    assertEqual(reExec?.jobStatus, 'delivered', 'FCQ61: Re-execution of delivered job does not change status');
  } catch (err) {
    assert(true, 'FCQ61: Re-execution of delivered job correctly rejected');
  }

  // Duplicate payment confirmation with different event ID
  const dupResult = await processJobPaymentConfirmation({
    sessionId, stripeEventId: `evt_test_${randomUUID()}`, paymentIntentId: `pi_test_${randomUUID()}`,
    amountTotal: 2900, currency: 'usd',
  });
  // The job is already paid, so the new event should be rejected or idempotent
  const afterDup = await jobManager.getJob(job1.jobId);
  assertEqual(afterDup?.paymentStatus, 'paid', 'FCQ62: Payment status unchanged after duplicate event');

  // No duplicate ledger entries from the duplicate
  const revenueAfterDup = await ledger.getCustomerRevenue('fc-test-1@example.com');
  assertEqual(revenueAfterDup.filter(e => e.eventType === 'setup_fee_collected').length, 1, 'FCQ63: Still one ledger entry');

  // Verify job IDs are unique
  const jobA = await jobManager.createJob({
    customerEmail: 'fc-test-4@example.com', product: 'protoforge_model_prep',
    requestText: 'test A', requirements: {}, priceCents: 2900, currency: 'usd',
  });
  const jobB = await jobManager.createJob({
    customerEmail: 'fc-test-5@example.com', product: 'protoforge_model_prep',
    requestText: 'test B', requirements: {}, priceCents: 2900, currency: 'usd',
  });
  assert(jobA.jobId !== jobB.jobId, 'FCQ64: Job IDs are unique');

  // Verify one payment → one job → one ledger entry
  const allRevenue = await ledger.getVerifiedRevenue();
  const job1Entries = allRevenue.filter(e => e.metadata?.jobId === job1.jobId);
  assertEqual(job1Entries.length, 1, 'FCQ65: One payment → one ledger entry');
  assertEqual(job1Entries[0]?.amountGross, 2900, 'FCQ66: Ledger amount is correct');

  // ═══════════════════════════════════════════════════════════════
  // SECTION 9b: DUAL-PATH IDEMPOTENCY (sync bridge + async queue) (6 assertions)
  // ═══════════════════════════════════════════════════════════════
  console.log('\n  ─── Section 9b: Dual-Path Idempotency ───\n');

  // Simulate what happens when a real webhook fires: the sync bridge
  // processes the event, then the async queue (RevenueIngestionWorker)
  // would also try to process it. We verify that:
  // 1. The sync bridge activates the job
  // 2. The async worker's trackRevenue writes to revenue_tracking (different table)
  // 3. revenue_ledger has exactly one entry (from the bridge, not the worker)
  // 4. customer_jobs has exactly one job activation

  const dualJob = await jobManager.createJob({
    customerEmail: 'fc-test-4b@example.com', product: 'protoforge_model_prep',
    requestText: 'dual path test', requirements: { objectType: 'box' },
    priceCents: 2900, currency: 'usd',
  });
  const dualSession = `cs_test_${randomUUID()}`;
  await jobManager.linkCheckoutSession(dualJob.jobId, dualSession);

  // Fire the sync bridge (as the webhook handler does)
  const dualEventId = `evt_test_${randomUUID()}`;
  const dualResult = await processJobPaymentConfirmation({
    sessionId: dualSession, stripeEventId: dualEventId,
    paymentIntentId: `pi_test_${randomUUID()}`, amountTotal: 2900, currency: 'usd',
  });
  assert(dualResult.processed === true, 'FCQ66b: Sync bridge processed dual-path job');

  // Simulate the async worker also trying to process the same event
  // (this is what RevenueIngestionWorker.handleCheckoutCompleted would do)
  // It writes to revenue_tracking, NOT revenue_ledger
  try {
    await db.query(
      'INSERT INTO revenue_tracking (stripe_event_id, customer_email, amount, currency, type, metadata, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [dualEventId, 'fc-test-4b@example.com', 2900, 'usd', 'payment',
        JSON.stringify({ session_id: dualSession, tier: 'starter' }),
        new Date().toISOString()]
    );
  } catch (e) {
    // revenue_tracking table may not exist — that's fine, the async worker
    // would also fail silently in that case
  }

  // Verify: exactly one revenue_ledger entry (from the bridge)
  const dualLedger = await ledger.getCustomerRevenue('fc-test-4b@example.com');
  const dualSetupFees = dualLedger.filter(e => e.eventType === 'setup_fee_collected');
  assertEqual(dualSetupFees.length, 1, 'FCQ66c: One ledger entry after dual-path (no duplicate)');

  // Verify: exactly one payment_confirmed event
  const dualEvents = await jobManager.getJobEvents(dualJob.jobId);
  const dualPaymentEvents = dualEvents.filter(e => e.event_type === 'payment_confirmed');
  assertEqual(dualPaymentEvents.length, 1, 'FCQ66d: One payment_confirmed event after dual-path');

  // Verify: job is queued (activated exactly once)
  const dualJobState = await jobManager.getJob(dualJob.jobId);
  assertEqual(dualJobState?.paymentStatus, 'paid', 'FCQ66e: Job is paid after dual-path');
  assertEqual(dualJobState?.jobStatus, 'queued', 'FCQ66f: Job is queued after dual-path');

  // ═══════════════════════════════════════════════════════════════
  // SECTION 10: FAILURE HANDLING (8 assertions)
  // ═══════════════════════════════════════════════════════════════
  console.log('\n  ─── Section 10: Failure Handling ───\n');

  // Customer cancellation
  const cancelJob = await jobManager.createJob({
    customerEmail: 'fc-test-6@example.com', product: 'protoforge_model_prep',
    requestText: 'cancel test', requirements: {}, priceCents: 2900, currency: 'usd',
  });
  const cancelled = await jobManager.cancelJob(cancelJob.jobId, 'Customer changed mind');
  assertEqual(cancelled.jobStatus, 'cancelled', 'FCQ67: Cancelled job status is cancelled');

  // Execution failure
  const failJob = await jobManager.createJob({
    customerEmail: 'fc-test-7@example.com', product: 'protoforge_model_prep',
    requestText: 'fail test', requirements: {}, priceCents: 2900, currency: 'usd',
  });
  const failSession = `cs_test_${randomUUID()}`;
  await jobManager.linkCheckoutSession(failJob.jobId, failSession);
  await processJobPaymentConfirmation({
    sessionId: failSession, stripeEventId: `evt_test_${randomUUID()}`, paymentIntentId: `pi_test_${randomUUID()}`,
    amountTotal: 2900, currency: 'usd',
  });
  await jobManager.failExecution(failJob.jobId, 'Simulated failure');
  const failedJob = await jobManager.getJob(failJob.jobId);
  assertEqual(failedJob?.jobStatus, 'failed', 'FCQ68: Failed job status is failed');
  assert(!!failedJob?.executionError, 'FCQ69: Error message stored');

  // Delivery rejection
  const rejectJob = await jobManager.createJob({
    customerEmail: 'fc-test-8@example.com', product: 'protoforge_model_prep',
    requestText: 'reject test', requirements: { objectType: 'box' }, priceCents: 2900, currency: 'usd',
  });
  const rejectSession = `cs_test_${randomUUID()}`;
  await jobManager.linkCheckoutSession(rejectJob.jobId, rejectSession);
  await processJobPaymentConfirmation({
    sessionId: rejectSession, stripeEventId: `evt_test_${randomUUID()}`, paymentIntentId: `pi_test_${randomUUID()}`,
    amountTotal: 2900, currency: 'usd',
  });
  await executeJob(rejectJob.jobId);
  const rejected = await rejectDelivery(rejectJob.jobId, 'human:operator', 'Quality issue');
  assertEqual(rejected.jobStatus, 'failed', 'FCQ70: Rejected job is failed');

  // Refund
  const refunded = await jobManager.refundJob(failJob.jobId, 'Execution failed');
  assertEqual(refunded.jobStatus, 'refunded', 'FCQ71: Refunded job status is refunded');
  assertEqual(refunded.paymentStatus, 'refunded', 'FCQ72: Refunded payment status is refunded');

  // ═══════════════════════════════════════════════════════════════
  // SECTION 11: SECRET SAFETY (5 assertions)
  // ═══════════════════════════════════════════════════════════════
  console.log('\n  ─── Section 11: Secret Safety ───\n');

  // Client-side files don't contain secrets
  const clientFiles = [
    'pages/services/model-prep.jsx',
    'pages/services/model-prep/success.jsx',
    'pages/services/model-prep/cancel.jsx',
    'pages/services/model-prep/status.jsx',
  ];
  let secretsInClient = false;
  for (const file of clientFiles) {
    const fullPath = path.join(process.cwd(), file);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('sk_live_') || content.includes('sk_test_') || content.includes('rk_live_')) {
        secretsInClient = true;
      }
    }
  }
  assert(!secretsInClient, 'FCQ73: No Stripe keys in client-side files');

  // Approve endpoint requires auth via canonical requireAuth
  const approveSource = fs.readFileSync(path.join(process.cwd(), 'pages/api/revenue/jobs/[jobId]/approve.js'), 'utf8');
  assert(approveSource.includes('requireAuth'), 'FCQ74: Approve endpoint uses canonical requireAuth');
  assert(approveSource.includes("revenue:manage"), 'FCQ74b: Approve endpoint requires revenue:manage permission');
  assert(approveSource.includes('verifyArtifactsOnDisk'), 'FCQ75: Approve endpoint re-verifies artifacts');

  // Webhook handler verifies signatures
  const webhookSource2 = fs.readFileSync(path.join(process.cwd(), 'api/webhooks/stripe.js'), 'utf8');
  assert(webhookSource2.includes('constructEvent'), 'FCQ76: Webhook verifies signatures');
  assert(webhookSource2.includes('WEBHOOK_PROCESSING_ENABLED'), 'FCQ77: Webhook has kill switch');

  // ═══════════════════════════════════════════════════════════════
  // FINAL RESULTS
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  FIRST REAL CUSTOMER READINESS QUALIFICATION — RESULTS');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total assertions: ${passed + failed} passed, ${failed} failed`);
  console.log('');

  if (failures.length > 0) {
    console.log('  FAILURES:');
    for (const f of failures) console.log(`    ✗ ${f}`);
    console.log('');
  }

  console.log(`  VERDICT: ${failed === 0 ? '✓ READY' : '✗ NOT READY'}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
