'use strict';

/**
 * Smallest adapter: distributed control plane schedules; ExecutionGateway executes.
 * No second execution engine.
 */

/** Only capabilities registered in lib/execution-fabric/capabilities.js */
const DISTRIBUTED_TO_FABRIC = Object.freeze({
  'health.snapshot': 'health.check',
  'ops.service_status': 'service.status',
});

function resolveFabricCapability(task) {
  const action = task.action || task.type;
  return DISTRIBUTED_TO_FABRIC[action] || null;
}

async function linkFabricExecution(gateway, task, { role = 'operator', principal = null, confirm = false } = {}) {
  if (task.approval?.required && !task.approval?.approved) {
    return { ok: false, error: 'approval_required', authority: 'distributed_schedule_only' };
  }
  const capabilityId = resolveFabricCapability(task);
  if (!capabilityId) {
    return { ok: false, error: 'no_fabric_mapping', authority: 'distributed_schedule_only' };
  }
  const submitted = await gateway.submit({
    capabilityId,
    args: task.input || {},
    confirm,
    role,
    actor: task.created_by || 'distributed-cloud',
    objective: task.objective,
    idempotencyKey: task.idempotency_key || task.id,
    correlationId: task.id,
    principal,
  });
  if (!submitted.task) {
    return { ...submitted, authority: 'fabric' };
  }
  return {
    ok: true,
    authority: 'fabric',
    fabric_task_id: submitted.task.id,
    duplicate: Boolean(submitted.duplicate),
    awaiting_approval: Boolean(submitted.awaiting_approval),
    execution_ok: submitted.ok !== false,
    fabric_public: submitted.task,
    fabric_submission: submitted,
  };
}

module.exports = {
  DISTRIBUTED_TO_FABRIC,
  resolveFabricCapability,
  linkFabricExecution,
};