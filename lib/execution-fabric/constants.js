'use strict';

/** @typedef {'QUEUED'|'PLANNING'|'AWAITING_APPROVAL'|'NEEDS_HUMAN'|'RUNNING'|'VERIFYING'|'PAUSED'|'RECOVERING'|'BLOCKED'|'COMPLETED'|'FAILED'|'CANCELLED'} TaskState */

/** @type {TaskState[]} */
const TASK_STATES = Object.freeze([
  'QUEUED',
  'PLANNING',
  'AWAITING_APPROVAL',
  'NEEDS_HUMAN',
  'RUNNING',
  'VERIFYING',
  'PAUSED',
  'RECOVERING',
  'BLOCKED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

/** Operator-facing aliases (documentation / mobile summaries). */
const PUBLIC_STATE_ALIASES = Object.freeze({
  QUEUED: 'queued',
  PLANNING: 'queued',
  AWAITING_APPROVAL: 'awaiting_approval',
  NEEDS_HUMAN: 'needs_human',
  RUNNING: 'running',
  VERIFYING: 'verifying',
  PAUSED: 'blocked',
  RECOVERING: 'running',
  BLOCKED: 'blocked',
  COMPLETED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

const TERMINAL_STATES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

/** @type {Record<TaskState, TaskState[]>} */
const ALLOWED_TRANSITIONS = Object.freeze({
  QUEUED: ['PLANNING', 'CANCELLED'],
  PLANNING: ['AWAITING_APPROVAL', 'NEEDS_HUMAN', 'RUNNING', 'BLOCKED', 'FAILED', 'CANCELLED'],
  AWAITING_APPROVAL: ['RUNNING', 'NEEDS_HUMAN', 'CANCELLED', 'FAILED'],
  NEEDS_HUMAN: ['RUNNING', 'CANCELLED', 'BLOCKED', 'FAILED'],
  RUNNING: ['VERIFYING', 'PAUSED', 'RECOVERING', 'BLOCKED', 'FAILED', 'CANCELLED'],
  VERIFYING: ['COMPLETED', 'FAILED'],
  PAUSED: ['RECOVERING', 'CANCELLED', 'FAILED', 'NEEDS_HUMAN'],
  RECOVERING: ['RUNNING', 'FAILED', 'CANCELLED', 'BLOCKED'],
  BLOCKED: ['RECOVERING', 'NEEDS_HUMAN', 'CANCELLED', 'FAILED'],
  COMPLETED: [],
  FAILED: ['RECOVERING'],
  CANCELLED: [],
});

function canTransition(from, to) {
  if (from === to) return true;
  const allowed = ALLOWED_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

function publicStateAlias(state) {
  return PUBLIC_STATE_ALIASES[state] || 'unknown';
}

module.exports = { TASK_STATES, TERMINAL_STATES, ALLOWED_TRANSITIONS, PUBLIC_STATE_ALIASES, publicStateAlias, canTransition };
