'use strict';

const { canTransition, TERMINAL_STATES, IDEMPOTENCY_TTL_MS, DEFAULT_IDEMPOTENCY_SCOPE, publicTask } = require('./task-store-core');

const MAX_TASKS = 500;

class MemoryTaskStore {
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
    this.persistenceMode = 'memory';
  }

  createId() {
    return this.randomBytes(12).toString('hex');
  }

  async createTask(partial) {
    this.pruneIdempotency();
    const scope = partial.idempotency_scope || DEFAULT_IDEMPOTENCY_SCOPE;
    if (partial.idempotency_key) {
      const existing = await this.findByIdempotency(partial.idempotency_key, scope);
      if (existing) return { task: existing, created: false };
    }
    const id = this.createId();
    const task = {
      id,
      objective: partial.objective || null,
      objective_id: partial.objective_id || null,
      capability_id: partial.capability_id,
      state: 'QUEUED',
      created_at: this.now(),
      updated_at: this.now(),
      actor: partial.actor || null,
      role: partial.role || null,
      environment: partial.environment || 'heidi-web',
      plan: partial.plan || { capability_id: partial.capability_id, adapter: partial.adapter },
      authorization: partial.authorization || null,
      input: partial.input || {},
      steps: [],
      errors: [],
      checkpoint: null,
      job_id: null,
      idempotency_key: partial.idempotency_key || null,
      idempotency_scope: scope,
      attempt_count: 0,
      lease_holder: null,
      lease_expires_at: null,
      outcome: null,
      verification: null,
      learnings: [],
      recovery: partial.recovery || null,
      failure_class: null,
      version: 0,
      started_at: null,
      completed_at: null,
      cancel_requested: false,
    };
    this.tasks.set(id, task);
    this.pruneTasks();
    if (task.idempotency_key) {
      this.idempotency.set(`${scope}:${task.idempotency_key}`, { taskId: id, expires: this.now() + IDEMPOTENCY_TTL_MS });
    }
    return { task, created: true };
  }

  async get(id) {
    return this.tasks.get(id) || null;
  }

  async findByIdempotency(key, scope = DEFAULT_IDEMPOTENCY_SCOPE) {
    if (!key) return null;
    this.pruneIdempotency();
    const hit = this.idempotency.get(`${scope}:${key}`);
    if (!hit) return null;
    return this.tasks.get(hit.taskId) || null;
  }

  async transition(id, toState, meta = {}) {
    const task = this.tasks.get(id);
    if (!task) return { ok: false, error: 'not_found' };
    if (!canTransition(task.state, toState)) {
      return { ok: false, error: 'invalid_transition', from: task.state, to: toState };
    }
    const from = task.state;
    task.state = toState;
    task.updated_at = this.now();
    task.version += 1;
    if (toState === 'RUNNING' && !task.started_at) {
      task.started_at = new Date(task.updated_at).toISOString();
    }
    if (TERMINAL_STATES.has(toState)) {
      task.completed_at = new Date(task.updated_at).toISOString();
      task.lease_holder = null;
      task.lease_expires_at = null;
    }
    task.steps.push({ from, to: toState, at: new Date(task.updated_at).toISOString(), ...meta });
    return { ok: true, task };
  }

  async persist(task) {
    task.updated_at = this.now();
    this.tasks.set(task.id, task);
    return task;
  }

  async claimLease(id, holder, ttlMs = 30_000) {
    const task = this.tasks.get(id);
    if (!task) return { ok: false, error: 'not_found' };
    const now = this.now();
    if (task.lease_holder && task.lease_expires_at && Date.parse(task.lease_expires_at) > now) {
      if (task.lease_holder !== holder) return { ok: false, error: 'lease_held' };
    }
    task.lease_holder = holder;
    task.lease_expires_at = new Date(now + ttlMs).toISOString();
    task.updated_at = now;
    task.version += 1;
    return { ok: true, task };
  }

  async listStaleLeases(beforeIso) {
    const out = [];
    for (const task of this.tasks.values()) {
      if (!task.lease_expires_at) continue;
      if (Date.parse(task.lease_expires_at) <= Date.parse(beforeIso)) {
        if (task.state === 'RUNNING' || task.state === 'RECOVERING') out.push(task);
      }
    }
    return out;
  }

  async list({ limit = 20 } = {}) {
    const all = [...this.tasks.values()].sort((a, b) => b.updated_at - a.updated_at);
    return all.slice(0, limit).map(publicTask);
  }

  isTerminal(task) {
    return TERMINAL_STATES.has(task.state);
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

  /** Simulate process restart — new store instance, same backing data export. */
  exportSnapshot() {
    return {
      tasks: [...this.tasks.entries()],
      idempotency: [...this.idempotency.entries()],
    };
  }

  static importSnapshot(snapshot, opts = {}) {
    const store = new MemoryTaskStore(opts);
    store.tasks = new Map(snapshot.tasks);
    store.idempotency = new Map(snapshot.idempotency);
    return store;
  }
}

module.exports = { MemoryTaskStore };
