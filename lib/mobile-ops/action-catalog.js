'use strict';

/**
 * Allowlisted typed ops actions for the mobile command gateway.
 * No arbitrary shell — each action maps to a fixed runner in action-runners.js.
 */

const ACTIONS = Object.freeze({
  'health.check': {
    permission: 'status:view',
    confirmRequired: false,
    summary: 'Probe heidi-web, protoforge-core, Ollama and Ursula (read-only).',
  },
  'service.status': {
    permission: 'status:view',
    confirmRequired: false,
    summary: 'Fetch the unified subsystem + worker snapshot (same data as GET /api/status/system).',
  },
  'git.inspect': {
    permission: 'ops:diagnostics',
    confirmRequired: false,
    summary: 'Read-only git identity: branch, HEAD, short status (no diffs with secrets).',
  },
  'tests.run': {
    permission: 'ops:run_tests',
    confirmRequired: true,
    summary: 'Run one allowlisted Jest suite on the HYDI host (bounded time and output).',
  },
  'billing.preflight': {
    permission: 'billing:finance:view',
    confirmRequired: false,
    summary: 'Run billing sandbox preflight (env presence + Postgres billing_* tables). No secrets in output.',
  },
  'billing.verify_workflow': {
    permission: 'billing:finance:view',
    confirmRequired: false,
    summary: 'Run automated billing sandbox verification steps and return structured PASS/FAIL/BLOCKED report.',
  },
  'billing.verify_execution': {
    permission: 'billing:finance:view',
    confirmRequired: false,
    summary: 'Run verified billing execution stages A–J (resumable task_id). Hermetic security checks only; live steps stay NEEDS_HUMAN.',
    timeoutMs: 120_000,
  },
  'billing.identity_readiness': {
    permission: 'billing:finance:view',
    confirmRequired: false,
    summary: 'Sanitized identity configuration and schema readiness (no secrets).',
    timeoutMs: 30_000,
  },
  'billing.migration_status': {
    permission: 'billing:finance:view',
    confirmRequired: false,
    summary: 'Postgres connectivity and billing_* / identity table presence.',
    timeoutMs: 30_000,
  },
  'billing.webhook_config_check': {
    permission: 'billing:finance:view',
    confirmRequired: false,
    summary: 'Verify webhook-related env vars are present (names only, never values).',
    timeoutMs: 15_000,
  },
  'billing.operator_checklist': {
    permission: 'billing:finance:view',
    confirmRequired: false,
    summary: 'Return operator runbook paths and human verification stages.',
    timeoutMs: 5_000,
  },
  'billing.readiness_report': {
    permission: 'billing:finance:view',
    confirmRequired: false,
    summary: 'Evaluate merge/readiness from a saved verify_execution task (task_id required).',
    timeoutMs: 15_000,
  },
  'billing.identity_inventory': {
    permission: 'billing:finance:view',
    confirmRequired: false,
    summary: 'Credential inventory summary (doc pointer, no secrets).',
    timeoutMs: 5_000,
  },
  'billing.offboarding_preview': {
    permission: 'billing:tenants:manage',
    confirmRequired: false,
    summary: 'Preview unified offboarding steps for resolved tenant scope.',
    timeoutMs: 30_000,
  },
  'billing.offboarding_execute': {
    permission: 'billing:tenants:manage',
    confirmRequired: true,
    summary: 'Execute confirmed offboarding (membership, walkie, legacy, optional Supabase signOut).',
    timeoutMs: 120_000,
  },
  'billing.identity_recovery': {
    permission: 'billing:tenants:manage',
    confirmRequired: true,
    summary: 'Explicit membership reactivation or walkie rebind after revoke-first policy.',
    timeoutMs: 60_000,
  },
  'billing.verify_revocation': {
    permission: 'billing:finance:view',
    confirmRequired: false,
    summary: 'Run hermetic revocation/cross-tenant checks (not live integration).',
    timeoutMs: 60_000,
  },
  'billing.credential_revocation_status': {
    permission: 'billing:finance:view',
    confirmRequired: false,
    summary: 'Load offboarding task status by correlation_id (redacted).',
    timeoutMs: 15_000,
  },
});

/** Jest entrypoints phones may request — keys are suite names in the POST body. */
const TEST_SUITES = Object.freeze({
  'heidi-mobile': ['tests/unit/heidi-mobile-api.test.js', 'tests/unit/heidi-mobile-security.test.js'],
  'mobile-ops': ['tests/unit/mobile-ops-run-api.test.js', 'tests/unit/mobile-ops-action-runners.test.js'],
  billing: [
    'tests/unit/billing/preflight.test.js',
    'tests/unit/billing/sandbox-workflow.test.js',
    'tests/unit/billing/verified-execution.test.js',
    'tests/unit/billing/readiness-evaluator.test.js',
    'tests/unit/billing/identity-lifecycle.test.js',
    'tests/unit/billing/legacy-token-revocation.test.js',
    'tests/unit/billing/offboarding-workflow.test.js',
    'tests/unit/billing/providers-and-auth.test.js',
  ],
});

function isKnownAction(action) {
  return typeof action === 'string' && Object.prototype.hasOwnProperty.call(ACTIONS, action);
}

module.exports = { ACTIONS, TEST_SUITES, isKnownAction };
