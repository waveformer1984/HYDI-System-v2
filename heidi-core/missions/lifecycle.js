'use strict';

/**
 * Heidi task lifecycle
 * -----------------------------------------------------------------------
 * One state machine for every mission (task) in heidi-core's queue:
 *
 *   queued ─▶ planning ─▶ awaiting_approval ─▶ running ─▶ verifying ─▶ completed
 *                │  │              │                │            └─▶ failed
 *                │  └─▶ running ───┼────────────────┘ (no approval needed)
 *                ├─▶ blocked ──▶ queued (re-check after a fix)
 *                └─▶ failed            └─▶ cancelled (rejected or expired)
 *
 * Rules this file enforces (the store only does conditional writes):
 * - Every change is a listed transition, made with a conditional UPDATE and
 *   recorded in mission_events with who did it and why.
 * - A task with an action reaches `completed` only through `verifying`, with
 *   evidence. Only informational tasks (no action) can be closed by hand.
 * - Approval is a human decision (actor `human:<owner>`) taken through the
 *   chat command or the REST route. The model's tools cannot approve.
 * - Planning re-runs after approval, so a permission or safety change made
 *   while a task waited is honoured before it runs.
 */

const path = require('path');
const fs = require('fs');
const { containsSecret } = require('../memory/secret-filter');

const STATES = ['queued', 'planning', 'awaiting_approval', 'running', 'verifying', 'completed', 'failed', 'cancelled', 'blocked'];
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const ACTIVE = new Set(['planning', 'running', 'verifying']);

const TRANSITIONS = {
  queued: ['planning', 'cancelled', 'completed', 'failed'], // completed/failed: informational tasks only
  planning: ['awaiting_approval', 'running', 'blocked', 'failed', 'queued', 'cancelled'],
  awaiting_approval: ['running', 'blocked', 'cancelled'],
  running: ['verifying', 'failed'],
  verifying: ['completed', 'failed'],
  blocked: ['queued', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

// Pre-lifecycle names still found in older rows or callers.
const LEGACY = { pending: 'queued', active: 'running' };

function normalizeState(s) {
  return LEGACY[s] || s;
}

function fromStatesFor(to) {
  const out = [];
  for (const [from, tos] of Object.entries(TRANSITIONS)) {
    if (tos.includes(to)) {
      out.push(from);
      for (const [legacy, now] of Object.entries(LEGACY)) if (now === from) out.push(legacy);
    }
  }
  return out;
}

function parseJson(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

function actionOf(mission) {
  const ctx = parseJson(mission && mission.context);
  return ctx && ctx.action && ctx.action.type ? ctx.action : null;
}

function successOf(mission) {
  const ctx = parseJson(mission && mission.context);
  return (ctx && ctx.success && typeof ctx.success === 'object') ? ctx.success : null;
}

function toMs(ts) {
  if (!ts) return NaN;
  const s = String(ts);
  return Date.parse(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
}

/**
 * Move mission `id` to `to`. Returns { ok: true, from } or { ok: false, error }.
 * @param {object} memory  HeidiMemory (transitionMission/getMission)
 */
async function transition(memory, id, to, { actor, reason = null, patch = {}, data = null, from = null } = {}) {
  if (!STATES.includes(to)) return { ok: false, error: `unknown state '${to}'` };
  if (!actor) return { ok: false, error: 'actor is required' };
  let allowed = fromStatesFor(to);
  if (from) {
    const want = (Array.isArray(from) ? from : [from]);
    allowed = allowed.filter((s) => want.includes(normalizeState(s)));
  }

  if ((to === 'completed' || to === 'failed') && allowed.includes('queued')) {
    const m = await memory.getMission(id);
    if (m && normalizeState(m.status) === 'queued' && actionOf(m)) {
      return { ok: false, error: `task ${id} has an action: only the worker can finish it, after verifying` };
    }
  }

  const r = await memory.transitionMission(Number(id), allowed, to, { actor, reason, patch, data });
  if (r.ok) return { ok: true, from: r.from };
  if (r.current == null) return { ok: false, error: `task ${id} not found` };
  return { ok: false, error: `task ${id} is ${normalizeState(r.current)}; it can't move to ${to}` };
}

/**
 * Human approval decision on a task waiting for one.
 * approve: records the decision; the worker re-plans and runs it on its next tick.
 * reject:  cancels it.
 */
async function decide(memory, id, decision, { actor, reason = null, now = Date.now() } = {}) {
  if (!String(actor || '').startsWith('human:')) return { ok: false, error: 'only a person can approve or reject a task' };
  const m = await memory.getMission(id);
  if (!m) return { ok: false, error: `task ${id} not found` };
  if (normalizeState(m.status) !== 'awaiting_approval') return { ok: false, error: `task ${id} is ${normalizeState(m.status)}, not awaiting approval` };
  const approval = parseJson(m.approval) || {};
  if (approval.decision) return { ok: false, error: `task ${id} was already ${approval.decision}` };
  const at = new Date(now).toISOString();

  if (decision === 'reject') {
    return transition(memory, id, 'cancelled', {
      actor, reason: reason ? `rejected: ${reason}` : 'rejected',
      patch: { approval: { ...approval, decision: 'rejected', decided_by: actor, decided_at: at, note: reason || null } },
      from: 'awaiting_approval',
    });
  }
  if (decision !== 'approve') return { ok: false, error: `unknown decision '${decision}'` };
  if (approval.expires_at && toMs(approval.expires_at) <= now) return { ok: false, error: `task ${id}'s approval request expired; it will be cancelled` };

  const r = await memory.transitionMission(Number(id), ['awaiting_approval'], 'awaiting_approval', {
    actor,
    reason: reason ? `approved: ${reason}` : 'approved',
    patch: { approval: { ...approval, decision: 'approved', decided_by: actor, decided_at: at, note: reason || null } },
  });
  return r.ok ? { ok: true } : { ok: false, error: `task ${id} changed while approving; check it again` };
}

// ── Approval policy ──────────────────────────────────────────────────────

const RESTART_MODULE_SCRIPT = path.join(__dirname, '../../scripts/restart-module.js');

function bootModuleIds(configPath = path.join(__dirname, '../../boot.config.json')) {
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return new Set((cfg.modules || []).map((m) => m.id).filter(Boolean));
  } catch {
    return new Set();
  }
}

/**
 * Does this action need a person to approve it before it runs?
 * Decided from the action itself, never from who proposed it.
 * - log_event / read_file: no (read-only).
 * - restarting one boot.config.json module via scripts/restart-module.js:
 *   no, unless HEIDI_AUTO_APPROVE_RESTARTS=false (keeps health-observer
 *   recovery working as before).
 * - everything else (any other command or script): yes.
 */
function approvalPolicy(action, { env = process.env, moduleIds = bootModuleIds() } = {}) {
  if (!action) return { required: false, reason: 'no action' };
  if (action.type === 'log_event' || action.type === 'read_file') return { required: false, reason: 'read-only action' };
  if (action.type === 'run_script'
      && env.HEIDI_AUTO_APPROVE_RESTARTS !== 'false'
      && action.target && path.resolve(action.target) === RESTART_MODULE_SCRIPT
      && Array.isArray(action.args) && action.args.length === 1 && moduleIds.has(String(action.args[0]))) {
    return { required: false, reason: `standing approval: restart of HYDI module '${action.args[0]}'` };
  }
  return { required: true, reason: `${action.type} changes or runs something on Frank` };
}

// ── Verification ─────────────────────────────────────────────────────────

/** Keep output short and drop any line that looks like a credential. */
function redactOutput(text, max = 1500) {
  const lines = String(text || '').split(/\r?\n/).map((l) => (containsSecret(l) ? '[line hidden: looked like a credential]' : l));
  const joined = lines.join('\n').trim();
  return joined.length > max ? `${joined.slice(0, max)}… (${joined.length - max} more chars)` : joined;
}

/**
 * Check the execution outcome against the task's success criteria.
 * outcome: { dryRun?, result?, error? }; success: { exitCode?, outputIncludes? }
 * Returns evidence: { outcome: 'success'|'dry_run'|'failed', checks, output }.
 */
function verify(action, outcome, success = null) {
  if (outcome.dryRun) {
    return {
      outcome: 'dry_run',
      checks: [{ check: 'executed', pass: false, detail: 'DRY RUN: HEIDI_AUTONOMOUS_ACTIONS is not "true", so nothing ran' }],
      output: null,
    };
  }
  const checks = [];
  if (outcome.error) {
    checks.push({ check: 'executed', pass: false, detail: redactOutput(outcome.error, 300) });
    return { outcome: 'failed', checks, output: null };
  }
  const inner = outcome.result && outcome.result.result !== undefined ? outcome.result.result : outcome.result;
  checks.push({ check: 'executed', pass: Boolean(outcome.result && outcome.result.success !== false), detail: 'action returned without error' });
  const stdout = inner && typeof inner === 'object' ? (inner.stdout || inner.content || '') : '';
  if (inner && typeof inner === 'object' && inner.exitCode !== undefined) {
    const want = success && Number.isInteger(success.exitCode) ? success.exitCode : 0;
    checks.push({ check: `exit code ${want}`, pass: inner.exitCode === want, detail: `exit code ${inner.exitCode}` });
  }
  if (success && typeof success.outputIncludes === 'string' && success.outputIncludes) {
    const hit = String(stdout).includes(success.outputIncludes);
    checks.push({ check: `output includes "${success.outputIncludes.slice(0, 60)}"`, pass: hit, detail: hit ? 'found' : 'not found' });
  }
  return {
    outcome: checks.every((c) => c.pass) ? 'success' : 'failed',
    checks,
    output: stdout ? redactOutput(stdout) : null,
  };
}

// ── Chat commands and formatting ─────────────────────────────────────────

const STATE_ICON = {
  queued: '⏳', planning: '🧭', awaiting_approval: '✋', running: '▶️', verifying: '🔎',
  completed: '✅', failed: '❌', cancelled: '🚫', blocked: '⛔',
};

/**
 * "tasks" | "task list" | "task 12" | "task approve 12 [note]" |
 * "task reject 12 [reason]" | "task cancel 12 [reason]". Plain string
 * parsing, no backtracking regex. Returns null for anything else.
 */
function parseTaskCommand(input) {
  const words = String(input || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const first = words[0].toLowerCase();
  if (words.length === 1 && (first === 'tasks' || first === '/tasks')) return { cmd: 'list' };
  if (first !== 'task' && first !== '/task') return null;
  const second = (words[1] || '').toLowerCase();
  if (!second || second === 'list') return words.length <= 2 ? { cmd: 'list' } : null;
  const asId = (w) => {
    const t = String(w || '').replace(/^#/, '');
    return /^\d{1,9}$/.test(t) ? Number(t) : null;
  };
  if (asId(second) !== null && words.length === 2) return { cmd: 'show', id: asId(second) };
  if (['approve', 'reject', 'cancel'].includes(second)) {
    const id = asId(words[2]);
    if (id === null) return { cmd: 'usage' };
    const note = words.slice(3).join(' ').slice(0, 300) || null;
    return { cmd: second, id, note };
  }
  return null;
}

function ageText(ts, now = Date.now()) {
  const ms = now - toMs(ts);
  if (!Number.isFinite(ms)) return 'unknown time';
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return `${Math.round(ms / 60000)} min ago`;
  if (ms < 86400000) return `${Math.round(ms / 3600000)} h ago`;
  return `${Math.round(ms / 86400000)} d ago`;
}

function oneLine(m, now) {
  const st = normalizeState(m.status);
  const a = actionOf(m);
  const what = a ? ` [${a.type}]` : '';
  return `${STATE_ICON[st] || '•'} #${m.id} ${st}${what} — ${String(m.goal || '').slice(0, 90)} (${ageText(m.updated_at || m.created_at, now)})`;
}

function formatTaskList(missions, now = Date.now()) {
  if (!missions || !missions.length) return '📋 No tasks.';
  const order = ['awaiting_approval', 'running', 'verifying', 'planning', 'queued', 'blocked', 'failed', 'completed', 'cancelled'];
  const sorted = [...missions].sort((x, y) => order.indexOf(normalizeState(x.status)) - order.indexOf(normalizeState(y.status)) || y.id - x.id);
  const waiting = sorted.filter((m) => normalizeState(m.status) === 'awaiting_approval');
  const lines = [`📋 Tasks (${missions.length})`, ...sorted.map((m) => oneLine(m, now))];
  if (waiting.length) lines.push('', `✋ ${waiting.length} waiting for you. Reply "task ${waiting[0].id}" to see it, then "task approve ${waiting[0].id}" or "task reject ${waiting[0].id}".`);
  return lines.join('\n');
}

function formatTask(m, events = [], now = Date.now()) {
  const st = normalizeState(m.status);
  const a = actionOf(m);
  const plan = parseJson(m.plan);
  const approval = parseJson(m.approval);
  const evidence = parseJson(m.evidence);
  const lines = [`${STATE_ICON[st] || '•'} Task #${m.id}: ${st.toUpperCase()}`, `Goal: ${m.goal}`];
  if (m.assigned_agent) lines.push(`Agent: ${m.assigned_agent}`);
  if (a) lines.push(`Action: ${a.type} ${a.command || a.target || ''}${Array.isArray(a.args) && a.args.length ? ` ${a.args.join(' ')}` : ''}`.trim());
  const success = successOf(m);
  if (success) lines.push(`Success means: ${JSON.stringify(success)}`);
  if (plan) lines.push(`Plan: needs level ${plan.requiredLevel}, ${plan.agent} is level ${plan.agentLevel}; safety check ${plan.safe ? 'passed' : 'failed'}; ${plan.armed ? 'will run for real' : 'dry run only (HEIDI_AUTONOMOUS_ACTIONS off)'}`);
  if (approval) {
    if (approval.required === false) lines.push(`Approval: not needed (${approval.reason})`);
    else if (approval.decision) lines.push(`Approval: ${approval.decision} by ${approval.decided_by} ${ageText(approval.decided_at, now)}${approval.note ? ` — ${approval.note}` : ''}`);
    else {
      const left = toMs(approval.expires_at) - now;
      const when = !Number.isFinite(left) ? 'never' : left <= 0 ? 'already expired' : left < 3600000 ? `in ${Math.max(1, Math.round(left / 60000))} min` : `in ${Math.round(left / 3600000)} h`;
      lines.push(`Approval: NEEDED (${approval.reason}); expires ${when}. Reply "task approve ${m.id}" or "task reject ${m.id}".`);
    }
  }
  if (evidence) {
    lines.push(`Evidence: ${evidence.outcome || 'recorded'}`);
    for (const c of evidence.checks || []) lines.push(`  ${c.pass ? '✓' : '✗'} ${c.check}: ${c.detail}`);
    if (evidence.output) lines.push(`  output: ${evidence.output.split('\n').slice(0, 6).join(' ⏎ ')}`);
    if (evidence.error) lines.push(`  error: ${evidence.error}`);
  }
  if (events.length) {
    lines.push('History:');
    for (const e of events.slice(-10)) {
      const arrow = e.from_state ? `${normalizeState(e.from_state)} → ${e.to_state}` : `→ ${e.to_state}`;
      lines.push(`  ${ageText(e.at, now)}: ${arrow} by ${e.actor}${e.reason ? ` (${e.reason})` : ''}`);
    }
  }
  return lines.join('\n');
}

/**
 * Run a parsed task command. `actor` is `human:<owner>`; `onApproved`
 * lets the server nudge the worker so an approved task starts promptly.
 */
async function runTaskCommand(memory, parsed, { actor, now = Date.now(), onApproved = null } = {}) {
  if (!memory || typeof memory.getMission !== 'function') return '⚠️ Task queue unavailable.';
  if (parsed.cmd === 'usage') return 'Usage: task approve <id> | task reject <id> [reason] | task cancel <id> [reason]';
  if (parsed.cmd === 'list') {
    const open = await memory.getMissions(['awaiting_approval', 'running', 'verifying', 'planning', 'queued', 'blocked', 'pending', 'active'], 30);
    const recent = (await memory.getMissions(['completed', 'failed', 'cancelled'], 10)) || [];
    return formatTaskList([...(open || []), ...recent], now);
  }
  const m = await memory.getMission(parsed.id);
  if (!m) return `⚠️ Task #${parsed.id} not found.`;
  if (parsed.cmd === 'show') return formatTask(m, await memory.getMissionEvents(parsed.id), now);

  let r;
  if (parsed.cmd === 'approve' || parsed.cmd === 'reject') {
    r = await decide(memory, parsed.id, parsed.cmd, { actor, reason: parsed.note, now });
    if (r.ok && parsed.cmd === 'approve' && onApproved) {
      try { await onApproved(parsed.id); } catch { /* the worker's own tick will pick it up */ }
    }
  } else {
    if (ACTIVE.has(normalizeState(m.status)) && normalizeState(m.status) !== 'planning') {
      return `⚠️ Task #${parsed.id} is ${normalizeState(m.status)}; it can't be cancelled mid-run.`;
    }
    r = await transition(memory, parsed.id, 'cancelled', { actor, reason: parsed.note ? `cancelled: ${parsed.note}` : 'cancelled' });
  }
  if (!r.ok) return `⚠️ ${r.error}`;
  const after = await memory.getMission(parsed.id);
  return formatTask(after, await memory.getMissionEvents(parsed.id), now);
}

module.exports = {
  STATES,
  TERMINAL,
  TRANSITIONS,
  normalizeState,
  fromStatesFor,
  parseJson,
  actionOf,
  successOf,
  toMs,
  transition,
  decide,
  approvalPolicy,
  verify,
  redactOutput,
  parseTaskCommand,
  runTaskCommand,
  formatTaskList,
  formatTask,
  RESTART_MODULE_SCRIPT,
};
