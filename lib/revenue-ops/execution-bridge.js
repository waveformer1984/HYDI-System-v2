'use strict';

const { MemoryTaskStore } = require('../execution-fabric/task-store-memory');
const { ExecutionGateway } = require('../execution-fabric/gateway');
const { transition } = require('./store');

/**
 * Creates an Execution Fabric task after contract acceptance (simulated in tests).
 */

function defaultExecuteSync() {
  return async () => ({ ok: true, probes: [{ ok: true, name: 'revenue-ops-deliverable' }] });
}

function createGateway(deps = {}) {
  const store = deps.store || new MemoryTaskStore({
    now: () => Date.now(),
    randomBytes: () => Buffer.alloc(12, 8),
  });
  return {
    gateway: new ExecutionGateway({
      store,
      skipRecovery: true,
      executeSync: deps.executeSync || defaultExecuteSync(),
      ...deps,
    }),
    store,
  };
}

async function startContractExecution(store, opportunityId, actor, opts = {}) {
  const opp = store.opportunities.find((o) => o.id === opportunityId);
  if (!opp) return { ok: false, error: 'not_found' };
  if (opp.state !== 'ACCEPTED') {
    return { ok: false, error: 'not_accepted', state: opp.state };
  }
  if (!opp.executionApproved) {
    return { ok: false, error: 'execution_not_approved' };
  }

  const { gateway } = createGateway(opts);
  const idempotencyKey = `revenue-ops:${opportunityId}:deliverable`;
  const submit = await gateway.submit({
    capabilityId: 'health.check',
    role: opts.role || 'operator',
    principal: actor,
    idempotencyKey,
    correlationId: opportunityId,
    context: {
      revenueOpportunityId: opportunityId,
      title: opp.title,
      simulated: true,
    },
  });

  transition(store, opportunityId, 'EXECUTING', { fabricTaskId: submit.task?.id, actor });
  opp.fabricTaskId = submit.task?.id;
  opp.deliverable = {
    summary: `Simulated deliverable for: ${opp.title}`,
    evidence: submit.task?.verification || { verified: submit.ok, simulated: true },
    completedAt: null,
  };

  if (submit.ok) {
    transition(store, opportunityId, 'VERIFYING', { fabricTaskId: submit.task.id });
    transition(store, opportunityId, 'DELIVERED', { verified: true });
    opp.deliverable.completedAt = new Date().toISOString();
    opp.financials = {
      grossUsd: opp.assessment?.economics?.grossRevenueUsd,
      netUsd: opp.assessment?.economics?.netRevenueUsd,
      paymentStatus: 'simulated_pending',
    };
    transition(store, opportunityId, 'PAID', { simulated: true });
    opp.financials.paymentStatus = 'simulated_paid';
  } else {
    transition(store, opportunityId, 'FAILED', { error: submit.error });
  }

  return { ok: submit.ok, task: submit.task, opportunity: opp, duplicate: submit.duplicate };
}

function approveExecution(store, id, actor) {
  const opp = store.opportunities.find((o) => o.id === id);
  if (!opp) throw Object.assign(new Error('not_found'), { code: 'NOT_FOUND' });
  if (opp.state !== 'ACCEPTED' && opp.state !== 'CLIENT_RESPONSE') {
    throw Object.assign(new Error('invalid_state'), { code: 'INVALID_STATE' });
  }
  if (opp.state === 'CLIENT_RESPONSE') transition(store, id, 'ACCEPTED', { actor });
  opp.executionApproved = { by: actor, at: new Date().toISOString() };
  return opp;
}

function simulateClientAccept(store, id, actor) {
  const opp = store.opportunities.find((o) => o.id === id);
  if (!opp) throw Object.assign(new Error('not_found'), { code: 'NOT_FOUND' });
  if (opp.state !== 'SUBMITTED') throw Object.assign(new Error('invalid_state'), { code: 'INVALID_STATE' });
  transition(store, id, 'CLIENT_RESPONSE', { actor });
  transition(store, id, 'ACCEPTED', { actor, simulated: true });
  return opp;
}

module.exports = {
  createGateway,
  startContractExecution,
  approveExecution,
  simulateClientAccept,
};