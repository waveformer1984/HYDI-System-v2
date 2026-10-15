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
  'ops.task_status': {
    permission: 'status:view',
    confirmRequired: false,
    summary: 'Get execution-fabric task status by task_id (redacted).',
    timeoutMs: 15_000,
  },
  'ops.task_approve': {
    permission: 'status:view',
    confirmRequired: true,
    summary: 'Approve an AWAITING_APPROVAL fabric task (confirm required).',
    timeoutMs: 120_000,
  },
  'ops.task_cancel': {
    permission: 'status:view',
    confirmRequired: true,
    summary: 'Cancel a pending or job-backed fabric task.',
    timeoutMs: 30_000,
  },
  'ops.task_resume': {
    permission: 'status:view',
    confirmRequired: true,
    summary: 'Retry/resume a FAILED or BLOCKED sync task or objective (idempotent).',
    timeoutMs: 120_000,
  },
  'ops.task_verify': {
    permission: 'status:view',
    confirmRequired: false,
    summary: 'Re-run independent verification contracts for a task.',
    timeoutMs: 60_000,
  },
  'ops.execution_readiness': {
    permission: 'status:view',
    confirmRequired: false,
    summary: 'Fabric readiness plus operational task summary (queued/running/blocked).',
    timeoutMs: 30_000,
  },
  'ops.recovery_preview': {
    permission: 'ops:diagnostics',
    confirmRequired: false,
    summary: 'List stale execution-fabric leases and interrupted tasks (no mutations).',
    timeoutMs: 30_000,
  },
  'ops.billing_verification': {
    permission: 'billing:finance:view',
    confirmRequired: false,
    summary: 'Read billing verification integration status and evaluate supplied evidence (no charges).',
    timeoutMs: 30_000,
  },
  'ops.recovery_execute': {
    permission: 'ops:diagnostics',
    confirmRequired: true,
    summary: 'Reconcile stale leases via approved recovery policy (idempotent vs blocked replay).',
    timeoutMs: 60_000,
  },
});

/** Jest entrypoints phones may request — keys are suite names in the POST body. */
const TEST_SUITES = Object.freeze({
  'heidi-mobile': ['tests/unit/heidi-mobile-api.test.js', 'tests/unit/heidi-mobile-security.test.js'],
  'mobile-ops': ['tests/unit/mobile-ops-run-api.test.js', 'tests/unit/mobile-ops-action-runners.test.js', 'tests/unit/execution-fabric-phase4.test.js'],
  'execution-fabric': [
    'tests/unit/execution-fabric-gateway.test.js',
    'tests/unit/execution-fabric-orchestrator.test.js',
    'tests/unit/execution-fabric-recovery.test.js',
    'tests/unit/execution-fabric-phase4.test.js',
  ],
  billing: [
    'tests/unit/billing/preflight.test.js',
    'tests/unit/billing/sandbox-workflow.test.js',
    'tests/unit/billing/providers-and-auth.test.js',
  ],
});

function isKnownAction(action) {
  return typeof action === 'string' && Object.prototype.hasOwnProperty.call(ACTIONS, action);
}

module.exports = { ACTIONS, TEST_SUITES, isKnownAction };
