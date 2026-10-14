'use strict';

const { hasPermission } = require('../auth/rbac');
const { executeTypedAction } = require('../mobile-ops/typed-actions');
const { getJobManager } = require('../mobile-ops/job-manager');
const { getCapability, isKnownCapability } = require('./capabilities');
const { getTaskStore, publicTask } = require('./task-store');

class ExecutionGateway {
  /**
   * @param {object} [deps]
   * @param {import('./task-store').TaskStore} [deps.store]
   * @param {Function} [deps.executeSync]
   * @param {() => import('../mobile-ops/job-manager').JobManager} [deps.jobs]
   */
  constructor(deps = {}) {
    this.store = deps.store || getTaskStore();
    this.executeSync = deps.executeSync || executeTypedAction;
    this.jobs = deps.jobs || getJobManager;
  }

  listCapabilities(role) {
    const { listCapabilities } = require('./capabilities');
    return listCapabilities(role);
  }

  getTask(id, role) {
    const task = this.store.get(id);
    if (!task) return { ok: false, error: 'not_found' };
    if (!hasPermission(role, 'status:view')) {
      return { ok: false, error: 'forbidden' };
    }
    this.syncJobTask(task);
    return { ok: true, task: publicTask(task), detail: this.taskDetail(task) };
  }

  listTasks(opts) {
    return { ok: true, tasks: this.store.list(opts) };
  }

  taskDetail(task) {
    return {
      steps: task.steps,
      errors: task.errors.map((e) => ({ at: e.at, code: e.code, message: e.message })),
      learnings: task.learnings,
      authorization: task.authorization,
    };
  }

  /** Poll job manager and advance task state when the linked job finishes. */
  syncJobTask(task) {
    if (!task.job_id || task.state === 'COMPLETED' || task.state === 'FAILED' || task.state === 'CANCELLED') return;
    const jm = this.jobs();
    const out = jm.get({ id: task.job_id, since: 0, role: task.role || 'operator', limit: 0 });
    if (!out.ok || !out.job) return;
    const js = out.job.state;
    task.checkpoint = { job_state: js, step_index: out.job.step_index, at: new Date().toISOString() };
    if (js === 'running') return;
    if (js === 'succeeded') {
      this.store.transition(task.id, 'VERIFYING', { reason: 'job_complete' });
      task.verification = { verified: true, evidence: { job_state: js, exit_code: out.job.exit_code } };
      this.store.transition(task.id, 'COMPLETED', { reason: 'verified' });
      task.outcome = { executed: true, ok: true, adapter: 'job' };
      this.recordLearning(task, true);
    } else if (js === 'cancelled') {
      this.store.transition(task.id, 'CANCELLED', { reason: 'job_cancelled' });
      task.outcome = { executed: false, ok: false, adapter: 'job' };
    } else {
      this.store.transition(task.id, 'FAILED', { reason: 'job_failed' });
      task.verification = { verified: true, evidence: { job_state: js, error: out.job.error } };
      task.outcome = { executed: true, ok: false, adapter: 'job' };
      this.recordLearning(task, false);
    }
  }

  recordLearning(task, success) {
    task.learnings.push({
      at: new Date().toISOString(),
      intended: task.objective || task.capability_id,
      verified_ok: success,
      hypothesis: success ? 'capability_completed' : 'capability_failed',
    });
  }

  /**
   * Submit a capability for execution through the lifecycle gate.
   */
  async submit({ capabilityId, args = {}, confirm = false, role, actor = null, objective = null, idempotencyKey = null, ctx = {} }) {
    if (!isKnownCapability(capabilityId)) {
      return { ok: false, error: 'unknown_capability', message: 'Capability is not registered.' };
    }
    const cap = getCapability(capabilityId);
    if (!hasPermission(role, cap.permission)) {
      return { ok: false, error: 'forbidden', message: 'Insufficient permission for this capability.' };
    }

    if (idempotencyKey) {
      const existing = this.store.findByIdempotency(idempotencyKey);
      if (existing) {
        this.syncJobTask(existing);
        return { ok: true, duplicate: true, task: publicTask(existing) };
      }
    }

    const task = this.store.createTask({
      capability_id: capabilityId,
      adapter: cap.adapter,
      role,
      actor,
      objective,
      idempotency_key: idempotencyKey,
      authorization: { permitted: true, permission: cap.permission, confirm_provided: confirm === true },
      recovery: { resume: `POST capability ${capabilityId} with same idempotency_key to poll; GET task by id` },
    });

    let tr = this.store.transition(task.id, 'PLANNING', { reason: 'validate' });
    if (!tr.ok) return { ok: false, error: tr.error, task: publicTask(task) };

    if (cap.confirmRequired && confirm !== true) {
      tr = this.store.transition(task.id, 'AWAITING_APPROVAL', { reason: 'confirm_required' });
      return {
        ok: true,
        awaiting_approval: true,
        task: publicTask(task),
        message: 'Set confirm: true to execute.',
      };
    }

    tr = this.store.transition(task.id, 'RUNNING', { reason: 'execute' });
    if (!tr.ok) return { ok: false, error: tr.error, task: publicTask(task) };

    if (cap.adapter === 'sync') {
      return this.runSync(task, capabilityId, args, confirm, role, ctx);
    }
    return this.runJob(task, cap, args, confirm, role);
  }

  async runSync(task, action, args, confirm, role, ctx) {
    try {
      const outcome = await this.executeSync({ action, args, confirm, role, ctx });
      task.checkpoint = { phase: 'sync_complete', at: new Date().toISOString() };
      this.store.transition(task.id, 'VERIFYING', { reason: 'sync_done' });
      const verified = outcome.ok === true;
      task.verification = {
        verified,
        evidence: {
          outcome_ok: outcome.ok,
          error: outcome.error || null,
        },
      };
      task.outcome = { executed: true, ok: verified, adapter: 'sync', result: outcome };
      if (verified) {
        this.store.transition(task.id, 'COMPLETED', { reason: 'verified' });
      } else {
        task.errors.push({ at: new Date().toISOString(), code: outcome.error || 'execution_failed', message: outcome.message || 'Sync action failed' });
        this.store.transition(task.id, 'FAILED', { reason: 'verification_failed' });
      }
      this.recordLearning(task, verified);
      return { ok: verified, task: publicTask(task), ...outcome };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      task.errors.push({ at: new Date().toISOString(), code: 'adapter_error', message });
      this.store.transition(task.id, 'FAILED', { reason: 'exception' });
      task.outcome = { executed: false, ok: false, adapter: 'sync' };
      this.recordLearning(task, false);
      return { ok: false, error: 'execution_error', message, task: publicTask(task) };
    }
  }

  runJob(task, cap, args, confirm, role) {
    const jm = this.jobs();
    const start = jm.start({ kind: cap.jobKind, args, confirm, role, actor: task.actor });
    if (!start.ok) {
      task.errors.push({ at: new Date().toISOString(), code: start.error, message: start.message || start.error });
      this.store.transition(task.id, 'FAILED', { reason: 'job_start_failed' });
      task.outcome = { executed: false, ok: false, adapter: 'job' };
      return { ok: false, ...start, task: publicTask(task) };
    }
    task.job_id = start.job.id;
    task.checkpoint = { job_id: task.job_id, at: new Date().toISOString() };
    return { ok: true, accepted: true, task: publicTask(task), job: start.job };
  }

  cancel(taskId, role) {
    const task = this.store.get(taskId);
    if (!task) return { ok: false, error: 'not_found' };
    if (!hasPermission(role, 'status:view')) {
      return { ok: false, error: 'forbidden' };
    }
    if (!task.job_id) {
      return { ok: false, error: 'not_cancellable', message: 'Only job-backed tasks can be cancelled.' };
    }
    const out = this.jobs().cancel({ id: task.job_id, role: task.role || role });
    if (out.ok) this.store.transition(taskId, 'CANCELLED', { reason: 'user_cancel' });
    this.syncJobTask(task);
    return { ok: out.ok, ...out, task: publicTask(task) };
  }
}

function getExecutionGateway() {
  if (!globalThis.__hydiExecutionGateway) globalThis.__hydiExecutionGateway = new ExecutionGateway();
  return globalThis.__hydiExecutionGateway;
}

module.exports = { ExecutionGateway, getExecutionGateway };
