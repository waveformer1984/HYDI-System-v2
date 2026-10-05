/**
 * CooBriefing — the executive voice of the COO control plane.
 *
 * Turns the latest persisted `coo_state` snapshot into truthful answers
 * for operational questions. Pure functions — classification and
 * formatting are deterministic and unit-testable; the chat route only
 * supplies the persisted row.
 *
 * Contract:
 *  - answers come ONLY from the persisted coo_state row — never inferred,
 *    never LLM-fabricated
 *  - a stale snapshot is reported as stale, never presented as current
 *  - QUESTION intents only — this module carries no authorization surface
 */

import type { CooState } from './CooState';

/** Snapshot older than this is reported as stale (cadence is 30 min). */
export const COO_STALENESS_MS = 45 * 60 * 1000;

export type CooIntent =
  | 'status'       // "how's it going", "status", "report"
  | 'attention'    // "what needs my attention", "what do you need"
  | 'activity'     // "what are you doing", "what happened", "next"
  | 'failure'      // "what failed", "what broke"
  | 'protoforge'   // "what is protoforge finding"
  | 'revenue'      // "what is blocking revenue"
  | 'evidence'     // "show me the evidence"
  | 'why';         // "why did you choose that"

/**
 * Classify an operational question. Returns null when the message is not
 * an operational question at all — the caller falls through to the normal
 * chat path. Questions only; this classifier never authorizes action.
 */
export function classifyCooIntent(message: string): CooIntent | null {
  const m = message.toLowerCase().trim();

  if (/\b(why|reason|justify|explain)\b/.test(m) && /\b(action|choose|chose|decision|that|next)\b/.test(m)) return 'why';
  if (/\bevidence\b|\bproof\b|\bprove\b/.test(m)) return 'evidence';
  if (/\bprotoforge\b|\bscout\b|\bopportunit/.test(m)) return 'protoforge';
  if (/\brevenue\b|\bsales?\b|\bpayment|\bcustomer|\bsell\b|for sale|checkout.?ready|what can i (sell|offer)/.test(m)) return 'revenue';
  if (/\bfail|broke|broken|error|went wrong|incident/.test(m)) return 'failure';
  if (/\battention\b|\bneed(s)?\s+(my|from|me)\b|\bdo you need|\bapprove|approval|\bfor me\b/.test(m)) return 'attention';
  if (/\bwhat (are|did) you|\bdoing\b|\bworking on\b|\bnext\b|\bhappened|\bdid today|\bwatching\b/.test(m)) return 'activity';
  if (/how('| i)?s it going|how are (things|you)|status|report|brief|summary|operational/.test(m)) return 'status';

  return null;
}

function fmtNextAction(na: CooState['nextAction']): string {
  if (na.kind === 'capability') return `${na.capabilityId} — ${na.reason}`;
  if (na.kind === 'human') return `HUMAN ACTION REQUIRED — ${na.reason}`;
  return 'NO_ACTION_REQUIRED';
}

function workLine(s: CooState): string {
  const w = s.work;
  return `${w.goalsOpen} open / ${w.goalsInProgress} in progress / ${w.interventionsPending} interventions pending / ${w.escalationsOpen} escalations open (${w.escalationsNew24h} new 24h)`;
}

function protoLine(s: CooState): string {
  const p = s.protoforge;
  return `last run ${p.lastRunStatus ?? 'none'} ${p.lastRunAt ? `at ${p.lastRunAt}` : ''}; ${p.opportunitiesTotal} opportunities (${p.pendingReview} pending review, ${p.approved} approved)`;
}

function agentsLine(s: CooState): string {
  const a = s.agents;
  const missions = Object.entries(a.missionsByStatus)
    .map(([st, n]) => `${n} ${st.toLowerCase()}`)
    .join(', ') || 'none';
  return `${a.active} active · ${a.stale} stale · missions: ${missions}`;
}

function recentLine(s: CooState): string {
  if (s.agents.recent.length === 0) return 'no missions recorded';
  return s.agents.recent
    .slice(-3)
    .reverse()
    .map((m) => `[${m.status}] ${m.missionId.slice(0, 8)} ${m.role} — ${m.objective}`)
    .join('\n             ');
}

function revenueLine(s: CooState): string {
  const offers = s.revenue.offers;
  const stageSummary = offers && offers.total > 0
    ? Object.entries(offers.byStage).map(([st, n]) => `${n} ${st}`).join(', ')
    : 'no offers';
  const ready = offers?.ready && offers.ready.length > 0
    ? ` | ready: ${offers.ready.map((r) => `${r.offerId} ${r.product} $${(r.priceCents / 100).toFixed(2)} ${r.currency}`).join('; ')}`
    : '';
  const boundary = offers && offers.boundary.length > 0
    ? ` | boundary: ${offers.boundary.map((b) => `${b.offerId} ${b.stage} (${b.reason ?? 'unspecified'})`).join('; ')}`
    : '';
  const fixtures = offers && (offers.testOffers ?? 0) > 0
    ? ` · ${offers.testOffers} test fixture(s) excluded — not sellable inventory`
    : '';
  return `${s.revenue.opportunitiesOpen} open opportunities · offers: ${stageSummary}${ready}${boundary}${fixtures} (read-only — no reconciled-revenue claim)`;
}

/**
 * The standard executive briefing — §12 format. Every line is drawn from
 * the persisted snapshot; nothing is embellished.
 */
export function formatCooBrief(s: CooState, stale: boolean): string {
  const staleNote = stale
    ? `\n  ⚠ SNAPSHOT STALE — last verified ${s.generatedAt}; state may have changed since.`
    : '';
  return [
    'HEIDI COO BRIEF',
    '',
    `STATUS:      deployment ${s.deployment.verdict} · health ${s.applicationHealth}`,
    `DEPLOYMENT:  commit ${s.deployment.actualCommit ?? 'unknown'} · pm2 ${s.deployment.pm2Pid ?? '?'} → daemon ${s.deployment.daemonPid ?? '?'}`,
    `WORK:        ${workLine(s)}`,
    `AGENTS:      ${agentsLine(s)}`,
    `ATTENTION:   ${s.humanActions.open > 0
      ? `${s.humanActions.open} pending human action(s): ${s.humanActions.items.filter((i) => i.status === 'OPEN' && !i.backlog).slice(0, 3).map((i) => `[${i.source}] ${i.reason}`).join(' | ')}`
      : 'none pending'}`,
    `PROTOFORGE:  ${protoLine(s)}`,
    `REVENUE:     ${revenueLine(s)}`,
    `RECENT:      ${recentLine(s)}`,
    `NEXT ACTION: ${fmtNextAction(s.nextAction)}`,
    `LAST VERIFIED: ${s.generatedAt}${staleNote}`,
  ].join('\n');
}

/**
 * Answer an operational question from the persisted snapshot. Targeted
 * intents return focused answers; 'status' returns the full brief.
 */
export function answerFromCooState(s: CooState, intent: CooIntent, stale: boolean): string {
  const staleness = stale ? ` (snapshot from ${s.generatedAt} — stale)` : '';
  switch (intent) {
    case 'status':
      return formatCooBrief(s, stale);
    case 'attention': {
      const open = s.humanActions.items.filter((i) => i.status === 'OPEN' && !i.backlog);
      if (open.length > 0) {
        const list = open
          .slice(0, 5)
          .map((i) => `  [${i.source}/${i.category}] ${i.reason} → ${i.requestedAction}`)
          .join('\n');
        const proposalsOpen = open.filter((i) => i.source === 'action_proposal').length;
        const proposalNote = proposalsOpen > 0
          ? `\n  ${proposalsOpen} governed action proposal(s) — decide in the ACTIONS tab.`
          : '';
        const backlogNote = s.humanActions.backlogRowCount > 0
          ? `\n  (${s.humanActions.backlogRowCount} historical backlog rows remain human-owned — not listed individually)`
          : '';
        return `Needs your attention — ${open.length} pending human action(s):\n${list}${proposalNote}${backlogNote}${staleness}`;
      }
      return `Nothing needs your attention right now.${s.humanActions.backlogRowCount > 0 ? ` ${s.humanActions.backlogRowCount} historical backlog rows remain human-owned.` : ''}${staleness}`;
    }
    case 'activity':
      return `Next action: ${fmtNextAction(s.nextAction)}. Work: ${workLine(s)}. Agents: ${agentsLine(s)}. Recent: ${recentLine(s)}.${staleness}`;
    case 'failure':
      return s.deployment.failures.length > 0
        ? `Deployment identity failures: ${s.deployment.failures.join(', ')}.${staleness}`
        : `No current deployment failures. Deployment ${s.deployment.verdict}, health ${s.applicationHealth}.${staleness}`;
    case 'protoforge':
      return `ProtoForge: ${protoLine(s)}.${staleness} (Market intelligence — not validated demand, not revenue.)`;
    case 'revenue': {
      const readyCount = s.revenue.offers?.ready?.length ?? 0;
      const sellPath = readyCount > 0
        ? ' To sell one: supply the customer\'s email on the offer in the console (ACTIONS/attention item) — that creates a governed revenue.advance_offer proposal bound to the exact offer; approving it issues the checkout link and records it on the job. Nothing executes without that approval.'
        : '';
      return `Revenue (read-only): ${revenueLine(s)}. No reconciled revenue is claimed by this snapshot.${sellPath}${staleness}`;
    }
    case 'evidence':
      return `Evidence: latest coo_state snapshot generated ${s.generatedAt} — deployment ${s.deployment.verdict} (commit ${s.deployment.actualCommit}), identity ${s.deployment.identity}. Persisted in heidi_events; ask for 'status' for the full brief.${staleness}`;
    case 'why':
      return `Next action selected: ${fmtNextAction(s.nextAction)}. Selection is deterministic — deployment truth first, then pending human gates, then fresh incidents, then routine work.${staleness}`;
  }
}
