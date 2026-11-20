'use strict';

const LEASE_STALE_MS = 30_000;

/**
 * Pool subtasks are recovered by heidi-pool (requeueStaleLeases), not heidi-web startup recovery.
 * @param {object | null | undefined} task
 */
function isPoolFabricTask(task) {
  const input = task && task.input;
  if (!input || typeof input !== 'object') return false;
  return input.pool_subtask === true || Boolean(input.pool_mission_id);
}

/**
 * Reconcile interrupted tasks after restart. Does not re-run non-idempotent adapters.
 *
 * @param {import('./task-store').TaskStoreLike} store
 * @param {object} [opts]
 * @param {() => number} [opts.now]
 */
async function recoverInterruptedTasks(store, opts = {}) {
  const now = typeof opts.now === 'function' ? opts.now() : (opts.now != null ? opts.now : Date.now());
  const beforeIso = new Date(now).toISOString();
  const stale = await store.listStaleLeases(beforeIso);
  /** @type {object[]} */
  const actions = [];
  for (const task of stale) {
    if (isPoolFabricTask(task)) continue;
    if (task.state === 'RUNNING' && task.job_id) {
      const tr = await store.transition(task.id, 'RECOVERING', { reason: 'stale_lease', recover: 'poll_job' });
      if (tr.ok) {
        task.recovery = {
          ...(task.recovery || {}),
          last_event: 'stale_lease',
          resume: 'GET task_id to poll job; do not resubmit without idempotency key',
          at: beforeIso,
        };
        await store.persist(task);
        actions.push({ task_id: task.id, action: 'recovering_poll_job' });
      }
    } else if (task.state === 'RUNNING' && !task.job_id) {
      const cap = require('./capabilities').getCapability(task.capability_id);
      if (cap && cap.idempotent) {
        const tr = await store.transition(task.id, 'RECOVERING', { reason: 'stale_lease_retry' });
        if (tr.ok) actions.push({ task_id: task.id, action: 'recovering_idempotent' });
      } else {
        await store.transition(task.id, 'FAILED', { reason: 'unsafe_replay_blocked' });
        task.failure_class = 'unsafe_replay';
        task.errors.push({
          at: beforeIso,
          code: 'unsafe_replay',
          message: 'Interrupted non-idempotent sync task; manual review required',
        });
        await store.persist(task);
        actions.push({ task_id: task.id, action: 'failed_unsafe_replay' });
      }
    }
  }
  return { recovered: actions.length, actions, ts: beforeIso };
}

module.exports = { recoverInterruptedTasks, LEASE_STALE_MS, isPoolFabricTask };
