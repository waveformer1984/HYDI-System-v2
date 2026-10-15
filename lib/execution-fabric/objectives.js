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
});

function getObjective(id) {
  return OBJECTIVES[id] || null;
}

function isKnownObjective(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(OBJECTIVES, id);
}

module.exports = { OBJECTIVES, getObjective, isKnownObjective };
