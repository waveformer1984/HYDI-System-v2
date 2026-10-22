'use strict';

const { hasPermission } = require('../auth/rbac');
const { getObjective, isKnownObjective } = require('./objectives');
const { resolveExecutableCapability } = require('./registry-unified');

const PHASES = Object.freeze([
  'OBJECTIVE_RECEIVED',
  'PLAN_VALIDATED',
  'APPROVAL_CHECK',
  'EXECUTION',
  'VERIFICATION',
  'TERMINAL_OUTCOME',
]);

/**
 * Merge a store result's task back into the local copy — the Postgres store
 * returns fresh row objects instead of mutating in place (see gateway.js).
 */
function syncTask(local, result) {
  if (!result || !result.task) return;
  const t = result.task;
  local.state = t.state;
  local.version = t.version;
  local.steps = t.steps;
  local.updated_at = t.updated_at;
  local.lease_holder = t.lease_holder;
  local.lease_expires_at = t.lease_expires_at;
}

function mapStateToPhase(state, awaitingApproval) {
  if (state === 'QUEUED') return 'OBJECTIVE_RECEIVED';
  if (state === 'PLANNING') return 'PLAN_VALIDATED';
  if (state === 'AWAITING_APPROVAL' || awaitingApproval) return 'APPROVAL_CHECK';
  if (state === 'RUNNING' || state === 'RECOVERING') return 'EXECUTION';
  if (state === 'VERIFYING') return 'VERIFICATION';
  if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(state)) return 'TERMINAL_OUTCOME';
  return 'EXECUTION';
}

/**
 * @param {import('./gateway').ExecutionGateway} gateway
 */
class ObjectiveOrchestrator {
  constructor(gateway) {
    this.gateway = gateway;
  }

  validatePlan(objectiveId, role) {
    const obj = getObjective(objectiveId);
    if (!obj) return { ok: false, error: 'unknown_objective' };
    if (!hasPermission(role, obj.permission)) {
      return { ok: false, error: 'forbidden' };
    }
    for (const step of obj.steps) {
      const resolved = resolveExecutableCapability(step.capability_id, role);
      if (!resolved.ok) return { ok: false, error: resolved.error, step: step.capability_id };
    }
    return { ok: true, objective: obj };
  }

  async submitObjective({ objectiveId, role, actor, idempotencyKey, confirm = false, ctx = {} }) {
    const validated = this.validatePlan(objectiveId, role);
    if (!validated.ok) return validated;

    const store = this.gateway.store;
    const obj = validated.objective;

    if (idempotencyKey) {
      const existing = await store.findByIdempotency(idempotencyKey);
      if (existing) {
        return { ok: true, duplicate: true, task: require('./task-store-core').publicTask(existing) };
      }
    }

    const { task, created } = await store.createTask({
      capability_id: `objective:${objectiveId}`,
      objective: obj.description,
      objective_id: objectiveId,
      role,
      actor,
      idempotency_key: idempotencyKey,
      plan: {
        type: 'objective',
        objective_id: objectiveId,
        steps: obj.steps.map((s, i) => ({ index: i, capability_id: s.capability_id, args: s.args, status: 'pending' })),
        orchestration_phase: 'OBJECTIVE_RECEIVED',
      },
      authorization: { permitted: true, permission: obj.permission },
      recovery: { resume: 'GET task_id; POST approve if awaiting; poll until terminal' },
    });
    if (!created) {
      return { ok: true, duplicate: true, task: require('./task-store-core').publicTask(task) };
    }

    syncTask(task, await store.transition(task.id, 'PLANNING', { reason: 'plan_validate' }));
    task.plan.orchestration_phase = 'PLAN_VALIDATED';

    if (obj.confirmRequired && confirm !== true) {
      syncTask(task, await store.transition(task.id, 'AWAITING_APPROVAL', { reason: 'objective_confirm' }));
      task.plan.orchestration_phase = 'APPROVAL_CHECK';
      await store.persist(task);
      return { ok: true, awaiting_approval: true, task: require('./task-store-core').publicTask(task) };
    }

    return this.executePlan(task, role, ctx);
  }

  async approveObjective(taskId, role, confirm, ctx = {}) {
    const task = await this.gateway.store.get(taskId);
    if (!task) return { ok: false, error: 'not_found' };
    if (task.state !== 'AWAITING_APPROVAL') return { ok: false, error: 'not_awaiting_approval' };
    if (!hasPermission(role, 'fabric:control')) return { ok: false, error: 'forbidden' };
    if (confirm !== true) return { ok: false, error: 'confirm_required' };
    syncTask(task, await this.gateway.store.transition(taskId, 'RUNNING', { reason: 'approved' }));
    return this.executePlan(task, role, ctx);
  }

  async executePlan(task, role, ctx) {
    const store = this.gateway.store;
    const holder = `orchestrator:${process.pid}`;
    const claim = await store.claimLease(task.id, holder);
    if (!claim.ok) return { ok: false, error: claim.error || 'lease_failed' };
    syncTask(task, claim);

    if (task.state !== 'RUNNING') {
      syncTask(task, await store.transition(task.id, 'RUNNING', { reason: 'execute_objective' }));
    }
    task.plan.orchestration_phase = 'EXECUTION';
    task.attempt_count += 1;

    const steps = task.plan.steps || [];
    /** @type {object[]} */
    const stepResults = [];

    for (const step of steps) {
      if (step.status === 'completed') continue;
      const out = await this.gateway.submit({
        capabilityId: step.capability_id,
        args: step.args || {},
        confirm: true,
        role,
        actor: task.actor,
        objective: `${task.objective_id} step ${step.index}`,
        idempotencyKey: task.idempotency_key ? `${task.idempotency_key}:step:${step.index}` : null,
        ctx,
        parentTaskId: task.id,
      });
      stepResults.push({ index: step.index, capability_id: step.capability_id, out });
      if (!out.ok && !out.awaiting_approval && !out.accepted) {
        step.status = 'failed';
        task.plan.orchestration_phase = 'TERMINAL_OUTCOME';
        task.outcome = { executed: true, ok: false, partial: true, failed_step: step.index };
        syncTask(task, await store.transition(task.id, 'FAILED', { reason: 'step_failed' }));
        task.failure_class = 'dependency_failed';
        await store.persist(task);
        return { ok: false, task: require('./task-store-core').publicTask(task), steps: stepResults };
      }
      if (out.awaiting_approval || out.accepted) {
        step.status = 'pending_runner';
        task.checkpoint = { waiting_step: step.index, child_task_id: out.task?.id };
        await store.persist(task);
        return { ok: true, accepted: true, task: require('./task-store-core').publicTask(task), steps: stepResults };
      }
      step.status = 'completed';
      step.verification = out.task?.verification;
    }

    const vtr = await store.transition(task.id, 'VERIFYING', { reason: 'all_steps_done' });
    syncTask(task, vtr);
    task.plan.orchestration_phase = 'VERIFICATION';
    const allVerified = steps.every((s) => s.verification?.verified !== false);
    task.verification = {
      status: allVerified ? 'VERIFIED' : 'FAILED',
      verified: allVerified,
      evidence: { steps: steps.map((s) => ({ capability_id: s.capability_id, verification: s.verification })) },
    };
    if (allVerified) {
      syncTask(task, await store.transition(task.id, 'COMPLETED', { reason: 'objective_verified' }));
      task.outcome = { executed: true, ok: true, objective_id: task.objective_id };
    } else {
      syncTask(task, await store.transition(task.id, 'FAILED', { reason: 'verification_failed' }));
      task.outcome = { executed: true, ok: false, objective_id: task.objective_id };
    }
    task.plan.orchestration_phase = 'TERMINAL_OUTCOME';
    await store.persist(task);
    task = (await store.get(task.id)) || task;
    return { ok: allVerified, task: require('./task-store-core').publicTask(task), steps: stepResults };
  }

  async retryObjective(taskId, role, ctx = {}) {
    const task = await this.gateway.store.get(taskId);
    if (!task) return { ok: false, error: 'not_found' };
    if (!hasPermission(role, 'fabric:control')) return { ok: false, error: 'forbidden' };
    if (task.state !== 'FAILED') return { ok: false, error: 'not_retryable' };
    const obj = getObjective(task.objective_id);
    if (!obj) return { ok: false, error: 'unknown_objective' };
    syncTask(task, await this.gateway.store.transition(taskId, 'RECOVERING', { reason: 'operator_retry' }));
    for (const step of task.plan.steps || []) {
      if (step.status === 'failed') step.status = 'pending';
    }
    return this.executePlan(task, role, ctx);
  }
}

module.exports = { ObjectiveOrchestrator, PHASES, mapStateToPhase, isKnownObjective };
