'use strict';

const { TERMINAL_STATES } = require('./constants');

/**
 * Read-only operational snapshot from the task store (no secrets).
 * @param {import('./task-store').TaskStoreLike} store
 */
async function buildOperationalSummary(store, opts = {}) {
  const limit = Number(opts.limit || 200);
  const listed = await store.list({ limit });
  const tasks = listed.tasks || listed || [];
  const now = Date.now();
  const byState = {};
  for (const t of tasks) {
    byState[t.state] = (byState[t.state] || 0) + 1;
  }
  const staleMs = Number(opts.staleHeartbeatMs || 60_000);
  const stale = tasks.filter((t) => {
    if (TERMINAL_STATES.has(t.state)) return false;
    const updated = typeof t.updated_at === 'number' ? t.updated_at : Date.parse(t.updated_at);
    return now - updated > staleMs;
  });
  const awaiting = tasks.filter((t) => t.state === 'AWAITING_APPROVAL' || t.state === 'NEEDS_HUMAN');
  const verifyFailed = tasks.filter((t) => t.verification?.verified === false);
  const blocked = tasks.filter((t) => t.state === 'BLOCKED');
  const lastSuccess = tasks
    .filter((t) => t.state === 'COMPLETED')
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))[0];

  return {
    scope: 'execution_fabric',
    persistence: store.persistenceMode || 'memory',
    counts_by_state: byState,
    queued: byState.QUEUED || 0,
    running: (byState.RUNNING || 0) + (byState.RECOVERING || 0),
    blocked: blocked.length,
    failed: byState.FAILED || 0,
    completed: byState.COMPLETED || 0,
    pending_human_approval: awaiting.length,
    verification_failures: verifyFailed.length,
    stale_heartbeats: stale.map((t) => ({ task_id: t.id, state: t.state, correlation_id: t.correlation_id || t.id })),
    last_completed_task_id: lastSuccess?.id || null,
    ts: new Date().toISOString(),
  };
}

module.exports = { buildOperationalSummary };
