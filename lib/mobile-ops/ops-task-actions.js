'use strict';

/**
 * Typed mobile ops wrappers over ExecutionGateway (no shell/SQL).
 */

function getGateway(ctx) {
  if (ctx.executionGateway) return ctx.executionGateway;
  const { getExecutionGateway } = require('../execution-fabric/gateway');
  return getExecutionGateway();
}

async function opsTaskStatus(args, ctx) {
  const taskId = typeof args.task_id === 'string' ? args.task_id.trim() : '';
  const role = ctx.role || 'operator';
  if (!taskId) return { ok: false, error: 'task_id_required' };
  const out = await getGateway(ctx).getTask(taskId, role);
  return { ok: out.ok, ...out };
}

async function opsTaskApprove(args, ctx) {
  const taskId = typeof args.task_id === 'string' ? args.task_id.trim() : '';
  const role = ctx.role || 'operator';
  if (!taskId) return { ok: false, error: 'task_id_required' };
  if (args.confirm !== true) return { ok: false, error: 'confirmation_required' };
  return getGateway(ctx).approveTask(taskId, role, true, ctx.runnerCtx || {});
}

async function opsTaskCancel(args, ctx) {
  const taskId = typeof args.task_id === 'string' ? args.task_id.trim() : '';
  const role = ctx.role || 'operator';
  if (!taskId) return { ok: false, error: 'task_id_required' };
  return getGateway(ctx).cancel(taskId, role);
}

async function opsTaskResume(args, ctx) {
  const taskId = typeof args.task_id === 'string' ? args.task_id.trim() : '';
  const role = ctx.role || 'operator';
  if (!taskId) return { ok: false, error: 'task_id_required' };
  const gateway = getGateway(ctx);
  const task = await gateway.store.get(taskId);
  if (!task) return { ok: false, error: 'not_found' };
  if (task.objective_id) {
    return gateway.orchestrator.retryObjective(taskId, role, ctx.runnerCtx || {});
  }
  if (task.state === 'BLOCKED' || task.state === 'FAILED') {
    return gateway.retryTask(taskId, role, ctx.runnerCtx || {});
  }
  return { ok: false, error: 'not_resumable', state: task.state };
}

async function opsTaskVerify(args, ctx) {
  const taskId = typeof args.task_id === 'string' ? args.task_id.trim() : '';
  const role = ctx.role || 'operator';
  if (!taskId) return { ok: false, error: 'task_id_required' };
  const gateway = getGateway(ctx);
  const got = await gateway.getTask(taskId, role);
  if (!got.ok) return got;
  const task = await gateway.store.get(taskId);
  const { runContractChecks } = require('../execution-fabric/verification-contracts');
  const outcome = { ok: task.outcome?.ok, result: task.outcome?.result, correlation_id: task.correlation_id };
  const { checks, verification } = await runContractChecks(task.capability_id, outcome, ctx);
  task.verification = verification;
  if (task.state === 'COMPLETED' && !verification.verified) {
    await gateway.store.transition(taskId, 'FAILED', { reason: 'reverify_failed' });
    task.state = 'FAILED';
  }
  await gateway.store.persist(task);
  return { ok: verification.verified, task: got.task, checks, verification };
}

async function opsExecutionReadiness(ctx) {
  const { assessExecutionFabricReadiness } = require('../execution-fabric/readiness');
  const { buildOperationalSummary } = require('../execution-fabric/operational-summary');
  const gateway = getGateway(ctx);
  const readiness = assessExecutionFabricReadiness({ store: gateway.store });
  const ops = await buildOperationalSummary(gateway.store);
  return { ok: readiness.overall !== 'BLOCKED', readiness, operational: ops };
}

async function opsRecoveryPreview(_args, ctx) {
  const { recoverInterruptedTasks } = require('../execution-fabric/recovery');
  const gateway = getGateway(ctx);
  const beforeIso = new Date().toISOString();
  const stale = await gateway.store.listStaleLeases(beforeIso);
  return {
    ok: true,
    preview: true,
    stale_leases: stale.map((t) => ({
      task_id: t.id,
      correlation_id: t.correlation_id || t.id,
      state: t.state,
      capability_id: t.capability_id,
      lease_holder: t.lease_holder,
      lease_expires_at: t.lease_expires_at,
    })),
    note: 'Preview only — no state changes. Use ops.recovery_execute with confirm to reconcile.',
  };
}

async function opsRecoveryExecute(args, ctx) {
  if (args.confirm !== true) {
    return { ok: false, error: 'confirmation_required', message: 'Set confirm: true to run recovery reconciliation.' };
  }
  const { recoverInterruptedTasks } = require('../execution-fabric/recovery');
  const gateway = getGateway(ctx);
  const rec = await recoverInterruptedTasks(gateway.store);
  const status = await gateway.recoveryStatus();
  return { ok: true, recovered: rec, recovery_status: status };
}

module.exports = {
  opsTaskStatus,
  opsTaskApprove,
  opsTaskCancel,
  opsTaskResume,
  opsTaskVerify,
  opsExecutionReadiness,
  opsRecoveryPreview,
  opsRecoveryExecute,
};
