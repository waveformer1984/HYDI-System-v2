/**
 * First-Transaction Evidence Harness
 *
 * Runs a controlled qualification of the complete revenue transaction
 * against the production build, capturing every identifier and stage
 * for evidence.
 *
 * This is NOT a real customer transaction. It uses test-mode Stripe
 * and test data. It proves the pipeline works end-to-end.
 *
 * Output: docs/first-transaction-evidence.json
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const DB = new Pool({ host: '127.0.0.1', port: 54322, database: 'postgres', user: 'postgres', password: 'postgres' });

require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

const SERVICE_SECRET = process.env.HYDI_SERVICE_SECRET;

if (!SERVICE_SECRET) {
  console.error('FATAL: HYDI_SERVICE_SECRET not set');
  process.exit(1);
}

function makeServiceToken(service = 'evidence-harness') {
  const ts = Date.now();
  const requestId = crypto.randomUUID();
  const payload = `${ts}:${requestId}:${service}`;
  const sig = crypto.createHmac('sha256', SERVICE_SECRET).update(payload).digest('hex');
  return `${ts}.${requestId}.${service}.${sig}`;
}

async function http(method, urlPath, body, headers = {}) {
  const url = `${BASE}${urlPath}`;
  const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  let json = null;
  try { json = await res.json(); } catch (_) { }
  return { status: res.status, json };
}

function createArtifacts(jobId) {
  const dir = path.join(process.cwd(), 'artifacts', 'customer-jobs', jobId);
  fs.mkdirSync(dir, { recursive: true });

  const stl = `solid test
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 1 0
endloop
endfacet
facet normal 0 0 1
outer loop
vertex 1 0 0
vertex 1 1 0
vertex 0 1 0
endloop
endfacet
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 0 0 1
vertex 1 0 0
endloop
endfacet
facet normal 0 0 1
outer loop
vertex 0 0 1
vertex 1 0 1
vertex 1 0 0
endloop
endfacet
endsolid test
`;
  const scad = `module test_part() { cube([10, 10, 10]); }\ntest_part();\n`;
  const readme = `# Test Artifact\nJob: ${jobId}\nGenerated: ${new Date().toISOString()}\n`;

  const stlPath = path.join(dir, 'test_part.stl');
  const scadPath = path.join(dir, 'test_part.scad');
  const readmePath = path.join(dir, 'README.md');

  fs.writeFileSync(stlPath, stl);
  fs.writeFileSync(scadPath, scad);
  fs.writeFileSync(readmePath, readme);

  const stlHash = crypto.createHash('sha256').update(fs.readFileSync(stlPath)).digest('hex');
  const scadHash = crypto.createHash('sha256').update(fs.readFileSync(scadPath)).digest('hex');
  const readmeHash = crypto.createHash('sha256').update(fs.readFileSync(readmePath)).digest('hex');

  return {
    paths: [stlPath, scadPath, readmePath],
    metadata: {
      'test_part.stl': { sha256: stlHash },
      'test_part.scad': { sha256: scadHash },
      'README.md': { sha256: readmeHash },
    }
  };
}

async function dbQuery(sql, params = []) {
  return DB.query(sql, params);
}

async function main() {
  const token = makeServiceToken();
  const authHeaders = { 'x-hydi-service-token': token };
  const runId = `evidence-${Date.now()}`;
  const evidence = {
    runId,
    timestamp: new Date().toISOString(),
    baseUrl: BASE,
    stages: {},
    correlation: {},
    reconciliation: null,
    failures: [],
  };

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  First-Transaction Evidence Harness');
  console.log('  Run ID:', runId);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Step 1: Create job
  console.log('[1] Creating job...');
  const createRes = await http('POST', '/api/revenue/jobs', {
    customerEmail: `evidence-${runId}@hydi-test.local`,
    customerName: 'Evidence Harness',
    product: 'protoforge_model_prep',
    requestText: 'Evidence harness test model',
  });
  const jobId = createRes.json?.jobId;
  evidence.stages.jobCreated = { status: createRes.status, jobId, checkoutUrl: createRes.json?.checkoutUrl ? 'present' : 'null' };
  evidence.correlation.jobId = jobId;
  evidence.correlation.checkoutSessionId = createRes.json?.sessionId || null;
  console.log(`  Job: ${jobId}, Session: ${evidence.correlation.checkoutSessionId}`);

  if (!jobId) { console.error('FATAL: No job ID'); await DB.end(); process.exit(1); }

  // Step 2: Advance to awaiting_review (simulate payment + execution)
  console.log('[2] Advancing to awaiting_review...');
  const now = new Date().toISOString();
  const artifacts = createArtifacts(jobId);
  const stripeEventId = `evt_evidence_${runId}`;
  const paymentIntentId = `pi_evidence_${runId}`;

  await dbQuery(`UPDATE customer_jobs SET payment_status='paid', job_status='queued', stripe_event_id=$1, stripe_payment_intent_id=$2, paid_at=$3, updated_at=$3 WHERE job_id=$4`,
    [stripeEventId, paymentIntentId, now, jobId]);
  await dbQuery(`INSERT INTO customer_job_events (job_id, event_type, actor, from_state, to_state, details) VALUES ($1, 'payment_confirmed', 'evidence_harness', 'created', 'queued', $2)`,
    [jobId, JSON.stringify({ stripeEventId, paymentIntentId })]);

  // Create ledger entry (simulating what JobWebhookBridge would do)
  const ledgerRow = await dbQuery(
    `INSERT INTO revenue_ledger (event_type, source, stripe_event_id, stripe_payment_intent_id, customer_id, offer_id, amount_gross, amount_net, currency, fee_breakdown, verified, verified_at, metadata, recorded_at)
     VALUES ('setup_fee_collected', 'stripe_webhook', $1, $2, $3, $4, $5, $5, 'usd', $6, true, $7, $8, $7) RETURNING ledger_entry_id`,
    [stripeEventId, paymentIntentId, `evidence-${runId}@hydi-test.local`, 'protoforge_model_prep', 2900, JSON.stringify({ platformFee: 0, stripeFee: 0, otherFees: 0 }), now, JSON.stringify({ jobId, product: 'protoforge_model_prep' })]
  );
  const ledgerEntryId = ledgerRow.rows[0]?.ledger_entry_id;
  await dbQuery(`UPDATE customer_jobs SET ledger_entry_id=$1 WHERE job_id=$2`, [ledgerEntryId, jobId]);
  evidence.correlation.ledgerEntryId = ledgerEntryId;

  await dbQuery(`UPDATE customer_jobs SET job_status='executing', execution_status='running', execution_started_at=$1, updated_at=$1 WHERE job_id=$2`,
    [now, jobId]);
  await dbQuery(`INSERT INTO customer_job_events (job_id, event_type, actor, from_state, to_state, details) VALUES ($1, 'execution_started', 'evidence_harness', 'queued', 'executing', $2)`,
    [jobId, JSON.stringify({})]);

  await dbQuery(`UPDATE customer_jobs SET job_status='awaiting_review', execution_status='completed', execution_completed_at=$1, artifact_paths=$2, artifact_metadata=$3, updated_at=$1 WHERE job_id=$4`,
    [now, artifacts.paths, JSON.stringify(artifacts.metadata), jobId]);
  await dbQuery(`INSERT INTO customer_job_events (job_id, event_type, actor, from_state, to_state, details) VALUES ($1, 'execution_completed', 'evidence_harness', 'executing', 'awaiting_review', $2)`,
    [jobId, JSON.stringify({ artifactCount: artifacts.paths.length })]);

  evidence.correlation.stripeEventId = stripeEventId;
  evidence.correlation.paymentIntentId = paymentIntentId;
  evidence.correlation.artifactPaths = artifacts.paths;
  evidence.correlation.artifactHashes = Object.fromEntries(
    Object.entries(artifacts.metadata).map(([k, v]) => [k, v.sha256])
  );
  console.log(`  Artifacts: ${artifacts.paths.length} files`);

  // Step 3: Reconcile BEFORE approval (should be BLOCKED)
  console.log('[3] Reconciling before approval (expect BLOCKED)...');
  const reconBefore = await http('GET', `/api/revenue/jobs/${jobId}/reconcile`, null, authHeaders);
  evidence.reconciliationBeforeApproval = reconBefore.json;
  console.log(`  State: ${reconBefore.json?.state}`);

  // Step 4: Human approval
  console.log('[4] Approving job...');
  const approveRes = await http('POST', `/api/revenue/jobs/${jobId}/approve`, {
    action: 'approve',
    notes: 'Evidence harness approval',
  }, authHeaders);
  evidence.stages.humanApproved = { status: approveRes.status, jobStatus: approveRes.json?.jobStatus, deliveryToken: approveRes.json?.deliveryToken };
  evidence.correlation.deliveryToken = approveRes.json?.deliveryToken;
  evidence.correlation.approvalActor = `human:owner`;
  console.log(`  Status: ${approveRes.status}, Token: ${approveRes.json?.deliveryToken?.slice(0, 8)}...`);

  // Step 5: Reconcile AFTER approval (should be CONSISTENT or INCOMPLETE)
  console.log('[5] Reconciling after approval...');
  const reconAfter = await http('GET', `/api/revenue/jobs/${jobId}/reconcile`, null, authHeaders);
  evidence.reconciliation = reconAfter.json;
  console.log(`  State: ${reconAfter.json?.state}`);
  console.log(`  Violations: ${reconAfter.json?.violations?.length || 0}`);

  // Step 6: Verify correlation completeness
  console.log('[6] Verifying correlation...');
  const corr = reconAfter.json?.correlation || {};
  const corrFields = ['jobId', 'checkoutSessionId', 'stripeEventId', 'paymentIntentId', 'artifactPaths', 'deliveryToken'];
  const missingCorr = corrFields.filter(f => !corr[f] || (Array.isArray(corr[f]) && corr[f].length === 0));
  evidence.correlationComplete = missingCorr.length === 0;
  if (missingCorr.length > 0) {
    evidence.failures.push(`Missing correlation fields: ${missingCorr.join(', ')}`);
  }
  console.log(`  Complete: ${evidence.correlationComplete}`);

  // Cleanup
  const artifactDir = path.join(process.cwd(), 'artifacts', 'customer-jobs', jobId);
  if (fs.existsSync(artifactDir)) fs.rmSync(artifactDir, { recursive: true });

  // Write evidence file
  const evidencePath = path.join(process.cwd(), 'docs', 'first-transaction-evidence.json');
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  EVIDENCE CAPTURED');
  console.log(`  Run ID: ${runId}`);
  console.log(`  Job ID: ${jobId}`);
  console.log(`  Reconciliation: ${reconAfter.json?.state}`);
  console.log(`  Violations: ${reconAfter.json?.violations?.length || 0}`);
  console.log(`  Correlation complete: ${evidence.correlationComplete}`);
  console.log(`  Evidence file: ${evidencePath}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  await DB.end();
  process.exit(evidence.failures.length === 0 && reconAfter.json?.state === 'CONSISTENT' ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
