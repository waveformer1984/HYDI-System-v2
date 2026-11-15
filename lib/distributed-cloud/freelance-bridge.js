'use strict';

const { TASK_TYPES } = require('./constants');

/**
 * Schedules job-scout discovery on the control plane — no home PC required for queue durability.
 * Execution uses fixtures or runScout when a worker claims the task.
 */
function buildDiscoverTask({ idempotencyKey, createdBy = 'scheduler' } = {}) {
  return {
    type: TASK_TYPES.FREELANCE_DISCOVER,
    action: 'job_scout.scan',
    objective: 'Discover freelance opportunities (read-only boards)',
    requires_approval: false,
    input: { mode: 'read_only' },
    idempotency_key: idempotencyKey || `scout-${new Date().toISOString().slice(0, 10)}`,
    created_by: createdBy,
    cost_usd: 0,
  };
}

async function executeDiscoverTask({ fetchImpl, env } = {}) {
  const { runScout } = require('../job-scout/scout');
  const result = await runScout({ fetchImpl, env: env || process.env });
  return { ok: result.ok !== false, summary: result };
}

module.exports = { buildDiscoverTask, executeDiscoverTask };