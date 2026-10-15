'use strict';

/** @typedef {'QUEUED'|'PLANNING'|'AWAITING_APPROVAL'|'RUNNING'|'VERIFYING'|'PAUSED'|'RECOVERING'|'COMPLETED'|'FAILED'|'CANCELLED'} TaskState */

/** @type {TaskState[]} */
const TASK_STATES = Object.freeze([
  'QUEUED',
  'PLANNING',
  'AWAITING_APPROVAL',
  'RUNNING',
  'VERIFYING',
  'PAUSED',
  'RECOVERING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

const TERMINAL_STATES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

/** @type {Record<TaskState, TaskState[]>} */
const ALLOWED_TRANSITIONS = Object.freeze({
  QUEUED: ['PLANNING', 'CANCELLED'],
  PLANNING: ['AWAITING_APPROVAL', 'RUNNING', 'FAILED', 'CANCELLED'],
  AWAITING_APPROVAL: ['RUNNING', 'CANCELLED', 'FAILED'],
  RUNNING: ['VERIFYING', 'PAUSED', 'RECOVERING', 'FAILED', 'CANCELLED'],
  VERIFYING: ['COMPLETED', 'FAILED'],
  PAUSED: ['RECOVERING', 'CANCELLED', 'FAILED'],
  RECOVERING: ['RUNNING', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
});

function canTransition(from, to) {
  if (from === to) return true;
  const allowed = ALLOWED_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

module.exports = { TASK_STATES, TERMINAL_STATES, ALLOWED_TRANSITIONS, canTransition };
