'use strict';

/**
 * fix-list v1 — one ranked, read-only list of what is wrong on Frank.
 *
 * Pure module: buildFixList(inputs) -> items. No IO, no pm2, no exec, no
 * missions, no LLM. Every input is collected elsewhere (frank-observer
 * pass) and passed in as plain data, which is what makes this file
 * unit-testable on fixtures alone. It must never import the action
 * executor, the mission creator, or child_process — see
 * tests/unit/fix-list.test.js for the guard that fails on any of those.
 *
 * Items dedupe across passes by id = sha1(kind + ':' + subject)[0:12].
 * firstSeen/passes are carried forward from the previous current.json,
 * so "how long has this been wrong" survives restarts.
 */

const crypto = require('crypto');

const LEVEL_RANK = { CRIT: 0, WARN: 1, UNKNOWN: 2, INFO: 3 };
const BACKLOG_STALE_SEC = 30 * 60;

/**
 * Known fix templates. Anything without a template gets type 'human'
 * and no command — a template exists only where the action is bounded,
 * reversible, and already in operator use.
 */
const FIX_TEMPLATES = {
  drift_stale_code: (r) => ({ type: 'pm2_restart', command: `pm2 restart ${r.subject}`, risk: 'R1', wouldNeedApproval: false }),
  drift_not_online: (r) => ({ type: 'pm2_restart', command: `pm2 restart ${r.subject}`, risk: 'R1', wouldNeedApproval: false }),
  drift_missing: (r) => ({ type: 'pm2_start', command: `pm2 start ecosystem.config.js --only ${r.subject}`, risk: 'R1', wouldNeedApproval: false }),
  drift_config_drift: (r) => ({ type: 'pm2_recreate', command: `pm2 delete ${r.subject} && pm2 start ecosystem.config.js --only ${r.subject}`, risk: 'R2', wouldNeedApproval: true }),
  stray_pid: (r) => ({ type: 'stop_process', command: `Stop-Process -Id ${r.evidence[0]?.pid}  # after confirming its parent is not a live PM2 child`, risk: 'R2', wouldNeedApproval: true }),
  daemon_pid_mismatch: () => ({ type: 'daemon_reconcile', command: 'pm2 delete hydi-daemon; Stop-Process the lock-owner pid; pm2 start ecosystem.config.js --only hydi-daemon', risk: 'R3', wouldNeedApproval: true }),
  mission_backlog: () => ({ type: 'human', action: 'Review awaiting_approval / blocked tasks — only a person approves', risk: 'R0', wouldNeedApproval: true }),
  action_refused_spike: () => ({ type: 'human', action: 'Review refused actions by verdict — a gate is working as intended or a caller is probing', risk: 'R0', wouldNeedApproval: false }),
};
const HUMAN_ONLY = () => ({ type: 'human', risk: 'R0', wouldNeedApproval: true });

function itemId(kind, subject) {
  return crypto.createHash('sha1').update(`${kind}:${subject}`).digest('hex').slice(0, 12);
}

function makeItem({ kind, subject, level, evidence, fix, blastRadius = 1, detail }) {
  const subject_ = String(subject);
  return {
    id: itemId(kind, subject_),
    kind,
    subject: subject_,
    level,
    detail: detail ?? null,
    evidence: Array.isArray(evidence) ? evidence : [evidence],
    proposedFix: fix || HUMAN_ONLY(),
    blastRadius,
  };
}

function carry(previous, items, now) {
  const prev = new Map(((previous && previous.items) || []).map((i) => [i.id, i]));
  return items.map((i) => {
    const p = prev.get(i.id);
    return { ...i, firstSeen: p ? p.firstSeen : now, lastSeen: now, passes: p ? (p.passes || 0) + 1 : 1 };
  });
}

function rank(items) {
  return [...items].sort((a, b) =>
    (LEVEL_RANK[a.level] ?? 9) - (LEVEL_RANK[b.level] ?? 9)
    || (b.passes || 0) - (a.passes || 0)
    || (b.blastRadius || 1) - (a.blastRadius || 1));
}

function driftItems(drift) {
  if (!drift || drift.error) {
    return [makeItem({
      kind: 'pm2_unreadable', subject: 'pm2 jlist', level: 'UNKNOWN',
      evidence: [{ reason: drift && drift.error ? String(drift.error) : 'drift audit returned no audit' }],
      detail: 'PM2 process list could not be read — nothing else in this list can be trusted to be complete',
    })];
  }
  const rows = (drift.details && drift.details.rows) || drift.rows || [];
  const out = [];
  for (const r of rows) {
    const verdict = r.verdict;
    if (verdict === 'OK') continue;
    const tpl = FIX_TEMPLATES[`drift_${String(verdict).toLowerCase()}`];
    out.push(makeItem({
      kind: 'drift', subject: r.name, level: verdict === 'NOT_ONLINE' || verdict === 'UNDECLARED' ? 'CRIT' : verdict === 'UNKNOWN_CODE' ? 'UNKNOWN' : 'WARN',
      detail: verdict, evidence: [{ name: r.name, verdict, verdicts: r.verdicts, suggestion: r.suggestion }],
      fix: tpl ? tpl({ subject: r.name }) : undefined,
    }));
  }
  return out;
}

function strayItems(snapshot) {
  const issues = (snapshot && snapshot.issues) || [];
  return issues.filter((i) => i.source === 'strays').map((i) => {
    const pid = Number((i.text.match(/\bpid\s+(\d+)/i) || [])[1]) || null;
    return makeItem({
      kind: 'stray_pid', subject: `pid:${pid ?? i.id}`, level: 'CRIT',
      detail: i.text, evidence: [{ pid, text: i.text }],
      fix: pid ? FIX_TEMPLATES.stray_pid({ evidence: [{ pid }] }) : undefined,
    });
  });
}

function snapshotItems(snapshot) {
  const issues = (snapshot && snapshot.issues) || [];
  return issues.filter((i) => i.source !== 'strays').map((i) => makeItem({
    kind: i.source, subject: i.id, level: i.severity === 'crit' ? 'CRIT' : i.severity === 'warn' ? 'WARN' : 'INFO',
    detail: i.text, evidence: [{ source: i.source, id: i.id, text: i.text }],
  }));
}

function daemonItems(daemonStatus, pm2DaemonPid) {
  const items = [];
  const d = daemonStatus;
  if (!d) {
    items.push(makeItem({ kind: 'daemon_status', subject: 'missing', level: 'WARN', detail: '.heidi-daemon-status.json absent', evidence: [] }));
    return items;
  }
  const livePid = Number(d.pid) || null;
  if (livePid && pm2DaemonPid && livePid !== Number(pm2DaemonPid)) {
    items.push(makeItem({
      kind: 'daemon_pid_mismatch', subject: `status:${livePid}/pm2:${pm2DaemonPid}`, level: 'CRIT',
      detail: `daemon status file pid ${livePid} is not PM2's tracked pid ${pm2DaemonPid} — two daemon copies or a lost fork`,
      evidence: [{ statusPid: livePid, pm2Pid: pm2DaemonPid, provenanceSha: d.provenance && d.provenance.gitSha }],
      fix: FIX_TEMPLATES.daemon_pid_mismatch(),
    }));
  }
  if ((d.consecutiveFailures || 0) > 0) {
    items.push(makeItem({
      kind: 'daemon_failing', subject: `failures:${d.consecutiveFailures}`, level: 'WARN',
      detail: `${d.consecutiveFailures} consecutive failures — last error: ${d.lastError}`, evidence: [{ lastError: d.lastError, lastErrorAt: d.lastErrorAt }],
    }));
  }
  if (d.persistence && (d.persistence.pg !== 'ok' || d.persistence.rest !== 'ok')) {
    items.push(makeItem({
      kind: 'daemon_persistence', subject: `pg:${d.persistence.pg}/rest:${d.persistence.rest}`, level: 'WARN',
      detail: 'daemon persistence probe degraded', evidence: [{ persistence: d.persistence }],
    }));
  }
  return items;
}

function refusedItems(actionRefused) {
  if (!actionRefused || actionRefused.unreachable) {
    return [makeItem({
      kind: 'db_unreachable', subject: 'heidi_events', level: 'UNKNOWN',
      detail: 'action_refused evidence is unverifiable — the DB is unreachable, not empty',
      evidence: [{ error: actionRefused && actionRefused.error ? String(actionRefused.error) : 'no pool or query failed' }],
    })];
  }
  const rows = actionRefused.rows || [];
  if (!rows.length) return [];
  const total = rows.reduce((s, r) => s + Number(r.count || r.n || 0), 0);
  return [makeItem({
    kind: 'action_refused_spike', subject: 'heidi_events.action_refused', level: total >= 10 ? 'WARN' : 'INFO',
    detail: `${total} refused action(s) in the last 24h: ${rows.map((r) => `${r.verdict}=${r.count || r.n}`).join(', ')}`,
    evidence: rows,
    fix: FIX_TEMPLATES.action_refused_spike(),
  })];
}

function backlogItems(backlog) {
  if (!backlog) return [];
  const awaiting = backlog.awaitingApproval || 0;
  const blocked = backlog.blocked || 0;
  const oldestSec = backlog.oldestSec || 0;
  if (!awaiting && !blocked) return [];
  const stale = oldestSec > BACKLOG_STALE_SEC;
  return [makeItem({
    kind: 'mission_backlog', subject: `awaiting:${awaiting}/blocked:${blocked}`, level: stale ? 'WARN' : 'INFO',
    detail: `${awaiting} awaiting_approval, ${blocked} blocked; oldest ${Math.round(oldestSec / 60)}min`,
    evidence: [{ awaitingApproval: awaiting, blocked, oldestSec }],
    fix: FIX_TEMPLATES.mission_backlog(),
    blastRadius: awaiting + blocked,
  })];
}

/**
 * @param {object} inputs
 *   snapshot: buildFrankSnapshot() output or null
 *   drift:    runtimeHealthCheck() result {details:{rows}} or {error}
 *   daemonStatus: .heidi-daemon-status.json parsed or null
 *   pm2DaemonPid: PM2's tracked pid for hydi-daemon, if known
 *   actionRefused: {rows:[{verdict,count}]} or {unreachable:true}
 *   backlog:  {awaitingApproval, blocked, oldestSec} or null
 *   previous: previous current.json content (for dedupe/persistence)
 *   now:      epoch ms
 */
function buildFixList(inputs = {}) {
  const now = inputs.now || Date.now();
  const items = [
    ...driftItems(inputs.drift),
    ...strayItems(inputs.snapshot),
    ...snapshotItems(inputs.snapshot),
    ...daemonItems(inputs.daemonStatus, inputs.pm2DaemonPid),
    ...refusedItems(inputs.actionRefused),
    ...backlogItems(inputs.backlog),
  ];
  const deduped = carry(inputs.previous, items, now);
  return {
    generatedAt: new Date(now).toISOString(),
    counts: deduped.reduce((m, i) => { m[i.level] = (m[i.level] || 0) + 1; return m; }, {}),
    items: rank(deduped),
  };
}

module.exports = { buildFixList, itemId, LEVEL_RANK, BACKLOG_STALE_SEC };
