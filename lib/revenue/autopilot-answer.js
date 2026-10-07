'use strict';

/**
 * Deterministic chat surface for the revenue autopilot / commercial loop.
 *
 * Two intents, deliberately separated:
 *   STATUS  — "what are we working on", "why this opportunity", "what's
 *             waiting for payment" → read-only `status()`. A question
 *             must never mutate commercial state.
 *   ADVANCE — "next best action" / "advance revenue" → `brief()`, which
 *             advances the stage machine one pass (safe: every stage is
 *             idempotent and human boundaries park instead of blocking).
 *
 * Both answer from durable mission state — never from an LLM.
 */

const { advance, brief, status } = require('./revenue-autopilot');

const PATTERNS = [
  /next\s+best\s+action/i,
  /revenue\s+autopilot/i,
  /advance\s+(the\s+)?revenue/i,
  /revenue\s+mission/i,
  /next\s+revenue/i,
  /what.{0,20}revenue.{0,20}(mission|path|objective)/i,
  /how.{0,15}revenue\s+(mission|autopilot|objective)/i,
];

// Read-only commercial status — durable state, no advance.
const STATUS_PATTERNS = [
  /\bwhat (?:are we|is (?:heidi|hydi|protoforge)) (?:working on|doing|building|selling)\b/i,
  /\b(?:commercial|revenue|sales|pipeline)\s+(?:status|report|state|update)\b/i,
  /\bwhy (?:this|that|the current)\s+opportunit/i,
  /\bwhy (?:are we|did you) (?:working on|choose|pick|select)\b/i,
  /\bwhat.{0,25}(?:waiting|pending).{0,20}(?:approv|payment)\b/i,
  /\bwhat (?:jobs?|work) (?:is|are) (?:executing|running|in flight)\b/i,
  /\bwhat (?:has|have we) (?:been )?delivered\b/i,
  /\bwhat (?:has|have we) (?:actually )?(?:been )?reconcil/i,
  /\bwhat'?s?\s+the\s+next\s+autonomous\b/i,
];

function looksLikeAutopilotQuestion(message) {
  const m = message || '';
  return PATTERNS.some((p) => p.test(m)) || STATUS_PATTERNS.some((p) => p.test(m));
}

function looksLikeStatusQuestion(message) {
  return STATUS_PATTERNS.some((p) => p.test(message || ''));
}

/**
 * Returns { text } for commercial questions, else null.
 * opts.goals — GoalSystem (required; without it we answer nothing rather
 * than fabricate commercial state). Status questions never call
 * advance(); advance questions still run one idempotent pass.
 */
async function tryAutopilotAnswer(message, opts = {}) {
  const m = message || '';
  const isStatus = looksLikeStatusQuestion(m);
  const isAdvance = PATTERNS.some((p) => p.test(m));
  if (!isStatus && !isAdvance) return null;
  if (!opts.goals) return null;

  const deps = {
    goals: opts.goals,
    service: opts.service,
    opportunityStore: opts.opportunityStore,
    catalog: opts.catalog,
    envNamePresent: opts.envNamePresent,
    jobManager: opts.jobManager,
    actor: opts.actor || 'heidi-chat',
  };

  if (isStatus && !isAdvance) {
    const { text } = await status(deps);
    return { text };
  }
  const { text } = await brief(deps);
  return { text };
}

module.exports = { tryAutopilotAnswer, looksLikeAutopilotQuestion, looksLikeStatusQuestion };
