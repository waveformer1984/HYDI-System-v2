'use strict';

const { canTransition, TERMINAL_STATES } = require('./constants');

const MAX_TASKS = 100;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

class TaskStore {
  /**
   * @param {object} [opts]
   * @param {() => number} [opts.now]
   * @param {typeof randomBytes} [opts.randomBytes]
   */
  constructor(opts = {}) {
    this.now = opts.now || Date.now;
    this.randomBytes = opts.randomBytes || require('crypto').randomBytes;
    /** @type {Map<string, object>} */
    this.tasks = new Map();
    /** @type {Map<string, { taskId: string, expires: number }>} */
    this.idempotency = new Map();
  }

  createId() {
    return this.randomBytes(12).toString('hex');
  }

  /**
   * @param {object} partial
   */
  createTask(partial) {
    this.pruneIdempotency();
    const id = this.createId();
    const task = {
      id,
      objective: partial.objective || null,
      capability_id: partial.capability_id,
      state: 'QUEUED',
      created_at: this.now(),
      updated_at: this.now(),
      actor: partial.actor || null,
      role: partial.role || null,
      environment: partial.environment || 'heidi-web',
      plan: partial.plan || { capability_id: partial.capability_id, adapter: partial.adapter },
      authorization: partial.authorization || null,
      steps: [],
      errors: [],
      checkpoint: null,
      job_id: null,
      idempotency_key: partial.idempotency_key || null,
      outcome: null,
      verification: null,
      learnings: [],
      recovery: partial.recovery || null,
    };
    this.tasks.set(id, task);
    this.pruneTasks();
    if (task.idempotency_key) {
      this.idempotency.set(task.idempotency_key, { taskId: id, expires: this.now() + IDEMPOTENCY_TTL_MS });
    }
    return task;
  }

  get(id) {
    return this.tasks.get(id) || null;
  }

  findByIdempotency(key) {
    if (!key) return null;
    this.pruneIdempotency();
    const hit = this.idempotency.get(key);
    if (!hit) return null;
    return this.tasks.get(hit.taskId) || null;
  }

  /**
   * @param {string} id
   * @param {string} toState
   * @param {object} [meta]
   */
  transition(id, toState, meta = {}) {
    const task = this.tasks.get(id);
    if (!task) return { ok: false, error: 'not_found' };
    if (!canTransition(task.state, toState)) {
      return { ok: false, error: 'invalid_transition', from: task.state, to: toState };
    }
    const from = task.state;
    task.state = toState;
    task.updated_at = this.now();
    task.steps.push({ from, to: toState, at: new Date(task.updated_at).toISOString(), ...meta });
    return { ok: true, task };
  }

  isTerminal(task) {
    return TERMINAL_STATES.has(task.state);
  }

  list({ limit = 20 } = {}) {
    const all = [...this.tasks.values()].sort((a, b) => b.updated_at - a.updated_at);
    return all.slice(0, limit).map(publicTask);
  }

  pruneTasks() {
    if (this.tasks.size <= MAX_TASKS) return;
    const finished = [...this.tasks.entries()]
      .filter(([, t]) => TERMINAL_STATES.has(t.state))
      .sort((a, b) => a[1].updated_at - b[1].updated_at);
    while (this.tasks.size > MAX_TASKS && finished.length) {
      const [id] = finished.shift();
      this.tasks.delete(id);
    }
  }

  pruneIdempotency() {
    const now = this.now();
    for (const [k, v] of this.idempotency.entries()) {
      if (v.expires <= now) this.idempotency.delete(k);
    }
  }
}

function publicTask(task) {
  return {
    id: task.id,
    capability_id: task.capability_id,
    state: task.state,
    objective: task.objective,
    created_at: task.created_at,
    updated_at: task.updated_at,
    job_id: task.job_id,
    outcome: task.outcome,
    verification: task.verification,
    checkpoint: task.checkpoint,
    terminal: TERMINAL_STATES.has(task.state),
  };
}

function getTaskStore() {
  if (!globalThis.__hydiExecutionTaskStore) globalThis.__hydiExecutionTaskStore = new TaskStore();
  return globalThis.__hydiExecutionTaskStore;
}

module.exports = { TaskStore, getTaskStore, publicTask };
