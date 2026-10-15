'use strict';

const { canTransition, TERMINAL_STATES, DEFAULT_IDEMPOTENCY_SCOPE, rowToTask, taskToRow } = require('./task-store-core');

class PostgresTaskStore {
  /**
   * @param {object} opts
   * @param {import('@supabase/supabase-js').SupabaseClient} opts.supabase
   * @param {() => number} [opts.now]
   * @param {() => string} [opts.createId]
   */
  constructor(opts) {
    if (!opts?.supabase) throw new Error('PostgresTaskStore requires supabase client');
    this.supabase = opts.supabase;
    this.now = opts.now || Date.now;
    this.createId = opts.createId || (() => require('crypto').randomBytes(12).toString('hex'));
    this.persistenceMode = 'postgres';
    this.table = 'execution_fabric_tasks';
  }

  async createTask(partial) {
    const scope = partial.idempotency_scope || DEFAULT_IDEMPOTENCY_SCOPE;
    if (partial.idempotency_key) {
      const existing = await this.findByIdempotency(partial.idempotency_key, scope);
      if (existing) return { task: existing, created: false };
    }
    const id = this.createId();
    const correlationId = partial.correlation_id || id;
    const now = this.now();
    const task = {
      id,
      correlation_id: correlationId,
      objective: partial.objective || null,
      objective_id: partial.objective_id || null,
      capability_id: partial.capability_id,
      state: 'QUEUED',
      created_at: now,
      updated_at: now,
      actor: partial.actor || null,
      role: partial.role || 'operator',
      environment: partial.environment || 'heidi-web',
      plan: partial.plan || { capability_id: partial.capability_id, adapter: partial.adapter },
      authorization: partial.authorization || {},
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
    const row = taskToRow(task);
    const { data, error } = await this.supabase.from(this.table).insert(row).select('*').single();
    if (error) {
      if (error.code === '23505' && partial.idempotency_key) {
        const hit = await this.findByIdempotency(partial.idempotency_key, scope);
        if (hit) return { task: hit, created: false };
      }
      throw new Error(error.message);
    }
    return { task: rowToTask(data), created: true };
  }

  async get(id) {
    const { data, error } = await this.supabase.from(this.table).select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return rowToTask(data);
  }

  async findByIdempotency(key, scope = DEFAULT_IDEMPOTENCY_SCOPE) {
    if (!key) return null;
    const { data, error } = await this.supabase
      .from(this.table)
      .select('*')
      .eq('idempotency_scope', scope)
      .eq('idempotency_key', key)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return rowToTask(data);
  }

  async transition(id, toState, meta = {}) {
    const task = await this.get(id);
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
    const expectedVersion = task.version - 1;
    const row = taskToRow(task);
    const { data, error } = await this.supabase
      .from(this.table)
      .update(row)
      .eq('id', id)
      .eq('version', expectedVersion)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { ok: false, error: 'version_conflict' };
    return { ok: true, task: rowToTask(data) };
  }

  async persist(task) {
    task.updated_at = this.now();
    task.version += 1;
    const expectedVersion = task.version - 1;
    const row = taskToRow(task);
    const { data, error } = await this.supabase
      .from(this.table)
      .update(row)
      .eq('id', task.id)
      .eq('version', expectedVersion)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { ok: false, error: 'version_conflict' };
    return rowToTask(data);
  }

  async claimLease(id, holder, ttlMs = 30_000) {
    const task = await this.get(id);
    if (!task) return { ok: false, error: 'not_found' };
    const now = this.now();
    if (task.lease_holder && task.lease_expires_at && Date.parse(task.lease_expires_at) > now) {
      if (task.lease_holder !== holder) return { ok: false, error: 'lease_held' };
    }
    task.lease_holder = holder;
    task.lease_expires_at = new Date(now + ttlMs).toISOString();
    task.updated_at = now;
    task.version += 1;
    const expectedVersion = task.version - 1;
    const row = taskToRow(task);
    const { data, error } = await this.supabase
      .from(this.table)
      .update({
        lease_holder: row.lease_holder,
        lease_expires_at: row.lease_expires_at,
        updated_at: row.updated_at,
        version: task.version,
      })
      .eq('id', id)
      .eq('version', expectedVersion)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { ok: false, error: 'version_conflict' };
    return { ok: true, task: rowToTask(data) };
  }

  async listStaleLeases(beforeIso) {
    const { data, error } = await this.supabase
      .from(this.table)
      .select('*')
      .in('state', ['RUNNING', 'RECOVERING'])
      .lte('lease_expires_at', beforeIso);
    if (error) throw new Error(error.message);
    return (data || []).map(rowToTask);
  }

  async list({ limit = 20 } = {}) {
    const { publicTask } = require('./task-store-core');
    const { data, error } = await this.supabase
      .from(this.table)
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data || []).map((r) => publicTask(rowToTask(r)));
  }

  async recordObservation(taskId, kind, payload) {
    const { error } = await this.supabase.from('execution_fabric_observations').insert({
      task_id: taskId,
      kind,
      payload: payload || {},
    });
    if (error) throw new Error(error.message);
  }
}

module.exports = { PostgresTaskStore };
