/**
 * Functional verification of the routes touched by the build-path fix.
 *
 * Tests against the running production build (next start):
 *   1. POST /api/revenue/jobs              — create a customer job
 *   2. GET  /api/revenue/jobs/:jobId        — get job status
 *   3. POST /api/revenue/jobs/:jobId/approve — the human approval gate
 *   4. GET  /api/revenue                    — revenue dashboard (auth)
 *   5. GET  /api/revenue/report             — revenue report (auth)
 *   6. GET  /api/revenue/leads              — leads list (auth)
 *   7. POST /api/revenue/cycle              — revenue cycle (auth)
 *
 * The approve endpoint requires:
 *   - job in 'awaiting_review' status
 *   - valid operator token (x-hydi-service-token)
 *   - real artifacts on disk (3 files: .scad, .stl, README.md)
 *
 * This script creates real artifacts, uses JobManager directly to advance
 * the job to awaiting_review, then calls the HTTP endpoint to verify the
 * full approve → deliver pipeline works end-to-end.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const BASE = 'http://localhost:3000';
const DB = new Pool({ host: '127.0.0.1', port: 54322, database: 'postgres', user: 'postgres', password: 'postgres' });

// Load env for HYDI_SERVICE_SECRET
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

const SERVICE_SECRET = process.env.HYDI_SERVICE_SECRET;

if (!SERVICE_SECRET) {
  console.error('FATAL: HYDI_SERVICE_SECRET not set');
  process.exit(1);
}

function makeServiceToken(service = 'functional-test') {
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

async function dbQuery(sql, params = []) {
  return DB.query(sql, params);
}

// Create real artifact files on disk
function createArtifacts(jobId) {
  const dir = path.join(process.cwd(), 'artifacts', 'customer-jobs', jobId);
  fs.mkdirSync(dir, { recursive: true });

  // Minimal valid STL (4+ triangles)
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

  const scad = `// Generated test SCAD for ${jobId}
module test_part() {
  cube([10, 10, 10]);
}
test_part();
`;

  const readme = `# Test Artifact\n\nJob: ${jobId}\nGenerated: ${new Date().toISOString()}\n`;

  const stlPath = path.join(dir, 'test_part.stl');
  const scadPath = path.join(dir, 'test_part.scad');
  const readmePath = path.join(dir, 'README.md');

  fs.writeFileSync(stlPath, stl);
  fs.writeFileSync(scadPath, scad);
  fs.writeFileSync(readmePath, readme);

  // Compute hashes for metadata
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

// Advance a job through the full lifecycle to awaiting_review using direct DB ops
// (simulating what JobManager.confirmPayment + startExecution + completeExecution would do)
async function advanceJobToAwaitingReview(jobId) {
  const now = new Date().toISOString();
  const artifacts = createArtifacts(jobId);

  // 1. Confirm payment (created → queued)
  await dbQuery(
    `UPDATE customer_jobs SET payment_status='paid', job_status='queued', paid_at=$1, updated_at=$1 WHERE job_id=$2`,
    [now, jobId]
  );
  await dbQuery(
    `INSERT INTO customer_job_events (job_id, event_type, actor, from_state, to_state, details) VALUES ($1, 'payment_confirmed', 'test', 'created', 'queued', $2)`,
    [jobId, JSON.stringify({ test: true })]
  );

  // 2. Start execution (queued → executing)
  await dbQuery(
    `UPDATE customer_jobs SET job_status='executing', execution_status='running', execution_started_at=$1, updated_at=$1 WHERE job_id=$2`,
    [now, jobId]
  );
  await dbQuery(
    `INSERT INTO customer_job_events (job_id, event_type, actor, from_state, to_state, details) VALUES ($1, 'execution_started', 'test', 'queued', 'executing', $2)`,
    [jobId, JSON.stringify({})]
  );

  // 3. Complete execution with artifacts (executing → awaiting_review)
  await dbQuery(
    `UPDATE customer_jobs SET job_status='awaiting_review', execution_status='completed', execution_completed_at=$1, artifact_paths=$2, artifact_metadata=$3, updated_at=$1 WHERE job_id=$4`,
    [now, artifacts.paths, JSON.stringify(artifacts.metadata), jobId]
  );
  await dbQuery(
    `INSERT INTO customer_job_events (job_id, event_type, actor, from_state, to_state, details) VALUES ($1, 'execution_completed', 'test', 'executing', 'awaiting_review', $2)`,
    [jobId, JSON.stringify({ artifactCount: artifacts.paths.length })]
  );

  return artifacts;
}

async function getJobFromDb(jobId) {
  const { rows } = await dbQuery('SELECT * FROM customer_jobs WHERE job_id = $1', [jobId]);
  return rows[0] || null;
}

async function getJobEventsFromDb(jobId) {
  const { rows } = await dbQuery(
    'SELECT event_type, actor, from_state, to_state, details, created_at FROM customer_job_events WHERE job_id = $1 ORDER BY created_at',
    [jobId]
  );
  return rows;
}

async function main() {
  const token = makeServiceToken();
  const authHeaders = { 'x-hydi-service-token': token };
  const testId = `ftest-${Date.now()}`;
  let pass = 0, fail = 0;
  const results = [];

  function check(name, condition, detail = '') {
    if (condition) {
      pass++;
      results.push(`  PASS: ${name}${detail ? ' — ' + detail : ''}`);
    } else {
      fail++;
      results.push(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
    }
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Functional Verification of Build-Fixed Routes');
  console.log('  Against production build (next start)');
  console.log('  Test ID:', testId);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // ─── Step 0: Verify server is up ───
  console.log('[STEP 0] Verifying production server...');
  const health = await http('GET', '/api/health');
  check('Server health check', health.status === 200, `HTTP ${health.status}`);
  check('Server is production build', health.json?.environment === 'production', `env=${health.json?.environment}`);
  console.log(results.slice(-2).join('\n'));

  // ─── Step 1: Create a job via POST /api/revenue/jobs ───
  console.log('\n[STEP 1] Creating job via POST /api/revenue/jobs...');
  const createRes = await http('POST', '/api/revenue/jobs', {
    customerEmail: `test-${testId}@hydi-test.local`,
    customerName: 'Functional Test',
    product: 'protoforge_model_prep',
    requestText: 'Test model for functional verification',
    requirements: { test: true },
  });
  check('Job creation returns 201', createRes.status === 201, `HTTP ${createRes.status} ${JSON.stringify(createRes.json).slice(0, 100)}`);
  const jobId = createRes.json?.jobId;
  check('Job ID returned', !!jobId, jobId || 'missing');
  console.log(results.slice(-2).join('\n'));

  if (!jobId) {
    console.log('\nFATAL: No job ID, cannot continue.');
    await DB.end();
    process.exit(1);
  }

  // ─── Step 2: GET /api/revenue/jobs/:jobId ───
  console.log(`\n[STEP 2] Getting job status via GET /api/revenue/jobs/${jobId}...`);
  const statusRes = await http('GET', `/api/revenue/jobs/${jobId}`);
  check('Job status returns 200', statusRes.status === 200, `HTTP ${statusRes.status}`);
  check('Job status has correct ID', statusRes.json?.job?.jobId === jobId);
  check('Job status is "created"', statusRes.json?.job?.jobStatus === 'created', `status=${statusRes.json?.job?.jobStatus}`);
  check('Job has events array', Array.isArray(statusRes.json?.events));
  console.log(results.slice(-4).join('\n'));

  // ─── Step 3: Advance job to awaiting_review ───
  console.log(`\n[STEP 3] Advancing job to awaiting_review (simulating payment + execution + artifact completion)...`);
  const artifacts = await advanceJobToAwaitingReview(jobId);
  const dbJob = await getJobFromDb(jobId);
  check('Job is awaiting_review in DB', dbJob?.job_status === 'awaiting_review', `status=${dbJob?.job_status}`);
  check('Artifacts stored in DB', Array.isArray(dbJob?.artifact_paths) && dbJob.artifact_paths.length === 3, `${dbJob?.artifact_paths?.length} paths`);
  check('Artifact metadata stored', dbJob?.artifact_metadata && (typeof dbJob.artifact_metadata === 'object' ? Object.keys(dbJob.artifact_metadata).length === 3 : Object.keys(JSON.parse(dbJob.artifact_metadata)).length === 3));
  console.log(results.slice(-3).join('\n'));

  // ─── Step 4: THE CRITICAL TEST — POST /api/revenue/jobs/:jobId/approve ───
  console.log(`\n[STEP 4] *** HUMAN APPROVAL GATE *** POST /api/revenue/jobs/${jobId}/approve...`);
  const approveRes = await http('POST', `/api/revenue/jobs/${jobId}/approve`, {
    action: 'approve',
    notes: 'Functional test approval',
  }, authHeaders);

  check('Approve returns 200', approveRes.status === 200, `HTTP ${approveRes.status} ${JSON.stringify(approveRes.json).slice(0, 200)}`);
  check('Approve response has jobId', approveRes.json?.jobId === jobId);
  check('Approve response status is "delivered"', approveRes.json?.jobStatus === 'delivered', `status=${approveRes.json?.jobStatus}`);
  check('Approve response has deliveryStatus', approveRes.json?.deliveryStatus === 'delivered');
  check('Approve response has deliveryToken', !!approveRes.json?.deliveryToken, `token=${approveRes.json?.deliveryToken?.slice(0, 8)}...`);
  console.log(results.slice(-5).join('\n'));

  // ─── Step 5: Verify DB state after approval ───
  console.log(`\n[STEP 5] Verifying database state after approval...`);
  const approvedJob = await getJobFromDb(jobId);
  check('DB job_status is "delivered"', approvedJob?.job_status === 'delivered', `status=${approvedJob?.job_status}`);
  check('DB delivery_status is "delivered"', approvedJob?.delivery_status === 'delivered');
  check('DB verification_status is "verified"', approvedJob?.verification_status === 'verified');
  check('DB has delivery_token', !!approvedJob?.delivery_token);
  check('DB has delivered_at timestamp', !!approvedJob?.delivered_at);

  const events = await getJobEventsFromDb(jobId);
  const deliveryApprovedEvent = events.find(e => e.event_type === 'delivery_approved');
  check('delivery_approved event recorded', !!deliveryApprovedEvent);
  check('delivery_approved from_state is awaiting_review', deliveryApprovedEvent?.from_state === 'awaiting_review');
  check('delivery_approved to_state is delivered', deliveryApprovedEvent?.to_state === 'delivered');
  check('delivery_approved has deliveryToken in details', !!deliveryApprovedEvent?.details?.deliveryToken);
  console.log(results.slice(-7).join('\n'));

  // ─── Step 6: Test idempotency — approving again should fail with 409 ───
  console.log(`\n[STEP 6] Testing idempotency — re-approving should fail...`);
  const reApproveRes = await http('POST', `/api/revenue/jobs/${jobId}/approve`, {
    action: 'approve',
    notes: 'Second approval attempt',
  }, authHeaders);
  check('Re-approve returns 409 (conflict)', reApproveRes.status === 409, `HTTP ${reApproveRes.status}`);
  console.log(results.slice(-1).join('\n'));

  // ─── Step 7: Test unauthenticated access to approve ───
  console.log(`\n[STEP 7] Testing auth guard — approve without token...`);
  const noAuthRes = await http('POST', `/api/revenue/jobs/${jobId}/approve`, {
    action: 'approve',
  });
  check('Unauthenticated approve returns 401', noAuthRes.status === 401, `HTTP ${noAuthRes.status}`);
  console.log(results.slice(-1).join('\n'));

  // ─── Step 8: Smoke-test GET /api/revenue (dashboard) ───
  console.log(`\n[STEP 8] Smoke-testing GET /api/revenue (dashboard)...`);
  const dashRes = await http('GET', '/api/revenue', null, authHeaders);
  check('Revenue dashboard returns 200', dashRes.status === 200, `HTTP ${dashRes.status} ${dashRes.json?.error || ''}`);
  check('Revenue dashboard returns JSON', !!dashRes.json);
  console.log(results.slice(-2).join('\n'));

  // ─── Step 9: Smoke-test GET /api/revenue/report ───
  console.log(`\n[STEP 9] Smoke-testing GET /api/revenue/report...`);
  const reportRes = await http('GET', '/api/revenue/report', null, authHeaders);
  check('Revenue report returns 200', reportRes.status === 200, `HTTP ${reportRes.status} ${reportRes.json?.error || ''}`);
  check('Revenue report returns JSON', !!reportRes.json);
  console.log(results.slice(-2).join('\n'));

  // ─── Step 10: Smoke-test GET /api/revenue/leads ───
  console.log(`\n[STEP 10] Smoke-testing GET /api/revenue/leads...`);
  const leadsRes = await http('GET', '/api/revenue/leads', null, authHeaders);
  check('Revenue leads returns 200', leadsRes.status === 200, `HTTP ${leadsRes.status} ${leadsRes.json?.error || ''}`);
  check('Revenue leads returns JSON', !!leadsRes.json);
  console.log(results.slice(-2).join('\n'));

  // ─── Step 11: Smoke-test POST /api/revenue/cycle ───
  console.log(`\n[STEP 11] Smoke-testing POST /api/revenue/cycle...`);
  const cycleRes = await http('POST', '/api/revenue/cycle', {}, authHeaders);
  // cycle may return 200 or 500 (if revenue engine has issues), but NOT 404 or module error
  check('Revenue cycle returns non-404', cycleRes.status !== 404, `HTTP ${cycleRes.status}`);
  check('Revenue cycle does not return module error', !JSON.stringify(cycleRes.json).includes('Module not found'));
  console.log(results.slice(-2).join('\n'));

  // ─── Step 12: Test auth guard on protected routes ───
  console.log(`\n[STEP 12] Testing auth guards on protected routes...`);
  const noAuthDash = await http('GET', '/api/revenue');
  check('Unauthenticated dashboard returns 401', noAuthDash.status === 401, `HTTP ${noAuthDash.status}`);
  const noAuthReport = await http('GET', '/api/revenue/report');
  check('Unauthenticated report returns 401', noAuthReport.status === 401, `HTTP ${noAuthReport.status}`);
  const noAuthLeads = await http('GET', '/api/revenue/leads');
  check('Unauthenticated leads returns 401', noAuthLeads.status === 401, `HTTP ${noAuthLeads.status}`);
  console.log(results.slice(-3).join('\n'));

  // ─── Cleanup ───
  console.log(`\n[CLEANUP] Removing test artifacts...`);
  const artifactDir = path.join(process.cwd(), 'artifacts', 'customer-jobs', jobId);
  if (fs.existsSync(artifactDir)) {
    fs.rmSync(artifactDir, { recursive: true });
    console.log('  Artifacts removed');
  }

  // ─── Summary ───
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  FUNCTIONAL VERIFICATION RESULTS');
  console.log('═══════════════════════════════════════════════════════════════');
  for (const r of results) console.log(r);
  console.log('\n  Total:', pass + fail, ' Pass:', pass, ' Fail:', fail);
  console.log('  Result:', fail === 0 ? 'ALL PASS' : 'HAS FAILURES');
  console.log('═══════════════════════════════════════════════════════════════\n');

  await DB.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
