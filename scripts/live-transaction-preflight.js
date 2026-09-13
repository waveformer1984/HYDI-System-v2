/**
 * Live Transaction Preflight Check
 *
 * Verifies that all conditions required for a controlled live Stripe
 * transaction are met before any charge is initiated.
 *
 * Returns a deterministic result:
 *   READY   — all checks pass, live transaction may proceed
 *   BLOCKED — one or more checks failed, live transaction must not proceed
 *   FAILED  — preflight itself encountered an error
 *
 * Usage:
 *   node scripts/live-transaction-preflight.js
 *   GET /api/revenue/preflight (with auth)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Pool } = require('pg');

require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

const BASE = process.env.BASE_URL || 'http://localhost:3000';

function check(label, condition, detail = '') {
  return { label, status: condition ? 'PASS' : 'FAIL', detail };
}

async function httpGet(urlPath) {
  return new Promise((resolve) => {
    http.get(`${BASE}${urlPath}`, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', (err) => resolve({ status: 0, body: err.message }));
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
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', (err) => resolve({ status: 0, body: err.message }));
    req.write(JSON.stringify(data));
    req.end();
  });
}

async function runPreflight() {
  const checks = [];
  const blockers = [];
  const timestamp = new Date().toISOString();
  const gitCommit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  const branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();

  // === Server checks (must come first — environment check depends on health data) ===
  const healthRes = await httpGet('/api/health');
  let healthData = null;
  try { healthData = JSON.parse(healthRes.body); } catch (_) { }
  const serverRunning = healthRes.status === 200;
  const serverProduction = healthData?.environment === 'production';
  checks.push(check('Production server is running', serverRunning, `HTTP ${healthRes.status}`));

  // === Environment checks ===
  // Check the server's environment (from health endpoint), not the script's.
  // The preflight script may run with a different NODE_ENV than the server.
  const nodeEnv = healthData?.environment || process.env.NODE_ENV;
  checks.push(check('Server is in production mode', serverProduction, `environment=${nodeEnv}`));

  // === Build checks ===
  const nextDir = path.join(process.cwd(), '.next');
  const buildManifest = path.join(nextDir, 'BUILD_ID');
  const buildExists = fs.existsSync(buildManifest);
  checks.push(check('Production build exists', buildExists, buildExists ? fs.readFileSync(buildManifest, 'utf8').trim() : 'no build'));

  // === Database checks ===
  let dbReachable = false;
  let schemaExists = false;
  try {
    const pool = new Pool({ host: '127.0.0.1', port: 54322, database: 'postgres', user: 'postgres', password: 'postgres', connectionTimeoutMillis: 3000 });
    await pool.query('SELECT 1');
    dbReachable = true;
    const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('customer_jobs','customer_job_events','revenue_ledger','webhook_events')");
    schemaExists = tables.rows.length === 4;
    checks.push(check('Database is reachable', dbReachable));
    checks.push(check('Required schema exists (4 tables)', schemaExists, `${tables.rows.length}/4 tables found`));
    await pool.end();
  } catch (err) {
    checks.push(check('Database is reachable', false, err.message));
    checks.push(check('Required schema exists (4 tables)', false, 'DB unreachable'));
  }

  // === Route checks ===
  const legacyRes = await httpPost('/api/checkout', { tier: 'starter', email: 'test@test.com', company: 'Test' });
  checks.push(check('Legacy checkout is blocked (410)', legacyRes.status === 410, `HTTP ${legacyRes.status}`));

  const webhookRes = await httpPost('/api/webhooks/stripe', {}, {});
  checks.push(check('Webhook endpoint is reachable', webhookRes.status === 400, `HTTP ${webhookRes.status}`));

  // Check that admin routes enforce auth (not the customer-facing job creation route)
  const approveAuthRes = await httpPost('/api/revenue/jobs/test-job/approve', { action: 'approve' });
  checks.push(check('Approval route enforces auth', approveAuthRes.status === 401, `HTTP ${approveAuthRes.status}`));

  // === Stripe configuration checks ===
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const stripeConfigured = !!stripeKey;
  const isLiveKey = stripeKey && (stripeKey.startsWith('sk_live_') || stripeKey.startsWith('rk_live_'));
  const isTestKey = stripeKey && (stripeKey.startsWith('sk_test_') || stripeKey.startsWith('rk_test_'));
  const liveAllowed = process.env.ALLOW_LIVE_STRIPE === 'true';
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET_01 || process.env.STRIPE_WEBHOOK_SECRET;

  checks.push(check('Stripe secret key is configured', stripeConfigured, stripeConfigured ? `${stripeKey.slice(0, 8)}...` : 'not set'));
  checks.push(check('Stripe mode is identifiable', isLiveKey || isTestKey, isLiveKey ? 'live' : isTestKey ? 'test' : 'unknown'));
  checks.push(check('Webhook secret is configured', !!webhookSecret));
  // ALLOW_LIVE_STRIPE is not a hard fail — it's informational.
  // The state aggregation below uses it to determine READY vs BLOCKED for live mode.
  const allowLiveSet = process.env.ALLOW_LIVE_STRIPE !== undefined;
  checks.push({
    label: 'ALLOW_LIVE_STRIPE status',
    status: 'INFO',
    detail: `ALLOW_LIVE_STRIPE=${process.env.ALLOW_LIVE_STRIPE || 'unset'}`,
  });

  if (isLiveKey) {
    checks.push(check('Live mode is explicitly authorized', liveAllowed, liveAllowed ? 'ALLOW_LIVE_STRIPE=true' : 'ALLOW_LIVE_STRIPE is not "true"'));
  }

  // === Safety gate checks ===
  checks.push(check('Webhook processing is enabled', process.env.WEBHOOK_PROCESSING_ENABLED === 'true', `WEBHOOK_PROCESSING_ENABLED=${process.env.WEBHOOK_PROCESSING_ENABLED}`));

  // === Reconciliation checks ===
  const reconAuthRes = await httpGet('/api/revenue/jobs/test/reconcile');
  checks.push(check('Reconciliation endpoint enforces auth', reconAuthRes.status === 401, `HTTP ${reconAuthRes.status}`));

  // === Evidence harness checks ===
  const evidenceScript = path.join(process.cwd(), 'scripts', 'first-transaction-evidence-harness.js');
  checks.push(check('Evidence harness script exists', fs.existsSync(evidenceScript)));

  const failureScript = path.join(process.cwd(), 'scripts', 'failure-injection-tests.js');
  checks.push(check('Failure injection script exists', fs.existsSync(failureScript)));

  // === No stale dev server ===
  // If the server responds with "development" environment, a dev server
  // is occupying the production port
  if (healthData?.environment === 'development') {
    checks.push(check('No development server on production port', false, 'development server detected'));
  } else {
    checks.push(check('No development server on production port', true));
  }

  // === Aggregate ===
  const failedChecks = checks.filter(c => c.status === 'FAIL'); // INFO status doesn't count as failure
  const allPass = failedChecks.length === 0;

  let state;
  if (allPass) {
    // If all checks pass but live mode is not authorized, we're READY
    // for test-mode qualification but BLOCKED for live qualification
    if (isLiveKey && !liveAllowed) {
      state = 'BLOCKED';
      blockers.push('Live Stripe key detected but ALLOW_LIVE_STRIPE is not "true"');
    } else if (!isLiveKey && !liveAllowed) {
      // Test mode — READY for test, but live transaction is BLOCKED
      state = 'BLOCKED';
      blockers.push('Stripe is in test mode. Live transaction requires ALLOW_LIVE_STRIPE=true and a live Stripe key.');
    } else {
      state = 'READY';
    }
  } else {
    state = 'BLOCKED';
    for (const c of failedChecks) {
      blockers.push(`${c.label}: ${c.detail || 'failed'}`);
    }
  }

  return {
    state,
    timestamp,
    gitCommit,
    branch,
    nodeEnv,
    stripeMode: isLiveKey ? 'live' : isTestKey ? 'test' : 'unknown',
    liveAllowed,
    checks,
    blockers,
    summary: state === 'READY'
      ? 'All preflight checks passed. Live transaction may proceed with explicit human authorization.'
      : state === 'BLOCKED'
        ? `Preflight blocked: ${blockers.length} blocker(s). Live transaction must not proceed.`
        : 'Preflight failed.',
  };
}

module.exports = { runPreflight };

if (require.main === module) {
  runPreflight().then((result) => {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  Live Transaction Preflight');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  Timestamp: ${result.timestamp}`);
    console.log(`  Git: ${result.gitCommit.slice(0, 12)} (${result.branch})`);
    console.log(`  NODE_ENV: ${result.nodeEnv}`);
    console.log(`  Stripe mode: ${result.stripeMode}`);
    console.log(`  Live allowed: ${result.liveAllowed}`);
    console.log('');
    for (const c of result.checks) {
      const icon = c.status === 'PASS' ? '✓' : c.status === 'INFO' ? 'ℹ' : '✗';
      console.log(`  ${icon} ${c.label}${c.detail ? ' — ' + c.detail : ''}`);
    }
    console.log('');
    console.log(`  State: ${result.state}`);
    if (result.blockers.length > 0) {
      console.log('  Blockers:');
      for (const b of result.blockers) {
        console.log(`    • ${b}`);
      }
    }
    console.log('═══════════════════════════════════════════════════════════════');
    process.exit(result.state === 'READY' ? 0 : 1);
  }).catch((err) => {
    console.error('Preflight FAILED:', err);
    process.exit(2);
  });
}
