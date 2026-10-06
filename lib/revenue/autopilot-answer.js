'use strict';

/**
 * Deterministic chat surface for the revenue autopilot.
 *
 * "next best action" / "advance revenue" / "revenue autopilot" questions
 * are answered from durable mission state — never from an LLM. The call
 * itself advances the stage machine one pass (select → evaluate → offer
 * → gate → payable), which is safe because every stage is idempotent and
 * human boundaries park instead of blocking.
 */

const { advance, brief } = require('./revenue-autopilot');

const PATTERNS = [
  /next\s+best\s+action/i,
  /revenue\s+autopilot/i,
  /advance\s+(the\s+)?revenue/i,
  /revenue\s+mission/i,
  /next\s+revenue/i,
  /what.{0,20}revenue.{0,20}(mission|path|objective)/i,
  /how.{0,15}revenue\s+(mission|autopilot|objective)/i,
];

function looksLikeAutopilotQuestion(message) {
  return PATTERNS.some((p) => p.test(message || ''));
}

/**
 * Returns { text } for autopilot questions, else null.
 * opts.goals — GoalSystem (required for a real advance; without it we
 * answer nothing rather than fabricate state).
 */
async function tryAutopilotAnswer(message, opts = {}) {
  if (!looksLikeAutopilotQuestion(message)) return null;
  if (!opts.goals) return null;
  const { text } = await brief({
    goals: opts.goals,
    service: opts.service,
    opportunityStore: opts.opportunityStore,
    catalog: opts.catalog,
    envNamePresent: opts.envNamePresent,
    actor: opts.actor || 'heidi-chat',
  });
  return { text };
}

module.exports = { tryAutopilotAnswer, looksLikeAutopilotQuestion };
