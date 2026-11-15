'use strict';

const { getSkillProfile } = require('./skills');

const CONSEQUENTIAL = new Set([
  'ops.recovery_execute',
  'billing.charge',
  'revenue.submit_proposal',
  'human_action.execute',
]);

/**
 * Tool selection policy — fail-closed; integrates with ProtoForge intent (no execution here).
 */
function evaluateToolProposal({ toolId, skillId, env = process.env }) {
  const profile = getSkillProfile(skillId);
  const allowlist = profile.toolsAllowlist;
  const reasons = [];

  if (!toolId || typeof toolId !== 'string') {
    return { decision: 'reject', reasons: ['missing_tool_id'] };
  }

  if (CONSEQUENTIAL.has(toolId)) {
    reasons.push('consequential_action');
    if (env.HEIDI_ALLOW_EXEC !== 'true') {
      return { decision: 'escalate', reasons: [...reasons, 'HEIDI_ALLOW_EXEC_not_true'] };
    }
    return { decision: 'escalate', reasons: [...reasons, 'human_approval_required'] };
  }

  if (allowlist && allowlist.length && !allowlist.includes(toolId)) {
    reasons.push('not_on_skill_allowlist');
    return { decision: 'reject', reasons };
  }

  if (profile.requiresApproval) {
    return { decision: 'escalate', reasons: ['skill_requires_approval'] };
  }

  return { decision: 'approve', reasons: ['skill_allowlist_or_non_consequential'] };
}

/**
 * Batch-evaluate hypotheses shaped like KILO output without calling Supabase in unit tests.
 */
function gateToolHypotheses(hypotheses, skillId, env = process.env) {
  const approved = [];
  const rejected = [];
  const escalated = [];
  for (const h of hypotheses || []) {
    const toolId = h.tool || h.action || h.id;
    const r = evaluateToolProposal({ toolId, skillId, env });
    const row = { hypothesis: h, ...r };
    if (r.decision === 'approve') approved.push(row);
    else if (r.decision === 'escalate') escalated.push(row);
    else rejected.push(row);
  }
  return { approved, rejected, escalated };
}

module.exports = { evaluateToolProposal, gateToolHypotheses, CONSEQUENTIAL };