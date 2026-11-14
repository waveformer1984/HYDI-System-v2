'use strict';
/**
 * Allowlisted actions — the ONLY three things Heidi may propose for
 * phone approval. Everything else is refused before a mission exists.
 *
 * Execution still flows through the existing mission pipeline
 * (missions/lifecycle.js + mission-worker.js + ActionExecutor), so a
 * proposal is just a mission whose context.action is one of these specs.
 * The worker re-validates the action against the spec at execution time
 * (the "inside bounds" gate) and requires HEIDI_ALLOW_EXEC=true.
 *
 *   pm2_restart     { app }          -> scripts/pm2-restart.js <app>
 *   local_ci_rerun  { pr }           -> scripts/local-ci.js --pr <n>
 *   disk_report     {}               -> scripts/disk-report.js
 *   job_scout_scan  {}               -> scripts/job-scout.js --once (read-only scan)
 */
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'scripts');
const ASSIGNED_AGENT = 'Heidi'; // permission_level 3 — required for run_script

const SPECS = {
  pm2_restart: {
    summary: (a) => `Restart PM2 app '${a.app}'`,
    validate(args = {}) {
      if (typeof args.app !== 'string' || !/^[a-zA-Z0-9:_-]{1,64}$/.test(args.app)) {
        return "pm2_restart needs args.app (PM2 app name, letters/digits/-_:)";
      }
      return null;
    },
    action: (a) => ({ type: 'run_script', target: path.join(SCRIPTS, 'pm2-restart.js'), args: [a.app] }),
  },
  local_ci_rerun: {
    summary: (a) => `Re-run local-ci for PR #${a.pr}`,
    validate(args = {}) {
      const pr = Number(args.pr);
      if (!Number.isInteger(pr) || pr < 1 || pr > 99999) return 'local_ci_rerun needs args.pr (PR number)';
      return null;
    },
    action: (a) => ({ type: 'run_script', target: path.join(SCRIPTS, 'local-ci.js'), args: ['--pr', String(Number(a.pr))] }),
  },
  disk_report: {
    summary: () => 'Disk report for C:',
    validate() { return null; },
    action: () => ({ type: 'run_script', target: path.join(SCRIPTS, 'disk-report.js'), args: [] }),
  },
  job_scout_scan: {
    summary: () => 'Run job-scout scan now (read-only toward job sites)',
    validate() { return null; },
    action: () => ({
      type: 'run_script',
      target: path.join(SCRIPTS, 'job-scout.js'),
      args: ['--once'],
      timeout_ms: 240000,
    }),
  },
};

function listSpecs() {
  return Object.entries(SPECS).map(([id, s]) => ({ id, example: id === 'pm2_restart' ? { app: 'heidi-mobile-chat' } : id === 'local_ci_rerun' ? { pr: 526 } : {} }));
}

/** Chat phrases that propose an allowlisted action (never execute it). */
function parseCommand(input) {
  const s = String(input || '').trim().toLowerCase();
  let m = s.match(/^(?:please\s+)?(?:propose\s+|run\s+|execute\s+)?(?:a\s+)?(?:pm2\s+)?restart\s+(?:pm2\s+)?(?:app\s+)?['"]?([a-z0-9:_-]{1,64})['"]?$/);
  if (m && !/restart-module|restart the|restart my/.test(s)) return { spec: 'pm2_restart', args: { app: m[1] } };
  m = s.match(/^(?:please\s+)?(?:re-?run|rerun|run)\s+(?:the\s+)?local-?ci\s+(?:for\s+)?(?:pr\s*)?#?(\d{1,5})\b/);
  if (m) return { spec: 'local_ci_rerun', args: { pr: Number(m[1]) } };
  if (/^(?:please\s+)?(?:run\s+|get\s+|show\s+)?disk\s+report$/.test(s)) return { spec: 'disk_report', args: {} };
  return null;
}

/** Validate + build the mission action. Returns { ok, action?, error? }. */
function build(specId, args = {}) {
  const spec = SPECS[specId];
  if (!spec) return { ok: false, error: `unknown action '${specId}' — allowed: ${Object.keys(SPECS).join(', ')}` };
  const err = spec.validate(args);
  if (err) return { ok: false, error: err };
  return { ok: true, action: spec.action(args), summary: spec.summary(args) };
}

/**
 * The three execution gates, checked by the mission worker immediately
 * before an allowlisted action runs (in addition to the normal
 * isSafe/agent-level/armed checks every mission already passes):
 *   1. HEIDI_ALLOW_EXEC === 'true'
 *   2. a person approved the mission (approval.decision === 'approved',
 *      decided_by 'human:…' — enforced by lifecycle.decide upstream)
 *   3. the action still exactly matches its allowlist spec (inside bounds)
 * Returns { ok } or { ok:false, reason } — caller audits the refusal.
 */
function authorize(mission, action, { env = process.env } = {}) {
  const ctx = mission && mission.context ? (typeof mission.context === 'string' ? JSON.parse(mission.context) : mission.context) : {};
  const marker = ctx.allowlist;
  if (!marker || !marker.spec) return { ok: true }; // not an allowlisted mission — normal gates apply
  if (env.HEIDI_ALLOW_EXEC !== 'true') {
    return { ok: false, reason: `HEIDI_ALLOW_EXEC is not 'true' — refusing to execute ${marker.spec}` };
  }
  const approval = mission.approval ? (typeof mission.approval === 'string' ? JSON.parse(mission.approval) : mission.approval) : null;
  if (!approval || approval.decision !== 'approved' || !String(approval.decided_by || '').startsWith('human:')) {
    return { ok: false, reason: `${marker.spec} has no recorded human approval` };
  }
  const expected = build(marker.spec, marker.args || {});
  if (!expected.ok) return { ok: false, reason: `allowlist spec no longer valid: ${expected.error}` };
  const same = JSON.stringify(expected.action) === JSON.stringify(action);
  if (!same) return { ok: false, reason: `${marker.spec} action does not match its allowlisted spec — outside bounds` };
  return { ok: true };
}

/** Is this mission an allowlisted proposal? (used by the worker for arming) */
function isAllowlisted(mission) {
  try {
    const ctx = mission && mission.context ? (typeof mission.context === 'string' ? JSON.parse(mission.context) : mission.context) : {};
    return Boolean(ctx.allowlist && ctx.allowlist.spec && SPECS[ctx.allowlist.spec]);
  } catch { return false; }
}

/**
 * Propose an allowlisted action as a mission. The mission enters 'queued';
 * the worker plans it into 'awaiting_approval' where a person approves or
 * rejects it in the Tasks tab. Nothing executes at proposal time.
 */
async function propose(memory, specId, args = {}, { actor = 'heidi', traceId = null } = {}) {
  const b = build(specId, args);
  if (!b.ok) return { ok: false, error: b.error };
  const context = {
    action: b.action,
    allowlist: { spec: specId, args },
    evidence: `proposed by ${actor}: ${b.summary}`,
  };
  const id = await memory.createMission(b.summary, 2, context, ASSIGNED_AGENT, { actor, traceId, reason: `allowlist propose ${specId}` });
  return { ok: true, missionId: id, summary: b.summary, action: b.action };
}

module.exports = { SPECS, ASSIGNED_AGENT, listSpecs, parseCommand, build, authorize, isAllowlisted, propose };
