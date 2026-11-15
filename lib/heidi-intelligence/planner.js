'use strict';

/**
 * Lightweight reasoning/planning — produces a structured plan only (no execution).
 */

function buildPlan({ input, skillId, context }) {
  const steps = [];
  const goal = String(input || '').slice(0, 280);
  steps.push({ id: 'understand', action: 'Parse request and verify continuity', status: 'pending' });
  if (context?.sources?.memoryIds?.length) {
    steps.push({ id: 'memory_check', action: 'Cross-check durable memory vs user claim', status: 'pending' });
  } else {
    steps.push({ id: 'memory_check', action: 'Note missing durable memory; avoid inventing facts', status: 'pending' });
  }
  switch (skillId) {
    case 'coding':
      steps.push({ id: 'locate', action: 'Locate code and tests', status: 'pending' });
      steps.push({ id: 'verify', action: 'Run targeted tests before claiming done', status: 'pending' });
      break;
    case 'system_admin':
      steps.push({ id: 'evidence', action: 'Collect health evidence (not HTTP 200 alone)', status: 'pending' });
      break;
    case 'proposal_prep':
      steps.push({ id: 'draft', action: 'Draft proposal text', status: 'pending' });
      steps.push({ id: 'approval', action: 'Queue human approval before external submit', status: 'pending' });
      break;
    default:
      steps.push({ id: 'respond', action: 'Answer with cited evidence', status: 'pending' });
  }
  return {
    goal,
    skillId,
    steps,
    requiresHumanApproval: skillId === 'proposal_prep' || /\b(submit|pay|deploy|delete)\b/i.test(goal),
  };
}

module.exports = { buildPlan };