'use strict';

/**
 * Verified billing sandbox execution — stages A–J with structured, resumable checks.
 * Extends sandbox-workflow task persistence (.hydi/billing-verify/*.json).
 */

const { randomBytes } = require('crypto');
const {
  checkEnvSecrets,
  checkPostgresAndTables,
  loadTask,
  saveTask,
  createTask,
  BILLING_TABLES,
  WEBHOOK_PATH,
} = require('./sandbox-workflow');
const { summarizeBillingIdentityReadiness } = require('./identity-readiness');
const { evaluateBillingReadiness } = require('./readiness-evaluator');
const { runHermeticBillingSecurityChecks } = require('./hermetic-security-checks');

/** @typedef {'PASS'|'FAIL'|'BLOCKED'|'NOT_RUN'|'NEEDS_HUMAN'} CheckStatus */

const IDENTITY_MIGRATION_MARKERS = [
  '20261011120000_billing_revenue_streams_module.sql',
  '20261015140000_billing_tenant_identity.sql',
];

/**
 * @returns {{ check_id: string, status: CheckStatus, started_at: string, completed_at: string, details: object, evidence: object, retryable: boolean, next_action: string|null }}
 */
function makeCheck(checkId, status, details = {}, evidence = {}, retryable = true, nextAction = null) {
  const now = new Date().toISOString();
  return {
    check_id: checkId,
    status,
    started_at: now,
    completed_at: now,
    details,
    evidence,
    retryable,
    next_action: nextAction,
  };
}

async function checkDockerAvailable() {
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const exec = promisify(execFile);
  try {
    await exec('docker', ['info'], { timeout: 5000 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'docker_unavailable' };
  }
}

async function checkMigrationMarkers(pg) {
  if (!pg?.ok) {
    return makeCheck(
      'C.migration_schema',
      pg?.error ? 'BLOCKED' : 'FAIL',
      { reason: pg?.error || 'postgres_unreachable', missing: pg?.missing || BILLING_TABLES },
      { migration_markers: IDENTITY_MIGRATION_MARKERS },
      true,
      'Start local Supabase (npx supabase start) and apply billing migrations',
    );
  }
  const missing = pg.missing || [];
  const identityMissing = ['billing_tenant_members', 'billing_walkie_tenant_bindings'].filter((t) => missing.includes(t));
  return makeCheck(
    'C.migration_schema',
    identityMissing.length ? 'FAIL' : 'PASS',
    { tables_present: pg.tables_found, identity_tables_ok: identityMissing.length === 0, missing },
    { migration_markers: IDENTITY_MIGRATION_MARKERS },
    true,
    identityMissing.length ? 'Apply identity migration on local Postgres' : null,
  );
}

/**
 * Run stages A–J; merge into task.verified_checks and task.readiness.
 * @param {object} task persisted sandbox task
 * @param {string} root repo root for saveTask
 * @param {{ resume?: boolean, runHermetic?: boolean }} [opts]
 */
async function runVerifiedBillingExecution(task, root, opts = {}) {
  const checks = [];
  const runHermetic = opts.runHermetic !== false;

  // A — environment preflight
  const env = await checkEnvSecrets();
  checks.push(
    makeCheck(
      'A.env_preflight',
      env.ok ? 'PASS' : 'BLOCKED',
      { checks: env.checks },
      {},
      true,
      env.ok ? null : 'Set test-mode Stripe, BILLING_* secrets per docs/billing/SANDBOX_RUN_OPERATOR.md',
    ),
  );

  const docker = await checkDockerAvailable();
  checks.push(
    makeCheck(
      'A.docker',
      docker.ok ? 'PASS' : 'BLOCKED',
      { available: docker.ok, hint: docker.error || 'ok' },
      {},
      true,
      docker.ok ? null : 'Start Docker Desktop / daemon for local Supabase',
    ),
  );

  // B — Supabase / Postgres
  const pg = await checkPostgresAndTables();
  checks.push(
    makeCheck(
      'B.supabase_postgres',
      pg.ok ? 'PASS' : 'BLOCKED',
      { error: pg.error || null },
      { port: process.env.PG_PORT || '54322' },
      true,
      pg.ok ? null : 'Run npx supabase start on operator host',
    ),
  );

  // C — migrations / schema
  checks.push(await checkMigrationMarkers(pg));

  // D — identity configuration
  const identitySummary = summarizeBillingIdentityReadiness({
    missing: pg.missing || [],
    tablesFound: pg.ok ? BILLING_TABLES.filter((t) => !(pg.missing || []).includes(t)) : [],
  });
  const identityBlocked =
    identitySummary.supabase_member_auth.verification === 'BLOCKED'
    || identitySummary.database.billing_tenant_members === 'BLOCKED';
  checks.push(
    makeCheck(
      'D.identity_readiness',
      identityBlocked ? 'BLOCKED' : pg.ok ? 'PASS' : 'NOT_RUN',
      { summary: identitySummary },
      {},
      true,
      identityBlocked ? identitySummary.human_actions[0] || 'Configure Supabase public keys' : null,
    ),
  );

  // E–G live integration — never PASS without evidence
  const liveReady = env.ok && pg.ok && process.env.BILLING_APP_URL;
  checks.push(
    makeCheck(
      'E.session_signup_signin',
      liveReady ? 'NEEDS_HUMAN' : 'NOT_RUN',
      { billing_app_url: Boolean(process.env.BILLING_APP_URL) },
      { doc: 'docs/billing/SANDBOX_RUN_OPERATOR.md' },
      true,
      'Operator: POST /api/billing/auth/signup and signin; verify GET /api/billing/auth/session',
    ),
  );
  checks.push(
    makeCheck(
      'F.session_checkout',
      liveReady ? 'NEEDS_HUMAN' : 'NOT_RUN',
      {},
      { doc: 'docs/billing/SANDBOX_RUN_OPERATOR.md §J.5' },
      true,
      'Complete browser checkout using session cookie (not legacy token alone)',
    ),
  );
  checks.push(
    makeCheck(
      'G.stripe_webhook_live',
      liveReady && env.checks?.billing_webhook_secret === 'present' ? 'NEEDS_HUMAN' : 'NOT_RUN',
      { webhook_path: WEBHOOK_PATH },
      {},
      true,
      'Run stripe listen → POST /api/billing/webhook with test event',
    ),
  );

  // H — hermetic webhook + invalid signature (unit-backed)
  if (runHermetic) {
    const hermetic = await runHermeticBillingSecurityChecks();
    checks.push(
      makeCheck(
        'H.webhook_signature_and_duplicate',
        hermetic.webhook.ok ? 'PASS' : 'FAIL',
        { cases: hermetic.webhook.cases },
        { scope: 'hermetic_memory_store' },
        false,
        hermetic.webhook.ok ? null : 'Fix billing webhook handler regressions',
      ),
    );
    checks.push(
      makeCheck(
        'I.cross_tenant_authorization',
        hermetic.crossTenant.ok ? 'PASS' : 'FAIL',
        { cases: hermetic.crossTenant.cases },
        { scope: 'hermetic_memory_store' },
        false,
        null,
      ),
    );
    checks.push(
      makeCheck(
        'I.identity_revocation',
        hermetic.revocation.ok ? 'PASS' : 'FAIL',
        { cases: hermetic.revocation.cases },
        { scope: 'hermetic_memory_store' },
        false,
        null,
      ),
    );
  } else {
    checks.push(makeCheck('H.webhook_signature_and_duplicate', 'NOT_RUN', {}, {}, true, 'Enable runHermetic in verify_execution'));
    checks.push(makeCheck('I.cross_tenant_authorization', 'NOT_RUN', {}, {}, true, null));
    checks.push(makeCheck('I.identity_revocation', 'NOT_RUN', {}, {}, true, null));
  }

  // J — aggregate readiness (never hardcode success)
  const readiness = evaluateBillingReadiness({ checks, task, env, pg });
  checks.push(
    makeCheck(
      'J.evidence_disposition',
      readiness.merge_eligible ? 'NEEDS_HUMAN' : readiness.live_integration === 'PASS' ? 'PASS' : 'BLOCKED',
      { readiness },
      { task_id: task.id },
      true,
      readiness.operator_actions[0] || 'Complete human sandbox steps and security review',
    ),
  );

  task.verified_checks = checks;
  task.readiness = readiness;
  task.phase = 'VERIFIED_EXECUTION';
  task.updated_at = new Date().toISOString();
  saveTask(root, task);
  return { task, checks, readiness };
}

function resumeVerifiedExecution(root, taskId, opts = {}) {
  const task = loadTask(root, taskId);
  if (!task) return { ok: false, error: 'task_not_found', task_id: taskId };
  return runVerifiedBillingExecution(task, root, { ...opts, resume: true });
}

function operatorChecklist() {
  return {
    runbook: 'docs/billing/SANDBOX_RUN_OPERATOR.md',
    lifecycle: 'docs/billing/IDENTITY_LIFECYCLE.md',
    evidence_template: 'docs/billing/SANDBOX_RUN_2026-10-15-operator.md',
    human_stages: ['E.session_signup_signin', 'F.session_checkout', 'G.stripe_webhook_live'],
    webhook_path: WEBHOOK_PATH,
    identity_admin: {
      walkie_bind: 'POST /api/billing/admin/walkie-bindings { op: bind, confirm: true, reason }',
      walkie_revoke: 'POST /api/billing/admin/walkie-bindings { op: revoke, confirm: true, reason }',
      membership_revoke: 'POST /api/billing/admin/memberships { op: revoke, confirm: true, reason }',
    },
  };
}

module.exports = {
  runVerifiedBillingExecution,
  resumeVerifiedExecution,
  operatorChecklist,
  makeCheck,
  IDENTITY_MIGRATION_MARKERS,
};
