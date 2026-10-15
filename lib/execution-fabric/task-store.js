'use strict';

const { MemoryTaskStore } = require('./task-store-memory');
const { PostgresTaskStore } = require('./task-store-postgres');
const { publicTask } = require('./task-store-core');

/** @typedef {MemoryTaskStore|PostgresTaskStore} TaskStoreLike */

function resolvePersistenceMode() {
  const mode = (process.env.EXECUTION_FABRIC_PERSIST || 'memory').toLowerCase();
  if (mode === 'postgres' || mode === 'supabase') return 'postgres';
  return 'memory';
}

function createTaskStore(opts = {}) {
  if (opts.store) return opts.store;
  if (opts.supabase) return new PostgresTaskStore({ supabase: opts.supabase, now: opts.now, createId: opts.createId });
  const mode = opts.mode || resolvePersistenceMode();
  if (mode === 'postgres') {
    const { getExecutionFabricSupabase } = require('./supabase-client');
    const supabase = getExecutionFabricSupabase();
    if (!supabase) {
      throw new Error('EXECUTION_FABRIC_PERSIST=postgres but Supabase is not configured');
    }
    return new PostgresTaskStore({ supabase, now: opts.now, createId: opts.createId });
  }
  return new MemoryTaskStore({ now: opts.now, randomBytes: opts.randomBytes });
}

function getTaskStore() {
  if (!globalThis.__hydiExecutionTaskStore) {
    globalThis.__hydiExecutionTaskStore = createTaskStore();
  }
  return globalThis.__hydiExecutionTaskStore;
}

function resetTaskStoreForTests() {
  delete globalThis.__hydiExecutionTaskStore;
}

/** Backward-compatible alias */
const TaskStore = MemoryTaskStore;

module.exports = {
  TaskStore,
  MemoryTaskStore,
  PostgresTaskStore,
  createTaskStore,
  getTaskStore,
  resetTaskStoreForTests,
  publicTask,
};
