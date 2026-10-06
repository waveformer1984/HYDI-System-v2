'use strict';

/**
 * Deterministic Heidi answers for Human Actions — the operator-facing
 * surface of "what do you need from me". Both chat routes share this so
 * the answers can never drift and never come from an LLM.
 */

const { HumanActionService } = require('./service');
const { detectKnownBlockers } = require('./detector');
const { runVerifier } = require('./verifiers');

const ASK_PATTERNS = [
  /\bwhat do you need (from me)?\b/i,
  /\bwhat (?:do i|should i|can i|must i) (?:do|provide|fix|supply)\b/i,
  /\b(?:pending|open|outstanding|my)\s+(?:human\s+)?(?:actions?|tasks?|todos?)\b/i,
  /\b(?:human|operator)\s+(?:actions?|tasks?)\b/i,
  /\bwhat(?:'s| is| am i)\s+blocking\b/i,
  /\b(?:blocked?|blockers?|what needs (?:me|a human))\b/i,
  /\b(?:my|any)\s+(?:to-?do|action items?)\b/i,
];

const DONE_PATTERNS = [
  /\bi (?:did|done|finished|completed|added|set|configured|funded)\b/i,
  /\b(?:credentials?|keys?|rpc|env)\b.*\b(?:set|added|done|configured)\b/i,
  /\b(?:it's|its|all) (?:done|set|configured|ready)\b/i,
];

function looksLikeHumanActionQuestion(message) {
  return ASK_PATTERNS.some((p) => p.test(message)) || DONE_PATTERNS.some((p) => p.test(message));
}

function formatAction(a) {
  const steps = a.instructions.length
    ? '\n' + a.instructions.map((s, i) => `  ${i + 1}. ${s}`).join('\n')
    : '';
  const check = a.verify_result
    ? `\n  last check ${a.verify_result.checked_at}: ${a.verify_result.ok ? 'PASSED' : 'FAILED — ' + (a.verify_result.reason || 'not satisfied')}`
    : '';
  return `• [${a.status}] ${a.title} (id ${a.id})${steps}${check}`;
}

/**
 * Returns { text } for human-action questions, else null.
 * opts.verifyFirst: when the human claims completion, run verifiers before
 * answering — never take the claim on faith.
 */
async function tryHumanActionAnswer(message, opts = {}) {
  const svc = opts.service || new HumanActionService({ emit: opts.emit });
  const isDone = DONE_PATTERNS.some((p) => p.test(message));
  const isAsk = ASK_PATTERNS.some((p) => p.test(message));
  if (!isDone && !isAsk) return null;

  const detected = detectKnownBlockers(svc);
  const open = svc.list().filter((a) => a.status === 'open' || a.status === 'claimed');

  if (isDone) {
    if (!open.length) return { text: '✅ No open human actions — nothing was waiting on you.' };
    const lines = [];
    for (const a of open) {
      if (a.verification.verifier === 'manual') continue;
      const res = await svc.verify(a.id);
      const r = res.action.verify_result;
      lines.push(res.action.status === 'resolved'
        ? `✅ ${a.title} — VERIFIED (${r.checked_at})`
        : `❌ ${a.title} — still failing: ${r.reason || 'check did not pass'}`);
    }
    if (!lines.length) return { text: '✅ Noted — remaining open actions are manual-attestation only.' };
    return { text: 'Verification re-run on open actions:\n' + lines.join('\n') };
  }

  if (!open.length) {
    return { text: '✅ No open human actions. All known gates are satisfied (' + detected.checked + ' checked).' };
  }
  return { text: `🙋 ${open.length} open human action(s):\n` + open.map(formatAction).join('\n\n') };
}

module.exports = { tryHumanActionAnswer, looksLikeHumanActionQuestion };
