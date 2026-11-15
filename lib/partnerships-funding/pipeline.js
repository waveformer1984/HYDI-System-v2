'use strict';

const { PIPELINE_STATES, TRANSITIONS } = require('./constants');

function canTransition(from, to) {
  const allowed = TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

function transition(opportunity, to, { actor = 'system', reason = '', evidence = null } = {}) {
  const from = opportunity.pipeline_state;
  if (!canTransition(from, to)) {
    return { ok: false, error: 'invalid_transition', from, to };
  }
  if (to === PIPELINE_STATES.SUBMITTED) {
    if (!evidence?.submission_reference) {
      return {
        ok: false,
        error: 'submission_evidence_required',
        message: 'submission_reference is required but is not proof — operator authorization is verified separately.',
      };
    }
    if (!evidence?.operator_action) {
      return {
        ok: false,
        error: 'operator_action_required',
        message: 'Submitted status requires evidence.operator_action from an authorized operator write.',
      };
    }
  }
  if (to === PIPELINE_STATES.AWARDED) {
    if (!evidence?.award_reference) {
      return {
        ok: false,
        error: 'award_evidence_required',
        message: 'award_reference is required but is not proof — operator authorization is verified separately.',
      };
    }
    if (!evidence?.operator_action) {
      return {
        ok: false,
        error: 'operator_action_required',
        message: 'Awarded status requires evidence.operator_action from an authorized operator write.',
      };
    }
  }
  opportunity.pipeline_state = to;
  opportunity.updated_at = new Date().toISOString();
  if (!opportunity.history) opportunity.history = [];
  opportunity.history.push({ at: opportunity.updated_at, from, to, actor, reason, evidence: evidence ? { type: evidence.type || 'note' } : null });
  return { ok: true, opportunity };
}

module.exports = { canTransition, transition, PIPELINE_STATES };