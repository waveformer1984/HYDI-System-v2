'use strict';

const { getCapability } = require('../execution-fabric/capabilities');

/**
 * Workforce agents must not run privileged/external fabric capabilities until
 * distributed worker hardening (PR #590) is deployed. Operator ack only.
 */
function isPrivilegedCapability(capabilityId) {
  const cap = getCapability(capabilityId);
  if (!cap) return true;
  if (cap.confirmRequired) return true;
  if (cap.risk === 'build') return true;
  return false;
}

function distributedHardeningAcknowledged(env = process.env) {
  return String(env.HYDI_WORKFORCE_DISTRIBUTED_READY || '').trim().toLowerCase() === 'true';
}

function workforceAssignGate(capabilityId, env = process.env) {
  if (!isPrivilegedCapability(capabilityId)) {
    return { ok: true, privileged: false };
  }
  if (distributedHardeningAcknowledged(env)) {
    return { ok: true, privileged: true, ack: true };
  }
  return {
    ok: false,
    privileged: true,
    error: 'distributed_hardening_required',
    classification: 'BLOCKED',
    message:
      'Privileged/external fabric capabilities are blocked until distributed hardening (PR #590) is deployed. Operator sets HYDI_WORKFORCE_DISTRIBUTED_READY=true after verification.',
  };
}

module.exports = {
  isPrivilegedCapability,
  distributedHardeningAcknowledged,
  workforceAssignGate,
};