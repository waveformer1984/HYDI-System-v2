'use strict';

const { DEFAULT_HEARTBEAT_STALE_MS } = require('./constants');

function normalizeResources(input = {}) {
  return {
    cpu_avail: Number(input.cpu_avail ?? input.cpu ?? 0),
    mem_avail_gb: Number(input.mem_avail_gb ?? input.ram ?? 0),
    disk_free_gb: Number(input.disk_free_gb ?? input.disk ?? 0),
    models: Array.isArray(input.models) ? input.models : [],
    capabilities: Array.isArray(input.capabilities) ? input.capabilities : [],
    network: input.network || 'unknown',
    workload: Number(input.workload ?? 0),
    trust: input.trust || 'home_trusted',
  };
}

function registerWorker(state, worker) {
  const row = {
    worker_id: worker.worker_id,
    trust: worker.trust || 'home_trusted',
    resources: normalizeResources(worker.resources),
    status: worker.status || 'idle',
    last_heartbeat: new Date().toISOString(),
    processed_count: 0,
    authorization_level: worker.authorization_level || 'standard',
  };
  const idx = state.workers.findIndex((w) => w.worker_id === row.worker_id);
  if (idx >= 0) state.workers[idx] = { ...state.workers[idx], ...row };
  else state.workers.push(row);
  return row;
}

function heartbeat(state, workerId, patch = {}) {
  const w = state.workers.find((x) => x.worker_id === workerId);
  if (!w) return { ok: false, error: 'not_registered' };
  w.last_heartbeat = new Date().toISOString();
  if (patch.status) w.status = patch.status;
  if (patch.resources) w.resources = normalizeResources({ ...w.resources, ...patch.resources });
  if (patch.workload !== undefined) w.resources.workload = patch.workload;
  return { ok: true, worker: w };
}

function listHealthyWorkers(state, now = Date.now(), staleMs = DEFAULT_HEARTBEAT_STALE_MS) {
  return state.workers.filter((w) => {
    const age = now - Date.parse(w.last_heartbeat);
    return age <= staleMs;
  });
}

function markProcessed(state, workerId, { error = false } = {}) {
  const w = state.workers.find((x) => x.worker_id === workerId);
  if (!w) return;
  if (error) w.error_count = (w.error_count || 0) + 1;
  else w.processed_count = (w.processed_count || 0) + 1;
}

module.exports = {
  normalizeResources,
  registerWorker,
  heartbeat,
  listHealthyWorkers,
  markProcessed,
};