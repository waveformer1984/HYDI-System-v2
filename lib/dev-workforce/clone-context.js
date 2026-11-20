'use strict';

const RECURSION_LOG = [];

function createCloneExecutionContext(meta = {}) {
  const ctx = Object.freeze({
    actor: meta.actor || 'clone:unknown',
    template_id: meta.templateId || null,
    role: 'agent',
    clone: true,
  });
  return ctx;
}

function guardCloneExecution(ctx, capabilityId) {
  if (!ctx || !ctx.clone) return { ok: true };
  if (ctx.pool || ctx.enqueueMission || ctx.registry || ctx.spawnClone) {
    const entry = {
      at: new Date().toISOString(),
      error: 'clone_recursion_context',
      capability_id: capabilityId,
    };
    RECURSION_LOG.push(entry);
    return { ok: false, error: 'clone_recursion_context' };
  }
  const forbidden = [
    'pool.mission_enqueue',
    'pool.spawn_clone',
    'pool.enqueue_mission',
  ];
  if (forbidden.includes(capabilityId)) {
    const entry = {
      at: new Date().toISOString(),
      error: 'clone_forbidden_capability',
      capability_id: capabilityId,
    };
    RECURSION_LOG.push(entry);
    return { ok: false, error: 'clone_forbidden_capability' };
  }
  return { ok: true };
}

function drainRecursionLog() {
  const copy = [...RECURSION_LOG];
  RECURSION_LOG.length = 0;
  return copy;
}

function assertCloneContextHasNoPoolRefs(ctx) {
  const keys = Object.keys(ctx || {});
  for (const k of keys) {
    if (k === 'pool' || k === 'enqueueMission' || k === 'spawnClone') {
      return { ok: false, ref: k };
    }
  }
  return { ok: true };
}

module.exports = {
  createCloneExecutionContext,
  guardCloneExecution,
  drainRecursionLog,
  assertCloneContextHasNoPoolRefs,
};