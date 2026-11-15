'use strict';

const DistributedCompute = require('../../src/hydi-v3/DistributedCompute');
const { listHealthyWorkers } = require('./registry');
const { TASK_TYPES } = require('./constants');

function workerToNode(w) {
  const r = w.resources || {};
  return {
    id: w.worker_id,
    cpu: r.cpu_avail || 0,
    ram: r.mem_avail_gb || 0,
    disk: r.disk_free_gb || 0,
    capabilities: r.capabilities || [],
    latency: r.network === 'tailnet' ? 5 : r.network === 'lan' ? 2 : 20,
    workload: r.workload || 0,
    trust: w.trust,
  };
}

function capabilityForType(taskType) {
  switch (taskType) {
    case TASK_TYPES.FREELANCE_DISCOVER:
      return 'freelance.discover';
    case TASK_TYPES.MODEL_INFERENCE:
      return 'model.inference';
    case TASK_TYPES.CODE_TASK:
      return 'code.task';
    default:
      return 'lightweight';
  }
}

/**
 * Pick a worker using existing V3 DistributedCompute scoring (in-process, no new provider).
 */
function selectWorker(state, task, { now = Date.now() } = {}) {
  const healthy = listHealthyWorkers(state, now);
  if (!healthy.length) return null;

  const compute = new DistributedCompute({ heartbeatIntervalMs: 60_000, nodeTimeoutMs: 120_000 });
  for (const w of healthy) compute.registerNode(workerToNode(w));

  const filter = { capability: capabilityForType(task.type) };
  const nodeId = compute.schedule({ id: task.id, type: task.type }, filter);
  compute.destroy();
  if (!nodeId) {
    const fallback = healthy.find((w) => (w.resources?.capabilities || []).includes('lightweight')) || healthy[0];
    return fallback?.worker_id || null;
  }
  return nodeId;
}

module.exports = { selectWorker, workerToNode, capabilityForType };