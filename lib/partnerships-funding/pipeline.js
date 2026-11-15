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
  if (to === PIPELINE_STATES.SUBMITTED && !evidence?.submission_reference) {
    return {
      ok: false,
      error: 'submission_evidence_required',
      message: 'Cannot mark submitted without submission_reference evidence',
    };
  }
  if (to === PIPELINE_STATES.AWARDED && !evidence?.award_reference) {
    return {
      ok: false,
      error: 'award_evidence_required',
      message: 'Credits or benefits are not awarded until award_reference is recorded',
    };
  }
  opportunity.pipeline_state = to;
  opportunity.updated_at = new Date().toISOString();
  if (!opportunity.history) opportunity.history = [];
  opportunity.history.push({ at: opportunity.updated_at, from, to, actor, reason, evidence: evidence ? { type: evidence.type || 'note' } : null });
  return { ok: true, opportunity };
}

module.exports = { canTransition, transition, PIPELINE_STATES };