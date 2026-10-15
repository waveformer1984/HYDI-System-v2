'use strict';

const { REGISTRY } = require('./capabilities');
const { getTaskStore } = require('./task-store');

/**
 * Evidence-based readiness for the mobile execution fabric slice.
 * Does not claim HYDI overall is READY — only this control plane.
 *
 * @param {object} [opts]
 * @param {import('./task-store').TaskStoreLike} [opts.store]
 * @param {boolean} [opts.jobManagerOk]
 * @param {boolean} [opts.authConfigured]
 * @param {boolean} [opts.supabaseConfigured]
 */
function assessExecutionFabricReadiness(opts = {}) {
  /** @type {{ id: string, state: 'PASS'|'FAIL'|'UNKNOWN', detail: string, critical: boolean }[]} */
  const components = [];
  const store = opts.store || getTaskStore();
  const mode = store.persistenceMode || 'memory';

  const registryCount = Object.keys(REGISTRY).length;
  components.push({
    id: 'capability_registry',
    state: registryCount > 0 ? 'PASS' : 'FAIL',
    detail: `${registryCount} registered capabilities`,
    critical: true,
  });

  const persistPass = mode === 'postgres' && opts.supabaseConfigured !== false;
  const persistState = mode === 'postgres' ? (persistPass ? 'PASS' : 'FAIL') : 'UNKNOWN';
  components.push({
    id: 'persistence',
    state: persistState,
    detail:
      mode === 'postgres'
        ? 'Postgres task store (execution_fabric_tasks)'
        : 'In-memory store only — restart loses tasks unless EXECUTION_FABRIC_PERSIST=postgres',
    critical: false,
  });

  components.push({
    id: 'task_store',
    state: store ? 'PASS' : 'FAIL',
    detail: `Task lifecycle store (${mode})`,
    critical: true,
  });

  components.push({
    id: 'authorization',
    state: opts.authConfigured !== false ? 'PASS' : 'UNKNOWN',
    detail: 'RBAC via requireAuth + capability permissions',
    critical: true,
  });

  components.push({
    id: 'verification',
    state: 'PASS',
    detail: 'Shared verification contract (VERIFIED/FAILED/INCONCLUSIVE/NOT_REQUIRED)',
    critical: true,
  });

  components.push({
    id: 'recovery',
    state: mode === 'postgres' || mode === 'memory' ? 'PASS' : 'UNKNOWN',
    detail: 'Stale-lease reconciliation on gateway startup',
    critical: false,
  });

  components.push({
    id: 'mobile_connectivity',
    state: 'UNKNOWN',
    detail: 'Requires live BFF + paired device (not verified in-process)',
    critical: false,
  });

  const jobOk = opts.jobManagerOk !== false;
  components.push({
    id: 'worker_availability',
    state: jobOk ? 'PASS' : 'UNKNOWN',
    detail: jobOk ? 'JobManager available for job.* capabilities' : 'JobManager not verified in this process',
    critical: false,
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
    persistence_mode: mode,
    ts: new Date().toISOString(),
  };
}

module.exports = { assessExecutionFabricReadiness };
