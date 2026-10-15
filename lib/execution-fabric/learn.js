'use strict';

/**
 * Structured LEARN observations — recommendations only; no self-modification.
 *
 * @param {object} task
 * @param {object} observation
 * @param {import('./task-store').TaskStoreLike} store
 */
async function recordObservation(task, observation, store) {
  const entry = {
    at: new Date().toISOString(),
    ...observation,
  };
  task.learnings.push(entry);
  if (store.persistenceMode === 'postgres' && typeof store.recordObservation === 'function') {
    await store.recordObservation(task.id, observation.kind || 'learn', entry);
  }
  await store.persist(task);
}

module.exports = { recordObservation };
