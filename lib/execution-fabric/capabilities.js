'use strict';

/**
 * Unified capability registry for mobile-ops execution.
 * Merges sync typed actions and long-running jobs — no duplicate engines.
 */

const { hasPermission } = require('../auth/rbac');
const { ACTIONS } = require('../mobile-ops/action-catalog');
const { JOBS } = require('../mobile-ops/job-catalog');

/** @typedef {'read'|'ops'|'build'} RiskClass */

/**
 * @typedef {object} CapabilityRecord
 * @property {string} id
 * @property {string} description
 * @property {'sync'|'job'} adapter
 * @property {string} permission
 * @property {boolean} confirmRequired
 * @property {RiskClass} risk
 * @property {boolean} idempotent
 * @property {number} [timeoutMs]
 * @property {string} [jobKind]
 */

/** @type {Record<string, CapabilityRecord>} */
const REGISTRY = Object.freeze(buildRegistry());

function buildRegistry() {
  /** @type {Record<string, CapabilityRecord>} */
  const out = {};
  for (const [id, meta] of Object.entries(ACTIONS)) {
    out[id] = {
      id,
      description: meta.summary,
      adapter: 'sync',
      permission: meta.permission,
      confirmRequired: meta.confirmRequired,
      risk: id === 'tests.run' ? 'ops' : 'read',
      idempotent: id !== 'tests.run',
    };
  }
  for (const [kind, meta] of Object.entries(JOBS)) {
    const id = `job.${kind}`;
    out[id] = {
      id,
      description: meta.summary,
      adapter: 'job',
      permission: meta.permission,
      confirmRequired: meta.confirmRequired,
      risk: kind.includes('build') ? 'build' : 'ops',
      idempotent: false,
      timeoutMs: meta.timeoutMs,
      jobKind: kind,
    };
  }
  return out;
}

function isKnownCapability(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(REGISTRY, id);
}

function getCapability(id) {
  return isKnownCapability(id) ? REGISTRY[id] : null;
}

function listCapabilities(role) {
  return Object.values(REGISTRY)
    .filter((c) => hasPermission(role, c.permission))
    .map(({ id, description, adapter, permission, confirmRequired, risk, idempotent, timeoutMs }) => ({
      id,
      description,
      adapter,
      permission,
      confirm_required: confirmRequired,
      risk,
      idempotent,
      timeout_ms: timeoutMs ?? null,
    }));
}

module.exports = { REGISTRY, isKnownCapability, getCapability, listCapabilities };
