'use strict';

/**
 * HEIDI Mission Worker
 * -----------------------------------------------------------------------
 * Drives tasks with a structured context.action through the lifecycle in
 * missions/lifecycle.js:
 *
 *   queued → planning → [awaiting_approval →] running → verifying → completed | failed
 *
 * Safety model (unchanged gates, now with a recorded trail):
 *   - Bare-goal tasks (no structured action) are never touched: this worker
 *     never turns free text into a command.
 *   - Planning checks the SAME agent_registry.permission_level ladder
 *     tool-registry.js enforces, keyed off assigned_agent, and the SAME
 *     ActionExecutor.isSafe() pre-flight. Failing either → blocked.
 *   - Anything beyond a read-only action or a standing-approved module
 *     restart waits in awaiting_approval for a person (lifecycle.decide).
 *     Planning runs again after approval, so the gates are re-checked at
 *     run time, not just when the task was queued.
 *   - Real execution still needs HEIDI_AUTONOMOUS_ACTIONS=true. Without it
 *     a task runs as a DRY RUN: nothing executes, and the evidence says so.
 *   - A task is completed only after verification against its success
 *     criteria (default: no error and exit code 0), with the evidence stored.
 *   - After a restart, a task caught in planning goes back to queued; one
 *     caught running or verifying is failed (not retried: it may have
 *     partly run).
 */

const lifecycle = require('./lifecycle');

// Required permission_level per action type, mirroring ActionExecutor.isSafe()'s
// own risk tiering: log_event/read_file are always-safe (1), run_command/
// run_script are the ladder's "approved commands" tier (3), and write_file/
// api_call -- which isSafe() never auto-allows for ANY caller -- require the
// top tier (4). Anything else isn't a type ActionExecutor even accepts.
const REQUIRED_LEVEL = {
  log_event: 1,
  read_file: 1,
  run_command: 3,
  run_script: 3,
  write_file: 4,
  api_call: 4
};

const ACTOR = 'mission-worker';

class MissionWorker {
  /**
   * @param {HeidiMemory} memory
   * @param {ActionExecutor} actions
   * @param {object} opts  { intervalMs, batchSize, log, approvalTtlMs, now, policy }
   */
  constructor(memory, actions, opts = {}) {
    this.memory = memory;
    this.actions = actions;
    this.intervalMs = opts.intervalMs || Number(process.env.MISSION_WORKER_INTERVAL_MS) || 15000;
    this.batchSize = opts.batchSize || 10;
    this.log = opts.log || console.log;
    this.approvalTtlMs = opts.approvalTtlMs || (Number(process.env.HEIDI_APPROVAL_TTL_HOURS) || 24) * 3600 * 1000;
    this.now = opts.now || Date.now;
    this.policy = opts.policy || ((action) => lifecycle.approvalPolicy(action));
    this.timer = null;
    this.ticking = false; // reentrancy guard -- a slow action must not overlap the next tick
    this.recovered = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((e) => this.log(`[MISSION WORKER] tick error: ${e.message}`));
    }, this.intervalMs);
    const armed = process.env.HEIDI_AUTONOMOUS_ACTIONS === 'true';
    this.log(`[MISSION WORKER] started (interval ${this.intervalMs}ms, mode: ${armed ? 'ARMED -- executes for real' : 'dry-run only'})`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  move(id, to, reason, extra = {}) {
    return lifecycle.transition(this.memory, id, to, { actor: ACTOR, reason, ...extra });
  }

  /** Tasks left mid-flight by a crash or restart. Runs once, before the first tick. */
  async recover() {
    this.recovered = true;
    const stuck = await this.memory.getMissions(['planning', 'running', 'verifying', 'active'], 100);
    for (const m of stuck || []) {
      const st = lifecycle.normalizeState(m.status);
      if (st === 'planning') {
        await this.move(m.id, 'queued', 'restarted during planning; nothing had run', { from: 'planning' });
      } else {
        const evidence = { ...(lifecycle.parseJson(m.evidence) || {}), outcome: 'failed', error: `interrupted by a restart while ${st}; not retried because the action may have partly run` };
        await this.move(m.id, 'failed', `interrupted while ${st}`, { from: st, patch: { evidence, result: evidence } });
      }
      this.log(`[MISSION WORKER] recovered task ${m.id} (was ${st})`);
    }
  }

  /** Cancel approval requests nobody answered in time. */
  async expireApprovals() {
    const waiting = await this.memory.getMissions('awaiting_approval', 100);
    for (const m of waiting || []) {
      const approval = lifecycle.parseJson(m.approval) || {};
      if (approval.decision || !approval.expires_at) continue;
      if (lifecycle.toMs(approval.expires_at) > this.now()) continue;
      await this.move(m.id, 'cancelled', 'approval request expired', {
        from: 'awaiting_approval',
        patch: { approval: { ...approval, decision: 'expired', decided_by: ACTOR, decided_at: new Date(this.now()).toISOString() } },
      });
      this.log(`[MISSION WORKER] task ${m.id} cancelled: approval expired`);
    }
  }

  /** Approved tasks first (a person is waiting on them), then the queue. */
  async claimNext() {
    // Highest priority first, then oldest first (getMissions returns newest
    // first on SQLite, which would starve older tasks).
    const fifo = (rows) => [...(rows || [])].sort((a, b) => (b.priority - a.priority) || (a.id - b.id));
    const waiting = fifo(await this.memory.getMissions('awaiting_approval', 200));
    for (const mission of waiting) {
      const approval = lifecycle.parseJson(mission.approval) || {};
      const action = lifecycle.actionOf(mission);
      if (approval.decision === 'approved' && action) return { mission, action, approved: true };
    }
    const pending = fifo(await this.memory.getMissions(['queued', 'pending'], 500));
    for (const mission of pending) {
      const action = lifecycle.actionOf(mission);
      if (action) return { mission, action, approved: false };
    }
    return null;
  }

  parseContext(raw) {
    return lifecycle.parseJson(raw);
  }

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      if (!this.recovered) await this.recover();
      await this.expireApprovals();
      const claimed = await this.claimNext();
      if (!claimed) return;
      if (claimed.approved) await this.resumeApproved(claimed.mission, claimed.action);
      else await this.processMission(claimed.mission, claimed.action);
    } finally {
      this.ticking = false;
    }
  }

  /**
   * The gates. Returns { ok: true, plan } or { ok: false, to, error }.
   */
  async plan(mission, action) {
    const requiredLevel = REQUIRED_LEVEL[action.type];
    if (requiredLevel === undefined) return { ok: false, to: 'failed', error: `unsupported action type: ${action.type}` };
    if (!mission.assigned_agent) return { ok: false, to: 'blocked', error: 'no assigned_agent -- cannot determine permission level' };

    let agent = null;
    try { agent = await this.memory.getAgent(mission.assigned_agent); } catch { /* treated as absent below */ }
    const agentLevel = agent && agent.enabled ? agent.permission_level : 0;
    if (agentLevel < requiredLevel) {
      return { ok: false, to: 'blocked', error: `${mission.assigned_agent} is level ${agentLevel}, action '${action.type}' requires level ${requiredLevel}` };
    }
    if (!this.actions.isSafe(action)) return { ok: false, to: 'blocked', error: 'action did not pass isSafe() pre-flight check' };

    return {
      ok: true,
      plan: {
        action, requiredLevel, agent: mission.assigned_agent, agentLevel, safe: true,
        armed: process.env.HEIDI_AUTONOMOUS_ACTIONS === 'true',
        success: lifecycle.successOf(mission) || { exitCode: 0 },
        planned_at: new Date(this.now()).toISOString(),
      },
    };
  }

  async processMission(mission, action) {
    const id = mission.id;
    const claimed = await this.move(id, 'planning', 'picked up by the worker', { from: 'queued' });
    if (!claimed.ok) return; // someone else moved it first

    const p = await this.plan(mission, action);
    if (!p.ok) {
      const evidence = { outcome: p.to, error: p.error };
      await this.move(id, p.to, p.error, { from: 'planning', patch: { evidence, result: { error: p.error } } });
      this.log(`[MISSION WORKER] task ${id} ${p.to}: ${p.error}`);
      return;
    }

    const policy = this.policy(action);
    if (policy.required) {
      const approval = {
        required: true, reason: policy.reason, decision: null,
        requested_at: new Date(this.now()).toISOString(),
        expires_at: new Date(this.now() + this.approvalTtlMs).toISOString(),
      };
      await this.move(id, 'awaiting_approval', policy.reason, { from: 'planning', patch: { plan: p.plan, approval } });
      this.log(`[MISSION WORKER] task ${id} awaiting approval: ${policy.reason}`);
      return;
    }
    await this.run(mission, action, p.plan, 'planning', { required: false, reason: policy.reason });
  }

  /** A person approved it: re-check the gates now, then run. */
  async resumeApproved(mission, action) {
    const p = await this.plan(mission, action);
    if (!p.ok) {
      const evidence = { outcome: p.to === 'failed' ? 'failed' : 'blocked', error: `after approval: ${p.error}` };
      await this.move(mission.id, 'blocked', `after approval: ${p.error}`, { from: 'awaiting_approval', patch: { evidence, result: { error: p.error } } });
      this.log(`[MISSION WORKER] task ${mission.id} blocked after approval: ${p.error}`);
      return;
    }
    await this.run(mission, action, p.plan, 'awaiting_approval', null);
  }

  async run(mission, action, plan, from, approval) {
    const id = mission.id;
    const patch = { plan };
    if (approval) patch.approval = approval;
    const started = await this.move(id, 'running', plan.armed ? `running ${action.type}` : `dry run of ${action.type}`, { from, patch });
    if (!started.ok) return;

    const t0 = this.now();
    let outcome;
    if (!plan.armed) {
      outcome = { dryRun: true };
      this.log(`[MISSION WORKER] task ${id} DRY RUN (HEIDI_AUTONOMOUS_ACTIONS not set): would execute ${action.type}`);
    } else {
      try {
        outcome = { result: await this.actions.execute(action) };
      } catch (e) {
        outcome = { error: e.message };
      }
    }

    const ran = await this.move(id, 'verifying', outcome.error ? 'execution failed' : 'checking the result', { from: 'running' });
    if (!ran.ok) return;
    const evidence = {
      ...lifecycle.verify(action, outcome, plan.success),
      duration_ms: this.now() - t0,
      verified_at: new Date(this.now()).toISOString(),
    };
    // dry_run counts as completed: every gate passed and the evidence says nothing ran.
    const to = evidence.outcome === 'failed' ? 'failed' : 'completed';
    const summary = evidence.outcome === 'dry_run'
      ? { dryRun: true, wouldExecute: action }
      : { outcome: evidence.outcome, checks: evidence.checks };
    await this.move(id, to, evidence.outcome === 'dry_run' ? 'dry run: all gates passed, nothing executed' : `verification ${evidence.outcome}`, {
      from: 'verifying', patch: { evidence, result: summary },
    });
    this.log(`[MISSION WORKER] task ${id} ${to} (${evidence.outcome})`);
  }
}

MissionWorker.REQUIRED_LEVEL = REQUIRED_LEVEL;
module.exports = MissionWorker;
