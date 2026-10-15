'use strict';

/**
 * Typed mobile ops wrappers over ExecutionGateway (no shell/SQL).
 */

function getGateway(ctx) {
  if (ctx.executionGateway) return ctx.executionGateway;
  const { getExecutionGateway } = require('../execution-fabric/gateway');
  return getExecutionGateway();
}

function principalOf(ctx) {
  if (ctx.principal && typeof ctx.principal === 'object') return ctx.principal;
  return { subject: ctx.actor || ctx.role, role: ctx.role, tenant_id: null, auth_source: 'rbac' };
}

const ROLE_REQUIRED = Object.freeze({ ok: false, error: 'role_required' });

async function opsTaskStatus(args, ctx) {
  const taskId = typeof args.task_id === 'string' ? args.task_id.trim() : '';
  const role = ctx.role;
  if (!role) return ROLE_REQUIRED;
  if (!taskId) return { ok: false, error: 'task_id_required' };
  const out = await getGateway(ctx).getTask(taskId, role, principalOf(ctx));
  return { ok: out.ok, ...out };
}

async function opsTaskApprove(args, ctx) {
  const taskId = typeof args.task_id === 'string' ? args.task_id.trim() : '';
  const role = ctx.role;
  if (!role) return ROLE_REQUIRED;
  if (!taskId) return { ok: false, error: 'task_id_required' };
  if (args.confirm !== true) return { ok: false, error: 'confirmation_required' };
  return getGateway(ctx).approveTask(taskId, role, true, ctx.runnerCtx || {}, principalOf(ctx));
}

async function opsTaskCancel(args, ctx) {
  const taskId = typeof args.task_id === 'string' ? args.task_id.trim() : '';
  const role = ctx.role;
  if (!role) return ROLE_REQUIRED;
  if (!taskId) return { ok: false, error: 'task_id_required' };
  return getGateway(ctx).cancel(taskId, role, principalOf(ctx));
}

async function opsTaskResume(args, ctx) {
  const taskId = typeof args.task_id === 'string' ? args.task_id.trim() : '';
  const role = ctx.role;
  if (!role) return ROLE_REQUIRED;
  if (!taskId) return { ok: false, error: 'task_id_required' };
  const gateway = getGateway(ctx);
  const task = await gateway.store.get(taskId);
  if (!task) return { ok: false, error: 'not_found' };
  const { tenantAllows } = require('../execution-fabric/access');
  const access = tenantAllows(task, principalOf(ctx));
  if (!access.ok) return { ok: false, error: access.error };
  if (task.objective_id) {
    return gateway.orchestrator.retryObjective(taskId, role, ctx.runnerCtx || {});
  }
  if (task.state === 'BLOCKED' || task.state === 'FAILED') {
    return gateway.retryTask(taskId, role, ctx.runnerCtx || {}, principalOf(ctx));
  }
  return { ok: false, error: 'not_resumable', state: task.state };
}

async function opsTaskVerify(args, ctx) {
  const taskId = typeof args.task_id === 'string' ? args.task_id.trim() : '';
  const role = ctx.role;
  if (!role) return ROLE_REQUIRED;
  if (!taskId) return { ok: false, error: 'task_id_required' };
  const gateway = getGateway(ctx);
  const got = await gateway.getTask(taskId, role, principalOf(ctx));
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

async function opsBillingVerification(args, ctx) {
  const { integrationStatus, evaluateBillingEvidence } = require('../execution-fabric/billing-verification-adapter');
  const { redactSensitive } = require('../execution-fabric/access');
  const principal = principalOf(ctx);
  const integration = integrationStatus();
  const evidence = args && typeof args.evidence === 'object' ? args.evidence : null;
  const judged = evidence ? evaluateBillingEvidence(evidence, { tenant_id: principal.tenant_id }) : null;
  return {
    ok: true,
    integration,
    evaluation: judged ? redactSensitive(judged) : null,
    external_charge: false,
  };
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
  opsBillingVerification,
};
