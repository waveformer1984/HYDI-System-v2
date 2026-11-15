'use strict';

const { DistributedCloudStore } = require('./store');
const { checkQuota, recordTaskEnqueue } = require('./quota');
const { registerWorker, heartbeat, markProcessed, listHealthyWorkers } = require('./registry');
const { selectWorker } = require('./scheduler');
const { gateEnqueue, approveTask } = require('./approval');
const { TASK_STATES, DEFAULT_LEASE_MS } = require('./constants');
const { verifyWorkerToken } = require('./auth');
const { executeDiscoverTask } = require('./freelance-bridge');

class DistributedCloudControlPlane {
  constructor(opts = {}) {
    this.store = opts.store || new DistributedCloudStore(opts);
    this.now = opts.now || Date.now;
    this.leaseMs = opts.leaseMs || DEFAULT_LEASE_MS;
    this.executeDiscover = opts.executeDiscover || executeDiscoverTask;
  }

  status() {
    const state = this.store.load();
    return {
      ok: true,
      persistence: 'file',
      path: this.store.dir,
      tasks: state.tasks.length,
      workers: state.workers.length,
      healthy_workers: listHealthyWorkers(state, this.now()).length,
      updated_at: state.updated_at,
      budgets: state.budgets,
    };
  }

  enqueueTask(partial, { env = process.env } = {}) {
    return this.store.mutate((state) => {
      const quota = checkQuota(state, { costUsd: partial.cost_usd || 0, env, now: this.now() });
      if (!quota.ok) return { ok: false, error: quota.code, detail: quota.detail };

      if (partial.idempotency_key) {
        const existing = state.tasks.find((t) => t.idempotency_key === partial.idempotency_key && t.state !== TASK_STATES.CANCELLED);
        if (existing) return { ok: true, task: existing, deduped: true };
      }

      const base = {
        id: this.store.createId(),
        created_at: new Date(this.now()).toISOString(),
        updated_at: new Date(this.now()).toISOString(),
        attempt_count: 0,
        max_retries: partial.max_retries ?? 3,
        lease_holder: null,
        lease_expires_at: null,
        result: null,
        ...partial,
      };
      const task = gateEnqueue(base);
      state.tasks.push(task);
      recordTaskEnqueue(state, { costUsd: partial.cost_usd || 0, now: this.now() });
      state.history.push({ at: new Date(this.now()).toISOString(), event: 'task_enqueued', task_id: task.id, type: task.type });
      return { ok: true, task, deduped: false };
    });
  }

  registerWorkerAuth(token, body, env = process.env) {
    const v = verifyWorkerToken(token, env);
    if (!v.ok) return { ok: false, error: 'unauthorized', reason: v.reason };
    if (body.worker_id && body.worker_id !== v.workerId) return { ok: false, error: 'worker_mismatch' };
    return this.store.mutate((state) => {
      const row = registerWorker(state, { worker_id: v.workerId, ...body });
      return { ok: true, worker: row };
    });
  }

  workerHeartbeat(workerId, patch) {
    return this.store.mutate((state) => heartbeat(state, workerId, patch));
  }

  reclaimExpiredLeases() {
    return this.store.mutate((state) => {
      const now = this.now();
      let reclaimed = 0;
      for (const task of state.tasks) {
        if (task.lease_expires_at && Date.parse(task.lease_expires_at) <= now) {
          if (task.state === TASK_STATES.CLAIMED || task.state === TASK_STATES.RUNNING) {
            task.state = TASK_STATES.QUEUED;
            task.lease_holder = null;
            task.lease_expires_at = null;
            task.attempt_count += 1;
            reclaimed += 1;
          }
        }
      }
      return { reclaimed };
    });
  }

  claimNext(workerId, { capabilities = [] } = {}) {
    this.reclaimExpiredLeases();
    return this.store.mutate((state) => {
      const hb = heartbeat(state, workerId);
      if (!hb.ok) return { ok: false, error: 'worker_not_registered' };

      const candidates = state.tasks.filter(
        (t) => t.state === TASK_STATES.QUEUED && (!t.required_capability || capabilities.includes(t.required_capability)),
      );
      if (!candidates.length) return { ok: true, task: null };

      const pick = candidates.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0];
      const chosen = selectWorker(state, pick);
      if (chosen && chosen !== workerId) return { ok: true, task: null, routed_to: chosen };

      pick.state = TASK_STATES.CLAIMED;
      pick.lease_holder = workerId;
      pick.lease_expires_at = new Date(this.now() + this.leaseMs).toISOString();
      pick.updated_at = new Date(this.now()).toISOString();
      return { ok: true, task: publicTask(pick) };
    });
  }

  startTask(workerId, taskId) {
    return this.store.mutate((state) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) return { ok: false, error: 'not_found' };
      if (task.lease_holder !== workerId) return { ok: false, error: 'lease_mismatch' };
      task.state = TASK_STATES.RUNNING;
      task.updated_at = new Date(this.now()).toISOString();
      return { ok: true, task: publicTask(task) };
    });
  }

  completeTask(workerId, taskId, outcome, { idempotencyKey } = {}) {
    return this.store.mutate((state) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) return { ok: false, error: 'not_found' };

      if (task.completion_idempotency_key && idempotencyKey === task.completion_idempotency_key) {
        return { ok: true, task: publicTask(task), deduped: true };
      }
      if (task.lease_holder !== workerId) return { ok: false, error: 'lease_mismatch' };

      task.state = outcome?.ok ? TASK_STATES.COMPLETED : TASK_STATES.FAILED;
      task.result = outcome;
      task.completed_at = new Date(this.now()).toISOString();
      task.updated_at = task.completed_at;
      task.lease_holder = null;
      task.lease_expires_at = null;
      if (idempotencyKey) task.completion_idempotency_key = idempotencyKey;

      markProcessed(state, workerId, { error: !outcome?.ok });
      state.history.push({
        at: task.completed_at,
        event: outcome?.ok ? 'task_completed' : 'task_failed',
        task_id: task.id,
        worker_id: workerId,
      });
      return { ok: true, task: publicTask(task), deduped: false };
    });
  }

  async runClaimedDiscover(workerId, taskId, opts = {}) {
    const start = this.startTask(workerId, taskId);
    if (!start.ok) return start;
    try {
      const exec = await this.executeDiscover(opts);
      return this.completeTask(workerId, taskId, { ok: exec.ok, summary: exec.summary });
    } catch (error) {
      return this.completeTask(workerId, taskId, {
        ok: false,
        message: error instanceof Error ? error.message : 'error',
      });
    }
  }

  approveExternal(taskId, meta) {
    return this.store.mutate((state) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) return { ok: false, error: 'not_found' };
      const r = approveTask(task, meta);
      if (!r.ok) return r;
      state.history.push({ at: new Date().toISOString(), event: 'task_approved', task_id: taskId });
      return { ok: true, task: publicTask(task) };
    });
  }

  listTasks({ limit = 50 } = {}) {
    const state = this.store.load();
    return state.tasks.slice(-limit).map(publicTask);
  }
}

function publicTask(task) {
  return {
    id: task.id,
    type: task.type,
    state: task.state,
    objective: task.objective,
    created_at: task.created_at,
    updated_at: task.updated_at,
    lease_holder: task.lease_holder,
    lease_expires_at: task.lease_expires_at,
    requires_approval: Boolean(task.approval?.required),
    approved: Boolean(task.approval?.approved),
    result_summary: task.result ? { ok: task.result.ok } : null,
  };
}

module.exports = { DistributedCloudControlPlane, publicTask };