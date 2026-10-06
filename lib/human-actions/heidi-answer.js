'use strict';

/**
 * Deterministic Heidi answers for Human Actions — the operator-facing
 * surface of "what do you need from me". Both chat routes share this so
 * the answers can never drift and never come from an LLM.
 *
 * Command semantics:
 *   ask   — "what do you need from me", "show my blockers", …  READ-ONLY
 *   done  — "I did it", "verify it", "check again" → re-run verifiers;
 *           pass → RESOLVED, fail → stays BLOCKED with what's missing
 *   "reject this" is deliberately NOT handled here — rejection is a
 *   governed mutation through the authenticated API, never a chat verb.
 */

const { HumanActionService, OPEN_STATUSES } = require('./service');
const { syncHumanActions } = require('./detector');
const { resumeSatisfiedGoals } = require('./mission-link');

const ASK_PATTERNS = [
  /\bwhat do you need (from me)?\b/i,
  /\bwhat (?:do i|should i|can i|must i) (?:do|provide|fix|supply)\b/i,
  /\b(?:show|list|what are|any)\s+(?:me\s+)?(?:my\s+)?(?:human\s+)?(?:actions?|tasks?|todos?|blockers?)\b/i,
  /\b(?:human|operator)\s+(?:actions?|tasks?)\b/i,
  /\bwhat(?:'s| is| am i)\s+(?:still\s+)?blocking\b/i,
  /\bwhat is blocking (?:\w+)\b/i,
  /\bwhat is waiting on me\b/i,
  /\bwhat'?s?\s+waiting\s+on\s+(?:me|a human)\b/i,
  /\b(?:my|any)\s+(?:to-?do|action items?)\b/i,
];

const DONE_PATTERNS = [
  /\bi (?:did|done|finished|completed|added|set|configured|funded)\b/i,
  /\b(?:credentials?|keys?|rpc|env)\b.*\b(?:set|added|done|configured)\b/i,
  /\b(?:it's|its|all) (?:done|set|configured|ready)\b/i,
  /\b(?:verify|check|re-?check|try) (?:it|again|now|them)\b/i,
  /\bverify it\b/i,
  /\bcheck again\b/i,
];

/** "what is blocking rezonate" → domain filter. */
function domainFilter(message) {
  const m = message.match(/\bblocking\s+(\w+)/i) || message.match(/\bblock(?:ed|ing)?\s+(?:on\s+)?(?:my\s+)?(\w+)\s*(?:mission|goal|work)?\s*$/i);
  return m ? m[1].toLowerCase() : null;
}

function looksLikeHumanActionQuestion(message) {
  return ASK_PATTERNS.some((p) => p.test(message)) || DONE_PATTERNS.some((p) => p.test(message));
}

function formatChecks(verification) {
  if (!verification) return '';
  if (verification.checks?.length) {
    return '\n  checks: ' + verification.checks.map((c) => `${c.passed ? '✓' : '✗'} ${c.name}${c.detail ? ` (${c.detail})` : ''}`).join(' · ');
  }
  return `\n  last check ${verification.checkedAt}: ${verification.passed ? 'PASSED' : 'FAILED — ' + (verification.safeSummary || 'not satisfied')}`;
}

function formatAction(a) {
  const steps = a.instructions.length
    ? '\n' + a.instructions.map((s, i) => `  ${i + 1}. ${s}`).join('\n')
    : '';
  const links = [];
  if (a.sourceMissionId) links.push(`mission: ${a.sourceMissionId}`);
  if (a.sourceGoalId) links.push(`goal: ${String(a.sourceGoalId).slice(0, 12)}`);
  return [
    `• [${a.status}] ${a.title} (id ${a.id}, priority ${a.priority})`,
    a.description ? `  why: ${a.description}` : null,
    links.length ? `  linked → ${links.join(' · ')}` : null,
    `  verifier: ${a.verifier.name}${a.verifier.name === 'manual' ? ' (human attestation only)' : ' — resolves only when the check passes'}`,
    steps,
    formatChecks(a.verification),
    a.lastError && a.status !== 'RESOLVED' ? `  still missing: ${a.lastError}` : null,
  ].filter((l) => l !== null && l !== '').join('\n');
}

function filterByDomain(actions, domain) {
  if (!domain) return actions;
  return actions.filter((a) =>
    (a.sourceMissionId || '').toLowerCase().includes(domain) ||
    (a.blockerKey || '').toLowerCase().includes(domain) ||
    (a.title || '').toLowerCase().includes(domain) ||
    (a.type || '').toLowerCase().includes(domain));
}

/**
 * Returns { text } for human-action questions, else null.
 * opts.service — injectable for tests; opts.goals — optional GoalSystem
 * for resume-after-verify (multi-blocker: resume only when all linked
 * actions resolve).
 */
async function tryHumanActionAnswer(message, opts = {}) {
  const svc = opts.service || new HumanActionService({ emit: opts.emit });
  const isDone = DONE_PATTERNS.some((p) => p.test(message));
  const isAsk = ASK_PATTERNS.some((p) => p.test(message));
  if (!isDone && !isAsk) return null;

  const sync = await syncHumanActions(svc, opts.goals || null);
  const domain = domainFilter(message);
  let open = svc.listOpen();
  if (domain) open = filterByDomain(open, domain);

  if (isDone) {
    if (!open.length) return { text: '✅ No open human actions — nothing was waiting on you.' };
    const lines = [];
    for (const a of open) {
      if (a.verifier.name === 'manual') continue;
      const res = await svc.verify(a.id, 'heidi-chat');
      const v = res.action.verification;
      lines.push(res.action.status === 'RESOLVED'
        ? `✅ ${a.title} — VERIFIED (${v.checkedAt})${v.checks?.length ? ' — ' + v.checks.length + '/' + v.checks.length + ' checks passed' : ''}`
        : `❌ ${a.title} — still failing: ${v?.safeSummary || 'check did not pass'}${v?.checks?.length ? '\n    ' + v.checks.map((c) => `${c.passed ? '✓' : '✗'} ${c.name}`).join(' · ') : ''}`);
    }
    // After verification, satisfied prerequisites release their goals.
    let resumed = [];
    if (opts.goals) {
      const r = await resumeSatisfiedGoals(svc, opts.goals, { actor: 'heidi-chat' }).catch(() => null);
      resumed = r?.resumed || [];
    }
    if (!lines.length) return { text: '✅ Noted — remaining open actions are manual-attestation only (no machine check exists).' };
    const resumeLine = resumed.length
      ? `\n\n▶ Resumed ${resumed.length} goal(s) — prerequisite satisfied, missions are runnable again (goal still has to execute).`
      : '';
    return { text: 'Verification re-run on open actions:\n' + lines.join('\n') + resumeLine };
  }

  if (!open.length) {
    const tail = domain ? ` for '${domain}'` : '';
    return { text: `✅ No open human actions${tail}. All known gates are satisfied (${sync.detection.checked} checked).` };
  }
  const multi = open.length > 1 ? ` — ${open.length} prerequisites, all must pass before linked work resumes` : '';
  const header = `🙋 ${open.length} open human action(s)${domain ? ` blocking '${domain}'` : ''}${multi}:\n`;
  return { text: header + open.map(formatAction).join('\n\n') };
}

module.exports = { tryHumanActionAnswer, looksLikeHumanActionQuestion };
