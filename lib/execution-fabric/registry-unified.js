'use strict';

const { listCapabilities, getCapability, isKnownCapability, REGISTRY } = require('./capabilities');

/** Mobile-ops capability IDs that map to Heidi registry names (when present). */
const HEIDI_ID_ALIASES = Object.freeze({
  'health.check': 'world_model.observe_health',
  'service.status': 'world_model.observe_subsystems',
});

function loadHeidiRegistry() {
  try {
    const { getCapabilityRegistry } = require('../heidi/CapabilityRegistry.ts');
    return getCapabilityRegistry();
  } catch (_) {
    return null;
  }
}

function enrichCapability(record, role) {
  const heidi = loadHeidiRegistry();
  const alias = HEIDI_ID_ALIASES[record.id];
  const heidiDesc = heidi && alias ? heidi.get(alias) : null;
  return {
    ...record,
    version: '1',
    heidi_capability_id: heidiDesc?.capabilityId || null,
    heidi_risk_level: heidiDesc?.riskLevel || null,
    verification_contract: record.adapter === 'sync' ? 'sync_runner_outcome' : 'job_runner_state',
    adapter_available: true,
    approval_required: record.confirm_required === true,
    retry_policy: record.idempotent ? { max_attempts: 2, backoff_ms: 1000 } : { max_attempts: 1, backoff_ms: 0 },
  };
}

function listUnifiedCapabilities(role) {
  return listCapabilities(role).map((c) => enrichCapability(c, role));
}

function resolveExecutableCapability(capabilityId, role) {
  if (!isKnownCapability(capabilityId)) {
    return { ok: false, error: 'unknown_capability' };
  }
  const cap = getCapability(capabilityId);
  const { hasPermission } = require('../auth/rbac');
  if (!hasPermission(role, cap.permission)) {
    return { ok: false, error: 'forbidden' };
  }
  return { ok: true, capability: enrichCapability({ ...cap, confirm_required: cap.confirmRequired, id: cap.id }, role) };
}

module.exports = {
  REGISTRY,
  HEIDI_ID_ALIASES,
  listUnifiedCapabilities,
  resolveExecutableCapability,
  enrichCapability,
};
