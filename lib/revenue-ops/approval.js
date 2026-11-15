'use strict';

const { transition } = require('./store');

/**
 * Human approval bound to exact proposal version.
 */

function queueForApproval(store, id) {
  const opp = store.opportunities.find((o) => o.id === id);
  if (!opp) throw Object.assign(new Error('not_found'), { code: 'NOT_FOUND' });
  if (!opp.proposal) throw Object.assign(new Error('no_proposal'), { code: 'NO_PROPOSAL' });
  if (opp.state !== 'PROPOSAL_READY' && opp.state !== 'AWAITING_APPROVAL') {
    throw Object.assign(new Error('invalid_state'), { code: 'INVALID_STATE' });
  }
  return transition(store, id, 'AWAITING_APPROVAL', { action: 'queue_approval' });
}

function approveProposal(store, id, actor, proposalVersion) {
  const opp = store.opportunities.find((o) => o.id === id);
  if (!opp) throw Object.assign(new Error('not_found'), { code: 'NOT_FOUND' });
  if (opp.state !== 'AWAITING_APPROVAL') throw Object.assign(new Error('not_awaiting_approval'), { code: 'NOT_AWAITING' });
  if (!opp.proposal || opp.proposal.version !== proposalVersion) {
    throw Object.assign(new Error('proposal_version_mismatch'), { code: 'VERSION_MISMATCH' });
  }
  opp.approval = {
    approvedBy: actor,
    approvedAt: new Date().toISOString(),
    proposalVersion,
  };
  return opp;
}

function rejectOpportunity(store, id, actor, reason) {
  const opp = transition(store, id, 'REJECTED', { actor, reason: String(reason || '').slice(0, 300) });
  opp.rejectReason = reason || 'operator_rejected';
  return opp;
}

function canSubmitProposal(opp) {
  return Boolean(
    opp
    && opp.approval
    && opp.proposal
    && opp.approval.proposalVersion === opp.proposal.version
    && opp.state === 'AWAITING_APPROVAL'
  );
}

/**
 * Simulated submission — blocked without approval; records audit on denial.
 */
function submitProposal(store, id, actor, opts = {}) {
  const opp = store.opportunities.find((o) => o.id === id);
  if (!opp) return { ok: false, error: 'not_found' };
  if (!canSubmitProposal(opp)) {
    store.audit = store.audit || [];
    store.audit.push({
      action: 'submit_blocked',
      id,
      actor,
      reason: 'missing_or_stale_approval',
      at: new Date().toISOString(),
    });
    return { ok: false, error: 'unauthorized_submission', blocked: true };
  }
  if (opts.simulate !== true && process.env.REVENUE_OPS_ALLOW_SUBMIT !== 'true') {
    return { ok: false, error: 'live_submission_disabled', blocked: true };
  }
  transition(store, id, 'SUBMITTED', { actor, simulated: opts.simulate === true });
  opp.submittedAt = new Date().toISOString();
  opp.submittedBy = actor;
  opp.submissionSimulated = opts.simulate === true;
  return { ok: true, state: opp.state, simulated: opp.submissionSimulated };
}

module.exports = {
  queueForApproval,
  approveProposal,
  rejectOpportunity,
  canSubmitProposal,
  submitProposal,
};