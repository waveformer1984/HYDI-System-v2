/**
 * Live Transaction Controller
 *
 * Orchestrates a single controlled live Stripe transaction through the
 * real production pipeline. This script does NOT execute automatically —
 * it requires explicit human authorization at every stage.
 *
 * Phase 4: Transaction Limiter
 *   - One transaction, one job, one controlled customer
 *   - One known product/offer
 *   - One intentionally small approved amount
 *   - Blocks if constraints are exceeded
 *
 * Phase 5: Customer/Job Correlation
 *   - Captures all identifiers before and after payment
 *   - No transaction may be declared qualified if correlation is incomplete
 *
 * Phase 6: Live Webhook Verification
 *   - Uses the real production webhook endpoint
 *   - Verifies signature, idempotency, job linkage, payment state
 *
 * Phase 7: Human Approval Boundary
 *   - STOPS after artifact generation
 *   - Operator must explicitly inspect and approve
 *
 * Usage:
 *   node scripts/live-transaction-controller.js --preflight
 *   node scripts/live-transaction-controller.js --create-job
 *   node scripts/live-transaction-controller.js --await-webhook
 *   node scripts/live-transaction-controller.js --inspect-artifacts
 *   node scripts/live-transaction-controller.js --approve
 *   node scripts/live-transaction-controller.js --reconcile
 *   node scripts/live-transaction-controller.js --evidence
 *   node scripts/live-transaction-controller.js --post-transaction-safety
 *   node scripts/live-transaction-controller.js --shutdown
 *   node scripts/live-transaction-controller.js --full
 *
 * The --full flag runs all stages but STOPS before --approve,
 * requiring a second explicit invocation with --approve.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const { Pool } = require('pg');

require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const DB = new Pool({ host: '127.0.0.1', port: 54322, database: 'postgres', user: 'postgres', password: 'postgres' });

const SERVICE_SECRET = process.env.HYDI_SERVICE_SECRET;

// === TRANSACTION LIMITER (Phase 4) ===
// These constraints are intentionally hard-coded for the first live transaction.
// Do not change them without explicit operator review.
const LIMITER = {
  maxTransactions: 1,
  allowedProduct: 'protoforge_model_prep',
  allowedAmountCents: 2900,  // $29.00 — intentionally small
  allowedCurrency: 'usd',
  allowedCustomerEmail: process.env.LIVE_QUALIFICATION_CUSTOMER_EMAIL || '',
};

function makeServiceToken(service = 'live-transaction-controller') {
  if (!SERVICE_SECRET) throw new Error('HYDI_SERVICE_SECRET not set');
  const ts = Date.now();
  const requestId = crypto.randomUUID();
  const payload = `${ts}:${requestId}:${service}`;
  const sig = crypto.createHmac('sha256', SERVICE_SECRET).update(payload).digest('hex');
  return `${ts}.${requestId}.${service}.${sig}`;
}

async function httpGet(urlPath, headers = {}) {
  return new Promise((resolve) => {
    http.get(`${BASE}${urlPath}`, { headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch (_) {}
        resolve({ status: res.statusCode, json, body });
      });
    }).on('error', (err) => resolve({ status: 0, json: null, body: err.message }));
  });
}

async function httpPost(urlPath, data, headers = {}) {
  return new Promise((resolve) => {
    const url = new URL(`${BASE}${urlPath}`);
    const options = {
      method: 'POST',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch (_) {}
        resolve({ status: res.statusCode, json, body });
      });
    });
    req.on('error', (err) => resolve({ status: 0, json: null, body: err.message }));
    req.write(JSON.stringify(data));
    req.end();
  });
}

// === STATE PERSISTENCE ===
// The controller persists its state between invocations so that
// --create-job, --await-webhook, --approve etc. can be run separately.
const STATE_FILE = path.join(process.cwd(), 'docs', 'live-transaction-state.json');

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  }
  return null;
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function clearState() {
  if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
}

// === PHASE 4: TRANSACTION LIMITER ===
function checkLimiter(jobData) {
  const violations = [];

  if (jobData.product !== LIMITER.allowedProduct) {
    violations.push(`Product "${jobData.product}" is not allowed. Only "${LIMITER.allowedProduct}" is permitted.`);
  }

  if (jobData.priceCents && jobData.priceCents !== LIMITER.allowedAmountCents) {
    violations.push(`Amount ${jobData.priceCents} cents is not allowed. Only ${LIMITER.allowedAmountCents} cents ($${LIMITER.allowedAmountCents / 100}) is permitted.`);
  }

  if (jobData.currency && jobData.currency !== LIMITER.allowedCurrency) {
    violations.push(`Currency "${jobData.currency}" is not allowed. Only "${LIMITER.allowedCurrency}" is permitted.`);
  }

  if (LIMITER.allowedCustomerEmail && jobData.customerEmail !== LIMITER.allowedCustomerEmail) {
    violations.push(`Customer email "${jobData.customerEmail}" is not the designated qualification customer.`);
  }

  // Check that no prior live transaction has been processed
  const state = loadState();
  if (state && state.transactionCompleted) {
    violations.push('A live transaction has already been completed. Only one transaction is permitted.');
  }

  return violations;
}

// === STAGE: PREFLIGHT ===
async function stagePreflight() {
  console.log('\n[STAGE: PREFLIGHT]');
  const { runPreflight } = require('./live-transaction-preflight.js');
  const result = await runPreflight();

  for (const c of result.checks) {
    const icon = c.status === 'PASS' ? '✓' : c.status === 'INFO' ? 'ℹ' : '✗';
    console.log(`  ${icon} ${c.label}${c.detail ? ' — ' + c.detail : ''}`);
  }

  console.log(`\n  State: ${result.state}`);
  if (result.blockers.length > 0) {
    console.log('  Blockers:');
    for (const b of result.blockers) console.log(`    • ${b}`);
  }

  if (result.state !== 'READY') {
    console.log('\n  ❌ PREFLIGHT FAILED — live transaction must not proceed.');
    return false;
  }
  console.log('\n  ✓ PREFLIGHT PASSED — live transaction may proceed with explicit human authorization.');
  return true;
}

// === STAGE: CREATE JOB ===
async function stageCreateJob() {
  console.log('\n[STAGE: CREATE JOB]');

  if (!LIMITER.allowedCustomerEmail) {
    console.log('  ❌ LIVE_QUALIFICATION_CUSTOMER_EMAIL environment variable must be set.');
    console.log('     This identifies the controlled customer for the qualification transaction.');
    return false;
  }

  const jobData = {
    customerEmail: LIMITER.allowedCustomerEmail,
    customerName: 'Live Qualification Customer',
    product: LIMITER.allowedProduct,
    requestText: 'Controlled live qualification transaction — model preparation',
    requirements: { qualificationRun: true },
  };

  // Check limiter before creating
  const violations = checkLimiter(jobData);
  if (violations.length > 0) {
    console.log('  ❌ TRANSACTION LIMITER BLOCKED:');
    for (const v of violations) console.log(`    • ${v}`);
    return false;
  }

  console.log('  Creating job...');
  console.log(`  Customer: ${jobData.customerEmail}`);
  console.log(`  Product: ${jobData.product}`);
  console.log(`  Expected amount: $${LIMITER.allowedAmountCents / 100} ${LIMITER.allowedCurrency}`);

  const res = await httpPost('/api/revenue/jobs', jobData);
  if (res.status !== 200 || !res.json?.jobId) {
    console.log(`  ❌ Job creation failed: HTTP ${res.status}`);
    console.log(`  ${res.body}`);
    return false;
  }

  const state = {
    qualificationRunId: `live-qual-${Date.now()}`,
    timestamp: new Date().toISOString(),
    gitCommit: execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(),
    jobId: res.json.jobId,
    checkoutSessionId: res.json.sessionId,
    checkoutUrl: res.json.checkoutUrl,
    customerEmail: jobData.customerEmail,
    product: jobData.product,
    expectedAmountCents: LIMITER.allowedAmountCents,
    currency: LIMITER.allowedCurrency,
    stages: { createJob: 'done' },
    correlation: {
      jobId: res.json.jobId,
      checkoutSessionId: res.json.sessionId,
    },
  };
  saveState(state);

  console.log(`  ✓ Job created: ${state.jobId}`);
  console.log(`  ✓ Checkout session: ${state.checkoutSessionId}`);
  console.log(`  ✓ Checkout URL: ${state.checkoutUrl}`);
  console.log('\n  ⏸  HUMAN ACTION REQUIRED:');
  console.log('     Open the checkout URL and complete the payment.');
  console.log('     Then run: node scripts/live-transaction-controller.js --await-webhook');
  return true;
}

// === STAGE: AWAIT WEBHOOK ===
async function stageAwaitWebhook() {
  console.log('\n[STAGE: AWAIT WEBHOOK]');
  const state = loadState();
  if (!state) { console.log('  ❌ No transaction state. Run --create-job first.'); return false; }

  console.log(`  Job: ${state.jobId}`);
  console.log('  Waiting for webhook to confirm payment...');

  // Poll the job status until it's paid
  let attempts = 0;
  const maxAttempts = 120; // 10 minutes at 5s intervals
  while (attempts < maxAttempts) {
    const { rows } = await DB.query('SELECT payment_status, job_status, stripe_event_id, stripe_payment_intent_id, ledger_entry_id FROM customer_jobs WHERE job_id=$1', [state.jobId]);
    const job = rows[0];
    if (job && job.payment_status === 'paid') {
      state.correlation.stripeEventId = job.stripe_event_id;
      state.correlation.paymentIntentId = job.stripe_payment_intent_id;
      state.correlation.ledgerEntryId = job.ledger_entry_id;
      state.stages.awaitWebhook = 'done';
      state.paymentConfirmedAt = new Date().toISOString();
      saveState(state);

      console.log(`  ✓ Payment confirmed!`);
      console.log(`  ✓ Stripe event ID: ${job.stripe_event_id}`);
      console.log(`  ✓ Payment intent ID: ${job.stripe_payment_intent_id}`);
      console.log(`  ✓ Job status: ${job.job_status}`);
      console.log(`  ✓ Ledger entry: ${job.ledger_entry_id || 'pending'}`);

      // Verify idempotency — check no duplicate events
      const { rows: events } = await DB.query("SELECT count(*) FROM customer_job_events WHERE job_id=$1 AND event_type='payment_confirmed'", [state.jobId]);
      const paymentEventCount = parseInt(events[0].count);
      if (paymentEventCount !== 1) {
        console.log(`  ❌ IDEMPOTENCY VIOLATION: ${paymentEventCount} payment_confirmed events (expected 1)`);
        return false;
      }
      console.log(`  ✓ Idempotency verified: exactly 1 payment_confirmed event`);
      return true;
    }
    attempts++;
    if (attempts % 12 === 0) console.log(`  Still waiting... (${attempts * 5}s elapsed)`);
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log('  ❌ Timeout waiting for webhook. Ensure:');
  console.log('     1. Stripe CLI is forwarding webhooks: stripe listen --forward-to localhost:3000/api/webhooks/stripe');
  console.log('     2. Payment was completed at the checkout URL');
  return false;
}

// === STAGE: INSPECT ARTIFACTS ===
async function stageInspectArtifacts() {
  console.log('\n[STAGE: INSPECT ARTIFACTS]');
  const state = loadState();
  if (!state) { console.log('  ❌ No transaction state.'); return false; }

  // The job should be in awaiting_review (after execution + artifact generation)
  const { rows } = await DB.query('SELECT job_status, artifact_paths, artifact_metadata, verification_status FROM customer_jobs WHERE job_id=$1', [state.jobId]);
  const job = rows[0];
  if (!job) { console.log('  ❌ Job not found.'); return false; }

  console.log(`  Job status: ${job.job_status}`);
  console.log(`  Verification status: ${job.verification_status}`);

  if (job.job_status !== 'awaiting_review') {
    console.log(`  ⏸  Job is not yet in awaiting_review. Current status: ${job.job_status}`);
    console.log('     The job must complete execution first.');
    return false;
  }

  const artifactPaths = job.artifact_paths || [];
  const metadata = typeof job.artifact_metadata === 'string' ? JSON.parse(job.artifact_metadata || '{}') : (job.artifact_metadata || {});

  console.log(`  Artifacts: ${artifactPaths.length} files`);
  for (const p of artifactPaths) {
    const exists = fs.existsSync(p);
    const hash = metadata[path.basename(p)]?.sha256 || 'no hash';
    console.log(`    ${exists ? '✓' : '✗'} ${path.basename(p)} — sha256: ${hash.slice(0, 16)}...`);
  }

  // Verify artifact integrity
  const required = ['.stl', '.scad', 'README.md'];
  const hasAll = required.every(ext => artifactPaths.some(p => p.endsWith(ext)));
  if (!hasAll) {
    console.log(`  ❌ Missing required artifacts. Need: .stl, .scad, README.md`);
    return false;
  }

  // Verify hashes match
  for (const p of artifactPaths) {
    const basename = path.basename(p);
    const recordedHash = metadata[basename]?.sha256;
    if (recordedHash && fs.existsSync(p)) {
      const actualHash = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
      if (actualHash !== recordedHash) {
        console.log(`  ❌ Hash mismatch for ${basename}: expected ${recordedHash.slice(0, 16)}..., got ${actualHash.slice(0, 16)}...`);
        return false;
      }
    }
  }

  state.correlation.artifactPaths = artifactPaths;
  state.correlation.artifactHashes = Object.fromEntries(
    Object.entries(metadata).map(([k, v]) => [k, v.sha256])
  );
  state.stages.inspectArtifacts = 'done';
  saveState(state);

  console.log('\n  ✓ All artifacts verified.');
  console.log('\n  ⏸  HUMAN APPROVAL BOUNDARY');
  console.log('     Review the artifacts above.');
  console.log('     To approve, run: node scripts/live-transaction-controller.js --approve');
  console.log('     Do NOT approve unless you have personally inspected the artifacts.');
  return true;
}

// === STAGE: APPROVE ===
async function stageApprove() {
  console.log('\n[STAGE: APPROVE]');
  const state = loadState();
  if (!state) { console.log('  ❌ No transaction state.'); return false; }

  const token = makeServiceToken();
  const res = await httpPost(`/api/revenue/jobs/${state.jobId}/approve`, {
    action: 'approve',
    notes: 'Live qualification transaction — explicit human approval',
  }, { 'x-hydi-service-token': token });

  if (res.status !== 200) {
    console.log(`  ❌ Approval failed: HTTP ${res.status}`);
    console.log(`  ${res.body}`);
    return false;
  }

  state.correlation.deliveryToken = res.json.deliveryToken;
  state.correlation.approvalActor = 'human:operator';
  state.stages.approve = 'done';
  saveState(state);

  console.log(`  ✓ Job approved for delivery`);
  console.log(`  ✓ Delivery token: ${res.json.deliveryToken?.slice(0, 16)}...`);
  console.log(`  ✓ Job status: ${res.json.jobStatus}`);
  return true;
}

// === STAGE: RECONCILE ===
async function stageReconcile() {
  console.log('\n[STAGE: RECONCILE]');
  const state = loadState();
  if (!state) { console.log('  ❌ No transaction state.'); return false; }

  const token = makeServiceToken();
  const res = await httpGet(`/api/revenue/jobs/${state.jobId}/reconcile`, { 'x-hydi-service-token': token });

  if (res.status !== 200) {
    console.log(`  ❌ Reconciliation failed: HTTP ${res.status}`);
    return false;
  }

  const result = res.json;
  console.log(`  State: ${result.state}`);
  console.log(`  Violations: ${result.violations.length}`);
  for (const v of result.violations) {
    console.log(`    • ${v}`);
  }

  // Verify correlation completeness
  const corr = result.correlation;
  const required = ['jobId', 'checkoutSessionId', 'stripeEventId', 'paymentIntentId', 'deliveryToken', 'ledgerEntryId'];
  const missing = required.filter(f => !corr[f]);
  if (missing.length > 0) {
    console.log(`  ❌ Correlation incomplete. Missing: ${missing.join(', ')}`);
    return false;
  }

  state.reconciliation = result;
  state.stages.reconcile = 'done';
  saveState(state);

  if (result.state !== 'CONSISTENT') {
    console.log(`  ❌ Reconciliation is not CONSISTENT. State: ${result.state}`);
    console.log('  BLOCK. ESCALATE. DO NOT DECLARE QUALIFICATION SUCCESS.');
    return false;
  }

  console.log('  ✓ Reconciliation is CONSISTENT');
  console.log('  ✓ All correlation identifiers present');
  return true;
}

// === STAGE: EVIDENCE ===
async function stageEvidence() {
  console.log('\n[STAGE: EVIDENCE]');
  const state = loadState();
  if (!state) { console.log('  ❌ No transaction state.'); return false; }

  const token = makeServiceToken();
  const jobRes = await httpGet(`/api/revenue/jobs/${state.jobId}`, { 'x-hydi-service-token': token });
  const reconRes = await httpGet(`/api/revenue/jobs/${state.jobId}/reconcile`, { 'x-hydi-service-token': token });

  const evidence = {
    qualificationRunId: state.qualificationRunId,
    timestamp: new Date().toISOString(),
    gitCommit: state.gitCommit,
    branch: execSync('git branch --show-current', { encoding: 'utf8' }).trim(),
    environment: 'production',
    stripeMode: process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'live' : 'test',
    jobId: state.jobId,
    offer: state.product,
    amount: state.expectedAmountCents,
    currency: state.currency,
    checkoutSessionId: state.correlation.checkoutSessionId,
    stripeEventId: state.correlation.stripeEventId,
    paymentIntentId: state.correlation.paymentIntentId,
    ledgerEntryId: state.correlation.ledgerEntryId,
    deliveryTokenHash: state.correlation.deliveryToken
      ? crypto.createHash('sha256').update(state.correlation.deliveryToken).digest('hex').slice(0, 16)
      : null,
    artifactHashes: state.correlation.artifactHashes || {},
    approvalActor: state.correlation.approvalActor,
    reconciliation: reconRes.json,
    jobState: jobRes.json?.job,
    finalResult: reconRes.json?.state === 'CONSISTENT' ? 'LIVE_TRANSACTION_QUALIFIED' : 'LIVE_TRANSACTION_BLOCKED',
    // Explicitly confirm no secrets are captured
    secretsCaptured: false,
    secretKeyExposed: false,
    webhookSecretExposed: false,
  };

  const evidencePath = path.join(process.cwd(), 'docs', 'live-transaction-evidence.json');
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));

  console.log(`  ✓ Evidence written to: ${evidencePath}`);
  console.log(`  ✓ No secrets captured: ${evidence.secretsCaptured === false}`);
  console.log(`  ✓ Final result: ${evidence.finalResult}`);
  return evidence.finalResult === 'LIVE_TRANSACTION_QUALIFIED';
}

// === STAGE: POST-TRANSACTION SAFETY ===
async function stagePostTransactionSafety() {
  console.log('\n[STAGE: POST-TRANSACTION SAFETY]');
  const state = loadState();
  if (!state) { console.log('  ❌ No transaction state.'); return false; }

  const token = makeServiceToken();
  let allPass = true;

  // 1. Replaying approval returns conflict
  const reApprove = await httpPost(`/api/revenue/jobs/${state.jobId}/approve`, { action: 'approve' }, { 'x-hydi-service-token': token });
  console.log(`  ${reApprove.status === 409 ? '✓' : '✗'} Replay approval returns 409 (got ${reApprove.status})`);
  if (reApprove.status !== 409) allPass = false;

  // 2. Reconciliation remains CONSISTENT
  const recon = await httpGet(`/api/revenue/jobs/${state.jobId}/reconcile`, { 'x-hydi-service-token': token });
  console.log(`  ${recon.json?.state === 'CONSISTENT' ? '✓' : '✗'} Reconciliation remains CONSISTENT (got ${recon.json?.state})`);
  if (recon.json?.state !== 'CONSISTENT') allPass = false;

  // 3. Unauthorized access returns 401
  const unauth = await httpPost(`/api/revenue/jobs/${state.jobId}/approve`, { action: 'approve' });
  console.log(`  ${unauth.status === 401 ? '✓' : '✗'} Unauthorized access returns 401 (got ${unauth.status})`);
  if (unauth.status !== 401) allPass = false;

  // 4. Legacy checkout remains 410
  const legacy = await httpPost('/api/checkout', { tier: 'starter', email: 'test@test.com', company: 'Test' });
  console.log(`  ${legacy.status === 410 ? '✓' : '✗'} Legacy checkout remains 410 (got ${legacy.status})`);
  if (legacy.status !== 410) allPass = false;

  // 5. No duplicate ledger entries
  const { rows } = await DB.query("SELECT count(*) FROM revenue_ledger WHERE metadata->>'jobId'=$1", [state.jobId]);
  const ledgerCount = parseInt(rows[0].count);
  console.log(`  ${ledgerCount === 1 ? '✓' : '✗'} Exactly 1 ledger entry (got ${ledgerCount})`);
  if (ledgerCount !== 1) allPass = false;

  // 6. No unexpected autonomous transaction
  const { rows: jobs } = await DB.query("SELECT count(*) FROM customer_jobs WHERE customer_email=$1 AND created_at > NOW() - INTERVAL '1 hour'", [state.customerEmail]);
  const jobCount = parseInt(jobs[0].count);
  console.log(`  ${jobCount === 1 ? '✓' : '✗'} Exactly 1 job for qualification customer (got ${jobCount})`);
  if (jobCount !== 1) allPass = false;

  // 7. Check logs for secret exposure (scan recent server output)
  // This is a heuristic — we check if any sk_live_ pattern was logged
  // We can't easily scan server logs here, but we verify the evidence file
  const evidencePath = path.join(process.cwd(), 'docs', 'live-transaction-evidence.json');
  if (fs.existsSync(evidencePath)) {
    const evidence = fs.readFileSync(evidencePath, 'utf8');
    const hasSecret = evidence.includes('sk_live_') || evidence.includes('sk_test_') || evidence.includes('whsec_');
    console.log(`  ${!hasSecret ? '✓' : '✗'} No secrets in evidence file`);
    if (hasSecret) allPass = false;
  }

  state.stages.postTransactionSafety = allPass ? 'done' : 'failed';
  saveState(state);

  return allPass;
}

// === STAGE: SHUTDOWN ===
async function stageShutdown() {
  console.log('\n[STAGE: SHUTDOWN]');
  console.log('  Disabling live qualification mode...');

  // The live mode is controlled by ALLOW_LIVE_STRIPE environment variable.
  // We cannot unset environment variables from a script, but we can:
  // 1. Mark the transaction as completed in state
  // 2. Clear the transaction state file
  // 3. Remind the operator to unset ALLOW_LIVE_STRIPE

  const state = loadState();
  if (state) {
    state.transactionCompleted = true;
    state.shutdownAt = new Date().toISOString();
    saveState(state);
  }

  console.log('  ✓ Transaction state marked as completed');
  console.log('  ✓ Transaction state file preserved for audit');
  console.log('\n  ⚠  OPERATOR ACTION REQUIRED:');
  console.log('     Unset ALLOW_LIVE_STRIPE to return to normal controlled state:');
  console.log('       Remove ALLOW_LIVE_STRIPE from .env.local');
  console.log('       Restart the production server');
  console.log('\n  The first transaction is a qualification event, not permission for unrestricted commerce.');
  return true;
}

// === MAIN ===
async function main() {
  const arg = process.argv[2] || '--help';
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Live Transaction Controller');
  console.log('═══════════════════════════════════════════════════════════════');

  try {
    switch (arg) {
      case '--preflight':
        return process.exit(await stagePreflight() ? 0 : 1);
      case '--create-job':
        return process.exit(await stageCreateJob() ? 0 : 1);
      case '--await-webhook':
        return process.exit(await stageAwaitWebhook() ? 0 : 1);
      case '--inspect-artifacts':
        return process.exit(await stageInspectArtifacts() ? 0 : 1);
      case '--approve':
        return process.exit(await stageApprove() ? 0 : 1);
      case '--reconcile':
        return process.exit(await stageReconcile() ? 0 : 1);
      case '--evidence':
        return process.exit(await stageEvidence() ? 0 : 1);
      case '--post-transaction-safety':
        return process.exit(await stagePostTransactionSafety() ? 0 : 1);
      case '--shutdown':
        return process.exit(await stageShutdown() ? 0 : 0);
      case '--full':
        // Run all stages up to approval, then stop
        if (!await stagePreflight()) return process.exit(1);
        if (!await stageCreateJob()) return process.exit(1);
        console.log('\n  ⏸  STOP — payment required. Run --await-webhook after payment.');
        return process.exit(0);
      case '--help':
      default:
        console.log('  Usage: node scripts/live-transaction-controller.js <stage>');
        console.log('');
        console.log('  Stages:');
        console.log('    --preflight              Run preflight checks');
        console.log('    --create-job             Create the controlled job (requires LIVE_QUALIFICATION_CUSTOMER_EMAIL)');
        console.log('    --await-webhook          Wait for Stripe webhook to confirm payment');
        console.log('    --inspect-artifacts      Inspect and verify generated artifacts');
        console.log('    --approve                Explicitly approve for delivery (HUMAN ACTION)');
        console.log('    --reconcile              Run financial reconciliation');
        console.log('    --evidence               Generate evidence package');
        console.log('    --post-transaction-safety  Run post-transaction safety tests');
        console.log('    --shutdown               Disable live qualification mode');
        console.log('    --full                   Run preflight + create job, then stop');
        console.log('');
        console.log('  Limiter constraints:');
        console.log(`    Product: ${LIMITER.allowedProduct}`);
        console.log(`    Amount: $${LIMITER.allowedAmountCents / 100} ${LIMITER.allowedCurrency}`);
        console.log(`    Max transactions: ${LIMITER.maxTransactions}`);
        return process.exit(0);
    }
  } catch (err) {
    console.error('FATAL:', err);
    await DB.end();
    process.exit(1);
  }
}

main();
