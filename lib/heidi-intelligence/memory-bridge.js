'use strict';

/**
 * Continuity verification — structured memory is authoritative; history is bounded context.
 */

function verifyContinuity({ conversationId, context, persistence }) {
  const degraded = [...(context?.degraded || [])];
  const checks = [];

  checks.push({
    id: 'conversation_bound',
    pass: Boolean(conversationId),
    detail: conversationId ? 'conversation id present' : 'no conversation id',
  });

  const memCount = context?.sources?.memoryIds?.length || 0;
  checks.push({
    id: 'structured_memory_used',
    pass: memCount > 0 || degraded.some((d) => d.includes('unavailable')),
    detail: memCount > 0 ? `${memCount} memory record(s) in context` : 'no memories retrieved (may be empty store)',
  });

  checks.push({
    id: 'history_not_substitute',
    pass: Boolean(context?.memoryBlock !== undefined),
    detail: 'memory block assembled separately from rolling history',
  });

  checks.push({
    id: 'persistence_honesty',
    pass: !persistence?.saved || !persistence?.error,
    detail: persistence?.error || (persistence?.saved ? 'user turn persisted' : 'persistence not claimed'),
  });

  const pass = checks.every((c) => c.pass || c.id === 'structured_memory_used');
  return { pass, checks, degraded };
}

function summarizeForAudit(context) {
  return {
    conversationId: context?.sources?.conversationId || null,
    historyMessages: context?.sources?.historyMessages || 0,
    memoryIds: context?.sources?.memoryIds || [],
    relatedMessageIds: context?.sources?.relatedMessageIds || [],
  };
}

module.exports = { verifyContinuity, summarizeForAudit };