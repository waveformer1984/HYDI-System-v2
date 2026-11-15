'use strict';

const STATES = Object.freeze([
  'DISCOVERED',
  'VALIDATING',
  'SCORED',
  'QUALIFIED',
  'PROPOSAL_READY',
  'AWAITING_APPROVAL',
  'SUBMITTED',
  'CLIENT_RESPONSE',
  'ACCEPTED',
  'EXECUTING',
  'VERIFYING',
  'DELIVERED',
  'PAID',
  'REJECTED',
  'EXPIRED',
  'FAILED',
  'CANCELLED',
]);

const TERMINAL = new Set(['REJECTED', 'EXPIRED', 'FAILED', 'CANCELLED', 'PAID']);

const TRANSITIONS = {
  DISCOVERED: ['VALIDATING', 'REJECTED', 'EXPIRED'],
  VALIDATING: ['SCORED', 'REJECTED', 'EXPIRED'],
  SCORED: ['QUALIFIED', 'REJECTED'],
  QUALIFIED: ['PROPOSAL_READY', 'REJECTED'],
  PROPOSAL_READY: ['AWAITING_APPROVAL', 'REJECTED'],
  AWAITING_APPROVAL: ['SUBMITTED', 'REJECTED', 'CANCELLED', 'PROPOSAL_READY'],
  SUBMITTED: ['CLIENT_RESPONSE', 'REJECTED', 'FAILED'],
  CLIENT_RESPONSE: ['ACCEPTED', 'REJECTED', 'CANCELLED'],
  ACCEPTED: ['EXECUTING', 'CANCELLED'],
  EXECUTING: ['VERIFYING', 'FAILED', 'CANCELLED'],
  VERIFYING: ['DELIVERED', 'FAILED'],
  DELIVERED: ['PAID', 'FAILED'],
  PAID: [],
  REJECTED: [],
  EXPIRED: [],
  FAILED: [],
  CANCELLED: [],
};

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    const err = new Error(`invalid_transition:${from}->${to}`);
    err.code = 'INVALID_TRANSITION';
    throw err;
  }
}

module.exports = { STATES, TERMINAL, TRANSITIONS, canTransition, assertTransition };