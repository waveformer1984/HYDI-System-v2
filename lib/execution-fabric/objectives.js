'use strict';

/**
 * Bounded objective templates — deterministic plans only (no LLM execution authority).
 */
const OBJECTIVES = Object.freeze({
  'ops.host-health-snapshot': {
    id: 'ops.host-health-snapshot',
    description: 'Run host health probe then service status snapshot (read-only).',
    permission: 'status:view',
    confirmRequired: false,
    steps: [
      { capability_id: 'health.check', args: {} },
      { capability_id: 'service.status', args: {} },
    ],
  },
  'ops.billing-sandbox-verify': {
    id: 'ops.billing-sandbox-verify',
    description: 'Automated billing sandbox checks (env + Postgres schema). Human steps for Stripe listen and browser §J remain operator-owned.',
    permission: 'billing:finance:view',
    confirmRequired: false,
    steps: [
      { capability_id: 'billing.verify_execution', args: {} },
      { capability_id: 'billing.preflight', args: {} },
      { capability_id: 'billing.operator_checklist', args: {} },
      { capability_id: 'tests.run', args: { suite: 'billing' } },
    ],
  },
  'ops.mobile-recommended': {
    id: 'ops.mobile-recommended',
    description: 'Read-only mobile ops bundle: host health, git identity, billing diagnostics, execution readiness.',
    permission: 'status:view',
    confirmRequired: false,
    steps: [
      { capability_id: 'health.check', args: {} },
      { capability_id: 'git.inspect', args: {} },
      { capability_id: 'billing.migration_status', args: {} },
      { capability_id: 'billing.webhook_config_check', args: {} },
      { capability_id: 'billing.identity_readiness', args: {} },
      { capability_id: 'billing.ops_snapshot', args: {} },
      { capability_id: 'ops.execution_readiness', args: {} },
      { capability_id: 'ops.recovery_preview', args: {} },
    ],
  },
  'ops.evolution-audit': {
    id: 'ops.evolution-audit',
    description: 'Evolution bundle: status, full audit, improvement plan, history tail (read-only except plan persistence).',
    permission: 'ops:diagnostics',
    confirmRequired: false,
    steps: [
      { capability_id: 'evolution.status', args: {} },
      { capability_id: 'evolution.audit', args: {} },
      { capability_id: 'evolution.plan', args: {} },
      { capability_id: 'evolution.history', args: { limit: 20 } },
    ],
  },
  'ops.evolution-vertical-slice': {
    id: 'ops.evolution-vertical-slice',
    description: 'Audit + plan, then start async bounded improvement job (operator confirms execute_async).',
    permission: 'fabric:control',
    confirmRequired: false,
    steps: [
      { capability_id: 'evolution.audit', args: {} },
      { capability_id: 'evolution.plan', args: {} },
      { capability_id: 'evolution.execute_async', args: { confirm: true } },
    ],
  },
});

function getObjective(id) {
  return OBJECTIVES[id] || null;
}

function isKnownObjective(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(OBJECTIVES, id);
}

module.exports = { OBJECTIVES, getObjective, isKnownObjective };
