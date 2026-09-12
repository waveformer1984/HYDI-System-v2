'use strict';
/**
 * The human-approval gate and the (deliberately unimplemented) execution
 * boundary for protoforge.daily_opportunity_scan.
 *
 * approveOpportunity / rejectOpportunity are the ONLY functions in this
 * codebase permitted to change an opportunity's approval_status away from
 * 'pending'. Nothing in the scouts, the analyzer, the store's insert path,
 * or the scheduler can do this -- grep this repo for
 * `approval_status.*approved` and this file is the only hit outside the
 * migration's default-value declaration.
 *
 * executeApprovedOpportunity exists on purpose, not by oversight: it is
 * the R2+ (external contact / spending / commitment) step, and v1 of this
 * mission does not implement R2+ at all. It throws NOT_IMPLEMENTED
 * unconditionally so that boundary is a loud, tested failure rather than
 * a silently-missing capability someone could accidentally wire up later
 * without noticing what they were authorizing.
 */

const { setApproval, getOpportunity } = require('./opportunity-store');

async function approveOpportunity(id, approvedBy, deps = {}) {
  return setApproval(id, 'approved', approvedBy, deps);
}

async function rejectOpportunity(id, approvedBy, deps = {}) {
  return setApproval(id, 'rejected', approvedBy, deps);
}

/**
 * R2+ execution. NOT IMPLEMENTED IN v1.
 *
 * Approving an opportunity means "a human judged this worth pursuing" --
 * it does not, and must not, cause anything external to happen on its
 * own. There is no autonomous financial transaction and no autonomous
 * external commitment in this mission. When a real execution step is
 * built (e.g. drafting an outreach message for a human to send, not
 * sending one), it belongs here, gated on `approval_status === 'approved'`,
 * and it must itself stop short of the actual external action unless a
 * separate, explicit policy decision says otherwise.
 */
async function executeApprovedOpportunity(id, deps = {}) {
  const opportunity = await getOpportunity(id, deps);
  if (!opportunity) throw new Error(`no opportunity with id ${id}`);
  if (opportunity.approval_status !== 'approved') {
    throw new Error(`opportunity ${id} is not approved (approval_status=${opportunity.approval_status})`);
  }
  const err = new Error(
    'NOT_IMPLEMENTED: protoforge.daily_opportunity_scan v1 has no execution step. ' +
    'Approval records intent; it does not cause external action. See lib/missions/approval.js.'
  );
  err.code = 'NOT_IMPLEMENTED';
  throw err;
}

module.exports = { approveOpportunity, rejectOpportunity, executeApprovedOpportunity };
