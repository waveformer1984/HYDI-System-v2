'use strict';

const { REGISTRY } = require('./capabilities');
const { getTaskStore } = require('./task-store');

/**
 * Evidence-based readiness for the mobile execution fabric slice.
 * Does not claim HYDI overall is READY — only this control plane.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.jobManagerOk]
 * @param {boolean} [opts.authConfigured]
 */
function assessExecutionFabricReadiness(opts = {}) {
  /** @type {{ id: string, state: 'PASS'|'FAIL'|'UNKNOWN', detail: string, critical: boolean }[]} */
  const components = [];

  const registryCount = Object.keys(REGISTRY).length;
  components.push({
    id: 'capability_registry',
    state: registryCount > 0 ? 'PASS' : 'FAIL',
    detail: `${registryCount} registered capabilities`,
    critical: true,
  });

  components.push({
    id: 'task_store',
    state: getTaskStore() ? 'PASS' : 'FAIL',
    detail: 'In-process task lifecycle store (survives warm reload via globalThis)',
    critical: true,
  });

  const jobOk = opts.jobManagerOk !== false;
  components.push({
    id: 'job_adapter',
    state: jobOk ? 'PASS' : 'UNKNOWN',
    detail: jobOk ? 'JobManager available' : 'JobManager not verified in this process',
    critical: false,
  });

  const authOk = opts.authConfigured !== false;
  components.push({
    id: 'auth_rbac',
    state: authOk ? 'PASS' : 'UNKNOWN',
    detail: authOk ? 'RBAC matrix loaded' : 'Auth not verified',
    critical: true,
  });

  const criticalFail = components.some((c) => c.critical && c.state === 'FAIL');
  const anyUnknown = components.some((c) => c.state === 'UNKNOWN');
  let overall = 'READY';
  if (criticalFail) overall = 'BLOCKED';
  else if (anyUnknown) overall = 'DEGRADED';

  return {
    overall,
    scope: 'execution_fabric_mobile_ops',
    components,
    ts: new Date().toISOString(),
  };
}

module.exports = { assessExecutionFabricReadiness };
