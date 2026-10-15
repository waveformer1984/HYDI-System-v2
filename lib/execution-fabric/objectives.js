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
});

function getObjective(id) {
  return OBJECTIVES[id] || null;
}

function isKnownObjective(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(OBJECTIVES, id);
}

module.exports = { OBJECTIVES, getObjective, isKnownObjective };
