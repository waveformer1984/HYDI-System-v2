'use strict';

const { canTransition, TERMINAL_STATES } = require('./constants');

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_IDEMPOTENCY_SCOPE = 'mobile-ops';

function publicTask(task) {
  return {
    id: task.id,
    capability_id: task.capability_id,
    state: task.state,
    objective: task.objective,
    objective_id: task.objective_id || null,
    created_at: task.created_at,
    updated_at: task.updated_at,
    job_id: task.job_id,
    outcome: task.outcome,
    verification: task.verification,
    checkpoint: task.checkpoint,
    terminal: TERMINAL_STATES.has(task.state),
    phase: task.plan?.orchestration_phase || null,
  };
}

function normalizeTimestamps(task, nowFn) {
  const now = nowFn();
  if (typeof task.created_at === 'number') return task;
  return {
    ...task,
    created_at: task.created_at ? Date.parse(task.created_at) || now : now,
    updated_at: task.updated_at ? Date.parse(task.updated_at) || now : now,
  };
}

function rowToTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    objective: row.objective,
    objective_id: row.plan?.objective_id || null,
    capability_id: row.capability_id,
    state: row.state,
    actor: row.actor,
    role: row.role,
    environment: row.environment,
    plan: row.plan || {},
    authorization: row.authorization || {},
    input: row.input || {},
    steps: row.steps || [],
    errors: row.errors || [],
    checkpoint: row.checkpoint,
    job_id: row.job_id,
    idempotency_key: row.idempotency_key,
    idempotency_scope: row.idempotency_scope,
    attempt_count: row.attempt_count ?? 0,
    lease_holder: row.lease_holder,
    lease_expires_at: row.lease_expires_at,
    outcome: row.outcome,
    verification: row.verification,
    learnings: row.learnings || [],
    recovery: row.recovery,
    failure_class: row.failure_class,
    version: row.version ?? 0,
    started_at: row.started_at,
    completed_at: row.completed_at,
    created_at: Date.parse(row.created_at),
    updated_at: Date.parse(row.updated_at),
    cancel_requested: row.plan?.cancel_requested === true,
  };
}

function taskToRow(task) {
  return {
    id: task.id,
    objective: task.objective,
    capability_id: task.capability_id,
    state: task.state,
    actor: task.actor,
    role: task.role,
    environment: task.environment || 'heidi-web',
    plan: task.plan || {},
    authorization: task.authorization || {},
    input: task.input || {},
    checkpoint: task.checkpoint,
    job_id: task.job_id,
    idempotency_key: task.idempotency_key,
    idempotency_scope: task.idempotency_scope,
    attempt_count: task.attempt_count ?? 0,
    lease_holder: task.lease_holder ?? null,
    lease_expires_at: task.lease_expires_at ?? null,
    outcome: task.outcome,
    verification: task.verification,
    learnings: task.learnings || [],
    errors: task.errors || [],
    recovery: task.recovery,
    failure_class: task.failure_class ?? null,
    steps: task.steps || [],
    version: task.version ?? 0,
    started_at: task.started_at ?? null,
    completed_at: task.completed_at ?? null,
    created_at: new Date(task.created_at).toISOString(),
    updated_at: new Date(task.updated_at).toISOString(),
  };
}

module.exports = {
  canTransition,
  TERMINAL_STATES,
  IDEMPOTENCY_TTL_MS,
  DEFAULT_IDEMPOTENCY_SCOPE,
  publicTask,
  normalizeTimestamps,
  rowToTask,
  taskToRow,
};
