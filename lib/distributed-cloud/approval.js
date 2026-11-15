'use strict';

const { TASK_STATES } = require('./constants');

const EXTERNAL_ACTIONS = new Set([
  'freelance.submit_proposal',
  'freelance.client_message',
  'freelance.accept_contract',
  'payment.charge',
]);

function requiresApproval(task) {
  if (task.requires_approval) return true;
  if (EXTERNAL_ACTIONS.has(task.action || task.type)) return true;
  return false;
}

function gateEnqueue(task) {
  if (requiresApproval(task)) {
    return {
      ...task,
      state: TASK_STATES.AWAITING_APPROVAL,
      approval: { required: true, approved: false },
    };
  }
  return { ...task, state: TASK_STATES.QUEUED, approval: { required: false } };
}

function approveTask(task, { approver = 'human:operator' } = {}) {
  if (!requiresApproval(task)) return { ok: false, error: 'approval_not_required' };
  task.approval = { required: true, approved: true, approver, at: new Date().toISOString() };
  task.state = TASK_STATES.QUEUED;
  return { ok: true, task };
}

module.exports = { EXTERNAL_ACTIONS, requiresApproval, gateEnqueue, approveTask };