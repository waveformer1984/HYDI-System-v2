'use strict';

const { hasPermission } = require('../auth/rbac');
const { executeTypedAction } = require('../mobile-ops/typed-actions');
const { getJobManager } = require('../mobile-ops/job-manager');
const { getCapability, isKnownCapability } = require('./capabilities');
const { getTaskStore, publicTask } = require('./task-store');
const { verifySyncCapability, verifyJobCapability } = require('./verification');
const { runContractChecks } = require('./verification-contracts');
const { recordObservation } = require('./learn');
const { listUnifiedCapabilities } = require('./registry-unified');
const { recoverInterruptedTasks } = require('./recovery');
const { ObjectiveOrchestrator } = require('./orchestrator');
const { LEASE_STALE_MS } = require('./recovery');
const { APPROVAL_TTL_MS, tenantAllows, idempotencyScopeFor, redactSensitive, approvalExpired } = require('./access');

class ExecutionGateway {
  /**
   * @param {object} [deps]
   * @param {import('./task-store').TaskStoreLike} [deps.store]
   * @param {Function} [deps.executeSync]
   * @param {() => import('../mobile-ops/job-manager').JobManager} [deps.jobs]
   * @param {boolean} [deps.skipRecovery]
   */
  constructor(deps = {}) {
    this.store = deps.store || getTaskStore();
    this.executeSync = deps.executeSync || executeTypedAction;
    this.jobs = deps.jobs || getJobManager;
    this.orchestrator = new ObjectiveOrchestrator(this);
    if (!deps.skipRecovery) {
      this.recoveryPromise = recoverInterruptedTasks(this.store).catch(() => ({ recovered: 0, actions: [] }));
    }
  }

  listCapabilities(role) {
    return listUnifiedCapabilities(role);
  }

  async getTask(id, role, principal = null) {
    const task = await this.store.get(id);
    if (!task) return { ok: false, error: 'not_found' };
    const access = tenantAllows(task, principal);
    if (!access.ok) return { ok: false, error: access.error };
    if (!hasPermission(role, 'status:view')) {
      return { ok: false, error: 'forbidden' };
    }
    await this.syncJobTask(task);
    return { ok: true, task: publicTask(task), detail: this.taskDetail(task) };
  }

  async listTasks(opts) {
    return { ok: true, tasks: await this.store.list(opts) };
  }

  taskDetail(task) {
    return {
      steps: task.steps,
      plan: task.plan,
      errors: (task.errors || []).map((e) => redactSensitive({ at: e.at, code: e.code, message: e.message })),
      learnings: task.learnings,
      authorization: task.authorization,
      recovery: task.recovery,
      attempt_count: task.attempt_count,
      persistence: this.store.persistenceMode || 'memory',
    };
  }

  /** Poll job manager and advance task state when the linked job finishes. */
  async syncJobTask(task) {
    if (!task.job_id || task.state === 'COMPLETED' || task.state === 'FAILED' || task.state === 'CANCELLED') return;
    const jm = this.jobs();
    const out = jm.get({ id: task.job_id, since: 0, role: task.role || 'operator', limit: 0 });
    if (!out.ok || !out.job) return;
    const js = out.job.state;
    task.checkpoint = { job_state: js, step_index: out.job.step_index, at: new Date().toISOString() };
    if (js === 'running') return;
    const verification = verifyJobCapability(out.job);
    task.verification = verification;
    if (js === 'succeeded' && verification.verified) {
      await this.store.transition(task.id, 'VERIFYING', { reason: 'job_complete' });
      await this.store.transition(task.id, 'COMPLETED', { reason: 'verified' });
      task.outcome = { executed: true, ok: true, adapter: 'job' };
      await this.recordLearning(task, true);
    } else if (js === 'cancelled') {
      await this.store.transition(task.id, 'CANCELLED', { reason: 'job_cancelled' });
      task.outcome = { executed: false, ok: false, adapter: 'job' };
    } else {
      await this.store.transition(task.id, 'FAILED', { reason: 'job_failed' });
      task.outcome = { executed: true, ok: false, adapter: 'job' };
      task.failure_class = verification.status === 'INCONCLUSIVE' ? 'inconclusive_evidence' : 'job_failed';
      await this.recordLearning(task, false);
    }
    await this.store.persist(task);
  }

  async recordLearning(task, success) {
    await recordObservation(
      task,
      {
        kind: success ? 'outcome_success' : 'outcome_failure',
        intended: task.objective || task.capability_id,
        verified_ok: success,
        hypothesis: success ? 'capability_completed' : 'capability_failed',
        recommendation: success ? null : 'Review runner logs before retry',
      },
      this.store,
    );
  }

  /**
   * Submit a capability for execution through the lifecycle gate.
   */
  async submit({ capabilityId, args = {}, confirm = false, role, actor = null, objective = null, idempotencyKey = null, correlationId = null, ctx = {}, parentTaskId = null, principal = null }) {
    if (!isKnownCapability(capabilityId)) {
      return { ok: false, error: 'unknown_capability', message: 'Capability is not registered.' };
    }
    const cap = getCapability(capabilityId);
    if (!hasPermission(role, cap.permission)) {
      return { ok: false, error: 'forbidden', message: 'Insufficient permission for this capability.' };
    }

    const bound = this.bindPrincipal(principal, role, actor);
    const scope = idempotencyScopeFor(bound);
    if (idempotencyKey) {
      const existing = await this.store.findByIdempotency(idempotencyKey, scope);
      if (existing) {
        const access = tenantAllows(existing, bound);
        if (!access.ok) return { ok: false, error: access.error };
        await this.syncJobTask(existing);
        return { ok: true, duplicate: true, task: publicTask(existing) };
      }
    }

    const safeArgs = args && typeof args === 'object' ? { ...args } : {};
    delete safeArgs.tenant_id;
    delete safeArgs.principal;
    delete safeArgs.role;

    const { task, created } = await this.store.createTask({
      capability_id: capabilityId,
      adapter: cap.adapter,
      role,
      actor: bound.subject,
      tenant_id: bound.tenant_id,
      created_by: bound.subject,
      objective,
      correlation_id: correlationId || null,
      idempotency_scope: scope,
      input: redactSensitive(safeArgs),
      idempotency_key: idempotencyKey,
      plan: { capability_id: capabilityId, adapter: cap.adapter, parent_task_id: parentTaskId },
      authorization: {
        permitted: true,
        permission: cap.permission,
        confirm_provided: confirm === true,
        auth_source: bound.auth_source,
        tenant_id: bound.tenant_id,
      },
      recovery: { resume: `GET task by id; same idempotency_key returns duplicate without re-execution` },
    });
    if (!created) {
      await this.syncJobTask(task);
      return { ok: true, duplicate: true, task: publicTask(task) };
    }

    let tr = await this.store.transition(task.id, 'PLANNING', { reason: 'validate' });
    if (!tr.ok) return { ok: false, error: tr.error, task: publicTask(task) };

    if (cap.confirmRequired && confirm !== true) {
      tr = await this.store.transition(task.id, 'AWAITING_APPROVAL', { reason: 'confirm_required' });
      if (!tr.ok) return { ok: false, error: tr.error, task: publicTask(task) };
      task.authorization = {
        ...(task.authorization || {}),
        expires_at: new Date(Date.now() + APPROVAL_TTL_MS).toISOString(),
        permission: cap.permission,
      };
      await this.store.persist(task);
      return {
        ok: true,
        awaiting_approval: true,
        task: publicTask(task),
        message: 'Set confirm: true to execute.',
      };
    }

    const holder = `gateway:${process.pid}`;
    const claim = await this.store.claimLease(task.id, holder, LEASE_STALE_MS);
    if (!claim.ok) return { ok: false, error: claim.error, task: publicTask(task) };

    tr = await this.store.transition(task.id, 'RUNNING', { reason: 'execute' });
    if (!tr.ok) return { ok: false, error: tr.error, task: publicTask(task) };
    task.attempt_count = (task.attempt_count || 0) + 1;

    if (cap.adapter === 'sync') {
      return this.runSync(task, capabilityId, safeArgs, confirm, role, ctx);
    }
    return this.runJob(task, cap, safeArgs, confirm, role);
  }

  bindPrincipal(principal, role, actor) {
    const src = principal && typeof principal === 'object' ? principal : {};
    return {
      subject: src.subject || actor || role || 'unknown',
      role: src.role || role || null,
      tenant_id: src.tenant_id || null,
      auth_source: src.auth_source || (src.tenant_id ? 'tenant_resolver' : 'rbac'),
    };
  }

  async approveTask(taskId, role, confirm = true, ctx = {}, principal = null) {
    const task = await this.store.get(taskId);
    if (!task) return { ok: false, error: 'not_found' };
    const bound = this.bindPrincipal(principal, role, null);
    const access = tenantAllows(task, bound);
    if (!access.ok) return { ok: false, error: access.error };
    if (task.state !== 'AWAITING_APPROVAL') return { ok: false, error: 'not_awaiting_approval' };
    if (approvalExpired(task, Date.now())) {
      await this.store.transition(taskId, 'NEEDS_HUMAN', { reason: 'approval_expired' });
      return { ok: false, error: 'approval_expired', task: publicTask(await this.store.get(taskId)) };
    }
    const cap = getCapability(task.capability_id);
    const required = task.authorization?.permission || cap?.permission || 'status:view';
    if (!hasPermission(role, required)) {
      await this.store.transition(taskId, 'NEEDS_HUMAN', { reason: 'permission_revoked' });
      return { ok: false, error: 'forbidden', task: publicTask(await this.store.get(taskId)) };
    }
    if (confirm !== true) return { ok: false, error: 'confirm_required' };

    if (task.objective_id) {
      return this.orchestrator.approveObjective(taskId, role, true, ctx);
    }

    if (!cap) return { ok: false, error: 'unknown_capability' };
    task.authorization = { ...task.authorization, confirm_provided: true };
    const holder = `gateway:${process.pid}`;
    await this.store.claimLease(task.id, holder, LEASE_STALE_MS);
    await this.store.transition(taskId, 'RUNNING', { reason: 'approved' });
    task.attempt_count = (task.attempt_count || 0) + 1;
    if (cap.adapter === 'sync') {
      return this.runSync(task, task.capability_id, task.input || {}, true, role, ctx);
    }
    return this.runJob(task, cap, task.input || {}, true, role);
  }

  async runSync(task, action, args, confirm, role, ctx) {
    try {
      const outcome = await this.executeSync({ action, args, confirm, role, ctx });
      task.checkpoint = { phase: 'sync_complete', at: new Date().toISOString() };
      await this.store.transition(task.id, 'VERIFYING', { reason: 'sync_done' });
      const { verification } = await runContractChecks(action, { ...outcome, result: outcome }, ctx);
      task.verification = verification;
      task.outcome = { executed: true, ok: verification.verified, adapter: 'sync', result: outcome };
      if (verification.verified) {
        await this.store.transition(task.id, 'COMPLETED', { reason: 'verified' });
      } else {
        task.errors.push({
          at: new Date().toISOString(),
          code: outcome.error || 'execution_failed',
          message: outcome.message || 'Sync action failed',
        });
        task.failure_class = verification.status;
        await this.store.transition(task.id, 'FAILED', { reason: 'verification_failed' });
      }
      await this.recordLearning(task, verification.verified);
      await this.store.persist(task);
      const { ok: _executorOk, ...rest } = outcome && typeof outcome === 'object' ? outcome : {};
      return { ...rest, ok: verification.verified, task: publicTask(task) };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      task.errors.push({ at: new Date().toISOString(), code: 'adapter_error', message });
      await this.store.transition(task.id, 'FAILED', { reason: 'exception' });
      task.outcome = { executed: false, ok: false, adapter: 'sync' };
      task.failure_class = 'adapter_error';
      await this.recordLearning(task, false);
      await this.store.persist(task);
      return { ok: false, error: 'execution_error', message, task: publicTask(task) };
    }
  }

  async runJob(task, cap, args, confirm, role) {
    const jm = this.jobs();
    const start = jm.start({ kind: cap.jobKind, args, confirm, role, actor: task.actor });
    if (!start.ok) {
      task.errors.push({ at: new Date().toISOString(), code: start.error, message: start.message || start.error });
      await this.store.transition(task.id, 'FAILED', { reason: 'job_start_failed' });
      task.outcome = { executed: false, ok: false, adapter: 'job' };
      await this.store.persist(task);
      return { ok: false, ...start, task: publicTask(task) };
    }
    task.job_id = start.job.id;
    task.checkpoint = { job_id: task.job_id, at: new Date().toISOString() };
    await this.store.persist(task);
    return { ok: true, accepted: true, task: publicTask(task), job: start.job };
  }

  async cancel(taskId, role, principal = null) {
    const task = await this.store.get(taskId);
    if (!task) return { ok: false, error: 'not_found' };
    const access = tenantAllows(task, this.bindPrincipal(principal, role, null));
    if (!access.ok) return { ok: false, error: access.error };
    if (!hasPermission(role, 'status:view')) {
      return { ok: false, error: 'forbidden' };
    }
    task.plan = { ...(task.plan || {}), cancel_requested: true };
    if (!task.job_id) {
      if (task.state === 'AWAITING_APPROVAL' || task.state === 'QUEUED' || task.state === 'PLANNING') {
        await this.store.transition(taskId, 'CANCELLED', { reason: 'user_cancel' });
        await this.store.persist(task);
        return { ok: true, external_rollback: false, task: publicTask(task) };
      }
      return { ok: false, error: 'not_cancellable', message: 'Only job-backed or pending tasks can be cancelled.' };
    }
    const out = this.jobs().cancel({ id: task.job_id, role: task.role || role });
    if (out.ok) await this.store.transition(taskId, 'CANCELLED', { reason: 'user_cancel' });
    await this.syncJobTask(task);
    return { ok: out.ok, ...out, task: publicTask(task) };
  }

  async retryTask(taskId, role, ctx = {}, principal = null) {
    const task = await this.store.get(taskId);
    if (!task) return { ok: false, error: 'not_found' };
    const bound = this.bindPrincipal(principal, role, null);
    const access = tenantAllows(task, bound);
    if (!access.ok) return { ok: false, error: access.error };
    if (task.state !== 'FAILED' && task.state !== 'BLOCKED') {
      return { ok: false, error: 'not_retryable', state: task.state };
    }
    if (task.objective_id) {
      return this.orchestrator.retryObjective(taskId, role, ctx);
    }
    const cap = getCapability(task.capability_id);
    if (!cap || cap.adapter !== 'sync') {
      return { ok: false, error: 'retry_sync_only' };
    }
    if (!hasPermission(role, cap.permission)) {
      return { ok: false, error: 'forbidden' };
    }
    const rec = await this.store.transition(taskId, 'RECOVERING', { reason: 'operator_retry' });
    if (!rec.ok) return { ok: false, error: rec.error, task: publicTask(task) };
    const claim = await this.store.claimLease(task.id, `gateway:${process.pid}`, LEASE_STALE_MS);
    if (!claim.ok) return { ok: false, error: claim.error, task: publicTask(task) };
    const run = await this.store.transition(taskId, 'RUNNING', { reason: 'retry_execute' });
    if (!run.ok) return { ok: false, error: run.error, task: publicTask(task) };
    task.attempt_count = (task.attempt_count || 0) + 1;
    return this.runSync(task, task.capability_id, task.input || {}, true, role, ctx);
  }

  async recoveryStatus() {
    const rec = await (this.recoveryPromise || Promise.resolve({ recovered: 0, actions: [] }));
    return {
      persistence: this.store.persistenceMode || 'memory',
      last_recovery: rec,
    };
  }
}

function getExecutionGateway() {
  if (!globalThis.__hydiExecutionGateway) globalThis.__hydiExecutionGateway = new ExecutionGateway();
  return globalThis.__hydiExecutionGateway;
}

module.exports = { ExecutionGateway, getExecutionGateway };
