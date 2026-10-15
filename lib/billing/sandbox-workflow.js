'use strict';

const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');
const { Pool } = require('pg');

/** @typedef {'PASS'|'FAIL'|'BLOCKED'|'NOT_RUN'|'INCONCLUSIVE'} StepStatus */

const MIGRATION_ID = '20261011120000_billing_revenue_streams_module.sql';
const BILLING_TABLES = [
  'billing_revenue_streams',
  'billing_tenants',
  'billing_products',
  'billing_plans',
  'billing_price_versions',
  'billing_checkout_intents',
  'billing_subscriptions',
  'billing_entitlements',
  'billing_usage_events',
  'billing_provider_cost_records',
  'billing_payments',
  'billing_refunds',
  'billing_webhook_events',
  'billing_audit_events',
  'billing_tenant_members',
  'billing_walkie_tenant_bindings',
  'billing_legacy_token_revocations',
  'billing_tenant_legacy_policy',
];

const WEBHOOK_PATH = '/api/billing/webhook';
const CATALOG_PATH = '/api/billing/catalog';

/** @type {{ id: string, title: string, kind: 'automated'|'human'|'approval', requires?: string[] }[]} */
const PLAN = [
  { id: 'env_docker', title: 'Docker Desktop running (operator)', kind: 'human' },
  { id: 'supabase_start', title: 'Local Supabase stack up', kind: 'human', requires: ['env_docker'] },
  { id: 'env_secrets', title: 'Billing env vars present (test Stripe, webhook secret, customer token secret)', kind: 'automated' },
  { id: 'postgres_connect', title: 'Postgres reachable on PG_PORT', kind: 'automated', requires: ['supabase_start'] },
  { id: 'billing_tables', title: 'All billing_* tables from migration present', kind: 'automated', requires: ['postgres_connect'] },
  { id: 'stripe_listen', title: 'stripe listen forwarding to local webhook endpoint', kind: 'human', requires: ['env_secrets'] },
  { id: 'sandbox_setup', title: 'billing-sandbox-setup.js catalog + tenant (idempotent keys)', kind: 'human', requires: ['billing_tables', 'env_secrets'] },
  { id: 'dev_server', title: 'npm run dev (webpack) serving BILLING_APP_URL', kind: 'human' },
  { id: 'browser_checkout', title: '§J.5 browser checkout with test card 4242…', kind: 'human', requires: ['stripe_listen', 'dev_server', 'sandbox_setup'] },
  { id: 'browser_billing_active', title: '§J.6 /billing Active only after webhook (not redirect alone)', kind: 'human', requires: ['browser_checkout'] },
  { id: 'api_ai_quota', title: '§J.6 POST /api/billing/ai/complete until 429', kind: 'human', requires: ['browser_billing_active'] },
  { id: 'negative_decline', title: '§J.7 decline card — no access', kind: 'human' },
  { id: 'negative_duplicate_webhook', title: '§J.7 duplicate webhook delivery — no duplicate entitlement rows', kind: 'human' },
  { id: 'negative_reconcile', title: '§J.7 webhook off → reconcile restores access', kind: 'human' },
  { id: 'unit_billing_jest', title: 'npx jest tests/unit/billing', kind: 'automated' },
  { id: 'tier2_billing_pg', title: 'npm run test:local (truncates billing_* — local only)', kind: 'automated', requires: ['postgres_connect'] },
];

function taskDir(root) {
  return path.join(root, '.hydi', 'billing-verify');
}

function taskPath(root, taskId) {
  return path.join(taskDir(root), `${taskId}.json`);
}

function createTaskId() {
  return randomBytes(12).toString('hex');
}

function defaultStoreRoot() {
  return process.env.HYDI_REPO_ROOT || path.join(__dirname, '..', '..');
}

function loadTask(root, taskId) {
  const p = taskPath(root, taskId);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveTask(root, task) {
  const dir = taskDir(root);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(taskPath(root, task.id), JSON.stringify(task, null, 2));
}

function createTask(root = defaultStoreRoot()) {
  const now = new Date().toISOString();
  const task = {
    id: createTaskId(),
    kind: 'billing_sandbox_verify',
    migration: MIGRATION_ID,
    created_at: now,
    updated_at: now,
    phase: 'OBJECTIVE_RECEIVED',
    steps: PLAN.map((s) => ({
      id: s.id,
      title: s.title,
      kind: s.kind,
      status: s.kind === 'human' ? 'NOT_RUN' : 'NOT_RUN',
      evidence: {},
      updated_at: null,
    })),
    summary: { pass: 0, fail: 0, blocked: 0, not_run: PLAN.length, inconclusive: 0 },
  };
  saveTask(root, task);
  return task;
}

function setStep(task, stepId, status, evidence = {}) {
  const step = task.steps.find((s) => s.id === stepId);
  if (!step) return task;
  step.status = status;
  step.evidence = { ...step.evidence, ...evidence };
  step.updated_at = new Date().toISOString();
  task.updated_at = step.updated_at;
  const counts = { pass: 0, fail: 0, blocked: 0, not_run: 0, inconclusive: 0 };
  for (const s of task.steps) {
    const key = s.status === 'PASS' ? 'pass' : s.status === 'FAIL' ? 'fail' : s.status === 'BLOCKED' ? 'blocked' : s.status === 'INCONCLUSIVE' ? 'inconclusive' : 'not_run';
    counts[key] += 1;
  }
  task.summary = counts;
  return task;
}

function hasEnv(name) {
  const v = process.env[name];
  return typeof v === 'string' && v.trim().length >= 8 && !v.includes('your-') && !v.includes('...');
}

function pgConfig() {
  if (process.env.BILLING_DATABASE_URL) return { connectionString: process.env.BILLING_DATABASE_URL };
  return {
    host: process.env.PG_HOST || '127.0.0.1',
    port: Number(process.env.PG_PORT || 54322),
    database: process.env.PG_DATABASE || 'postgres',
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'postgres',
  };
}

async function checkEnvSecrets() {
  const key = process.env.STRIPE_SECRET_KEY || '';
  const testKey =
    (key.startsWith('sk_test_') || key.startsWith('rk_test_')) && !key.startsWith('sk_live_');
  const fake = process.env.BILLING_PROVIDER === 'fake';
  const checks = {
    stripe_test_mode: testKey || fake,
    billing_customer_token_secret: hasEnv('BILLING_CUSTOMER_TOKEN_SECRET'),
    billing_webhook_secret: hasEnv('BILLING_STRIPE_WEBHOOK_SECRET'),
    hydi_service_secret: hasEnv('HYDI_SERVICE_SECRET'),
  };
  const ok = Object.values(checks).every(Boolean);
  return { ok, checks: Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, v ? 'present' : 'missing'])) };
}

async function checkPostgresAndTables() {
  const pool = new Pool(pgConfig());
  try {
    await pool.query('SELECT 1');
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [BILLING_TABLES],
    );
    const found = new Set(rows.map((r) => r.table_name));
    const missing = BILLING_TABLES.filter((t) => !found.has(t));
    return { ok: missing.length === 0, tables_found: found.size, tables_expected: BILLING_TABLES.length, missing };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'postgres_error',
      tables_found: 0,
      tables_expected: BILLING_TABLES.length,
      missing: BILLING_TABLES,
    };
  } finally {
    await pool.end().catch(() => {});
  }
}

async function checkPublicCatalog(baseUrl) {
  const url = `${baseUrl.replace(/\/$/, '')}${CATALOG_PATH}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const ok = res.ok;
    let products = null;
    if (ok) {
      const body = await res.json();
      products = Array.isArray(body.products) ? body.products.length : null;
    }
    return { ok, status: res.status, products_count: products, url: CATALOG_PATH };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'fetch_failed', url: CATALOG_PATH };
  }
}

/**
 * Safe post-run DB snapshot for operator evidence (counts only).
 * @param {string} [tenantId] uuid
 */
async function snapshotTenantState(tenantId) {
  if (!tenantId) return { ok: false, error: 'tenant_id_required' };
  const pool = new Pool(pgConfig());
  try {
    const [subs, ent, wh, usage] = await Promise.all([
      pool.query(`SELECT status, count(*)::int AS n FROM billing_subscriptions WHERE tenant_id = $1 GROUP BY status`, [tenantId]),
      pool.query(
        `SELECT feature_key, status, access_until FROM billing_entitlements WHERE tenant_id = $1 ORDER BY feature_key`,
        [tenantId],
      ),
      pool.query(`SELECT status, count(*)::int AS n FROM billing_webhook_events GROUP BY status`),
      pool.query(`SELECT status, count(*)::int AS n FROM billing_usage_events WHERE tenant_id = $1 GROUP BY status`, [tenantId]),
    ]);
    return {
      ok: true,
      tenant_id: tenantId,
      subscriptions_by_status: subs.rows,
      entitlements: ent.rows.map((r) => ({
        feature_key: r.feature_key,
        status: r.status,
        access_until: r.access_until,
      })),
      webhook_events_by_status: wh.rows,
      usage_by_status: usage.rows,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'snapshot_failed' };
  } finally {
    await pool.end().catch(() => {});
  }
}

async function runAutomatedSteps(task, root, opts = {}) {
  const env = await checkEnvSecrets();
  setStep(task, 'env_secrets', env.ok ? 'PASS' : 'BLOCKED', { checks: env.checks });

  const pg = await checkPostgresAndTables();
  setStep(task, 'postgres_connect', pg.ok ? 'PASS' : 'FAIL', {
    detail: pg.ok ? 'connected' : pg.error || 'unreachable',
  });
  setStep(
    task,
    'billing_tables',
    pg.ok ? 'PASS' : pg.missing?.length ? 'FAIL' : 'BLOCKED',
    { tables_found: pg.tables_found, missing: pg.missing || [] },
  );

  if (!pg.ok) {
    setStep(task, 'supabase_start', 'BLOCKED', { hint: 'Run npx supabase start on operator machine' });
  } else {
    setStep(task, 'supabase_start', 'PASS', { evidence: 'postgres_connect succeeded' });
  }

  if (opts.catalogCheck && process.env.BILLING_APP_URL) {
    const cat = await checkPublicCatalog(process.env.BILLING_APP_URL);
    setStep(task, 'dev_server', cat.ok ? 'PASS' : 'INCONCLUSIVE', cat);
  }

  if (opts.runJest) {
    setStep(task, 'unit_billing_jest', 'NOT_RUN', { hint: 'Run via billing.preflight action or npx jest tests/unit/billing' });
  }

  if (pg.ok && opts.runTier2Hint) {
    setStep(task, 'tier2_billing_pg', 'NOT_RUN', { hint: 'npm run test:local (local Supabase only)' });
  }

  saveTask(root, task);
  return task;
}

function finalReport(task) {
  const humanPending = task.steps.filter((s) => s.kind === 'human' && s.status === 'NOT_RUN');
  return {
    task_id: task.id,
    updated_at: task.updated_at,
    summary: task.summary,
    webhook_endpoint: WEBHOOK_PATH,
    migration: task.migration,
    human_steps_remaining: humanPending.map((s) => s.id),
    blocked: task.steps.filter((s) => s.status === 'BLOCKED').map((s) => ({ id: s.id, evidence: s.evidence })),
    failures: task.steps.filter((s) => s.status === 'FAIL').map((s) => ({ id: s.id, evidence: s.evidence })),
  };
}

module.exports = {
  PLAN,
  BILLING_TABLES,
  WEBHOOK_PATH,
  CATALOG_PATH,
  MIGRATION_ID,
  createTask,
  loadTask,
  saveTask,
  setStep,
  runAutomatedSteps,
  checkEnvSecrets,
  checkPostgresAndTables,
  snapshotTenantState,
  finalReport,
  taskDir,
  defaultStoreRoot,
};
