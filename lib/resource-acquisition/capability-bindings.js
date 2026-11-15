'use strict';

/**
 * Capability descriptors for lib/heidi/CapabilityRegistry wiring (manual registration).
 * Executors delegate to createResourceActionRunner — read-only actions R0, writes R1–R2.
 */
const { ACTION_SPECS } = require('./actions');

const RESOURCE_CAPABILITIES = Object.entries(ACTION_SPECS).map(([capabilityId, spec]) => ({
  capabilityId,
  capabilityName: capabilityId,
  description: `Resource acquisition: ${capabilityId}`,
  provider: 'partnerships_coordinator',
  riskLevel: spec.risk,
  autonomyRequirement: spec.risk === 'R0' ? 1 : 3,
  dependencies: [],
  verificationStrategy: 'jest_and_operator_auth',
  reversible: false,
  timeoutMs: 120000,
  metadata: { module: 'lib/resource-acquisition/actions.js' },
}));

module.exports = { RESOURCE_CAPABILITIES };