'use strict';

const { DISTRIBUTED_TO_FABRIC, resolveFabricCapability } = require('../distributed-cloud/fabric-adapter');
const { isKnownCapability, getCapability } = require('./capabilities');

/**
 * Read-only health of distributed → fabric capability wiring (no execution).
 */
function buildDistributedCapabilityMatrix() {
  const rows = [];
  for (const [distributedAction, fabricId] of Object.entries(DISTRIBUTED_TO_FABRIC)) {
    const fabric = getCapability(fabricId);
  const taskProbe = resolveFabricCapability({ action: distributedAction });
    rows.push({
      distributed_action: distributedAction,
      fabric_capability_id: fabricId,
      mapping_resolves: taskProbe === fabricId,
      fabric_registered: Boolean(fabric),
      adapter: fabric?.adapter ?? null,
      permission: fabric?.permission ?? null,
      confirm_required: fabric?.confirmRequired ?? null,
      idempotent: fabric?.idempotent ?? null,
      timeout_ms: fabric?.timeoutMs ?? null,
      execution_ready: Boolean(fabric),
    });
  }
  return {
    generated_at: new Date().toISOString(),
    mapping_count: rows.length,
    rows,
    gaps: rows.filter((r) => !r.fabric_registered || !r.mapping_resolves).map((r) => r.distributed_action),
  };
}

function assertCapabilityPreconditions(capabilityId, { role = 'operator', confirmed = false } = {}) {
  if (!isKnownCapability(capabilityId)) {
    return { ok: false, code: 'UNKNOWN_CAPABILITY' };
  }
  const cap = getCapability(capabilityId);
  if (cap.confirmRequired && !confirmed) {
    return { ok: false, code: 'CONFIRMATION_REQUIRED' };
  }
  return { ok: true, code: 'OK', capability: cap, role };
}

module.exports = {
  buildDistributedCapabilityMatrix,
  assertCapabilityPreconditions,
};