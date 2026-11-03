'use strict';
/**
 * Decision inbox — composes existing mission records and the fix-list into
 * the cards the owner actually decides on. Read-only: this route only
 * formats evidence already written by missions/lifecycle and frank-observer's
 * fix-list pass. It never approves, executes, or writes.
 *
 *   GET /decision-inbox   -> { generatedAt, cards[], counts }
 *   GET /brief            -> { generatedAt, completed, blocked, decisions, next }
 */
const fs = require('fs');
const path = require('path');

const RISK = {
  run_script: 'executes a script on Frank',
  restart_module: 'restarts a PM2 module',
  mission: 'opens a governed mission',
};

function riskFor(action) {
  if (!action || typeof action !== 'object') return 'unknown action';
  return RISK[action.type] || `action ${action.type}`;
}

function missionCard(m) {
  const action = m.context?.action || m.plan?.action || null;
  return {
    kind: 'mission',
    id: m.id,
    decision: m.goal,
    recommendation: action ? `approve the proposed ${action.type}` : 'review — no action proposed yet',
    evidence: m.context?.evidence || m.result || 'mission context',
    proposedAction: action ? `${action.type} ${action.target || ''} ${(action.args || []).join(' ')}`.trim() : null,
    risk: action ? riskFor(action) : 'none proposed',
    rollback: action && action.type === 'restart_module' ? 'restart back to the prior state via pm2' : 'reject or cancel the mission',
    state: m.status,
    updated: m.updated_at || m.created_at,
    stale: staleFor(m.updated_at || m.created_at),
  };
}

function fixCard(item) {
  return {
    kind: 'fix',
    id: item.id || item.subject,
    decision: `handle ${item.level} ${item.kind}: ${item.subject}`,
    recommendation: item.proposedFix?.command || item.proposedFix || 'investigate',
    evidence: item.detail || 'fix-list evidence',
    proposedAction: item.proposedFix?.command || null,
    risk: 'applying the proposed fix touches the named service',
    rollback: 'do nothing — the fix-list regenerates each pass',
    state: item.level,
    updated: null,
    stale: false,
  };
}

function staleFor(ts) {
  if (!ts) return true;
  const age = Date.now() - Date.parse(ts);
  return !(age >= 0) || age > 3600_000; // >1h or unparseable = stale
}

function readFixList(root) {
  const f = path.join(root, '.runtime', 'fixlist', 'current.json');
  if (!fs.existsSync(f)) return { items: [], state: 'not_produced' };
  try {
    const list = JSON.parse(fs.readFileSync(f, 'utf8'));
    return { items: Array.isArray(list.items) ? list.items : [], state: 'ok' };
  } catch { return { items: [], state: 'unavailable' }; }
}

function withTimeout(promise, ms, fallback) {
  let timer;
  const timeout = new Promise((r) => { timer = setTimeout(() => r(fallback), ms); if (timer.unref) timer.unref(); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function decisionInbox(memory, root, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const sources = { missions: 'ok', fixList: 'ok' };
  const awaiting = await withTimeout(
    memory.getMissions('awaiting_approval', 50).catch(() => null),
    timeoutMs,
    null,
  );
  if (awaiting === null) sources.missions = 'unavailable';
  const fix = readFixList(root);
  if (fix.state === 'unavailable') sources.fixList = 'unavailable';
  const fixItems = fix.items.filter((i) => i.level === 'CRIT');
  const fixSubjects = new Set(fixItems.map((i) => String(i.subject || i.id || '')));
  // Dedup: a mission already represented as a fix item is not a second decision.
  const missionCards = (awaiting || [])
    .filter((m) => !fixSubjects.has(String(m.id)) && !fixSubjects.has(String(m.goal || '')))
    .map(missionCard);
  const cards = [...missionCards, ...fixItems.slice(0, 5).map(fixCard)];
  return {
    generatedAt: new Date().toISOString(),
    sources,
    counts: { awaitingApproval: (awaiting || []).length, fixListCrit: fixItems.length },
    empty: cards.length === 0,
    unavailable: sources.missions !== 'ok' || sources.fixList !== 'ok',
    cards,
  };
}

async function brief(memory, root) {
  const [counts, recent] = await Promise.all([
    memory.countMissionsByStatus?.().catch(() => ({})) ?? {},
    memory.getMissions(null, 10).catch(() => []),
  ]);
  const inbox = await decisionInbox(memory, root);
  return {
    generatedAt: new Date().toISOString(),
    missionCounts: counts || {},
    recentActivity: (recent || []).slice(0, 5).map((m) => ({ id: m.id, goal: m.goal?.slice(0, 90), status: m.status, updated: m.updated_at })),
    pendingDecisions: inbox.counts.awaitingApproval + inbox.counts.fixListCrit,
    nextActions: inbox.cards.slice(0, 3).map((c) => c.decision),
  };
}

module.exports = { decisionInbox, brief, missionCard, fixCard, staleFor };
