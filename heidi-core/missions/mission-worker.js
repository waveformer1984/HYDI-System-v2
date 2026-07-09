'use strict';

/**
 * HEIDI Mission Worker
 * -----------------------------------------------------------------------
 * Closes the loop the mission queue never had: something that actually
 * looks at pending missions and acts on them. Before this file existed,
 * memory.nextMission() had exactly one caller in the whole codebase --
 * itself -- so missions were a to-do list nobody read.
 *
 * Safety model (matches the codebase's existing conventions, does not
 * invent a parallel one):
 *   - Only missions carrying a STRUCTURED context.action are ever touched.
 *     A bare-goal mission (the common case) is left untouched for a human
 *     or an LLM to reason about -- this worker never interprets free text
 *     into a command.
 *   - Every action is gated by the SAME agent_registry.permission_level
 *     ladder tool-registry.js enforces (0 observe .. 4 full), keyed off the
 *     mission's assigned_agent. A mission with no assigned_agent, or an
 *     agent below the required level, is marked 'blocked', never executed.
 *   - Every action is re-checked with the SAME ActionExecutor.isSafe() used
 *     to gate autonomous /think-detected actions.
 *   - Real execution additionally requires HEIDI_AUTONOMOUS_ACTIONS=true --
 *     the exact env var server.js already uses to gate autonomous action
 *     execution elsewhere. Without it, a mission that passes every other
 *     check is DRY-RUN ONLY: logged, marked completed with
 *     result.dryRun=true, nothing actually runs. This is the deliberate
 *     "level 0-1 observe/dry-run first" starting posture -- arming real
 *     execution is a conscious, separate step for a human to take.
 */

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

class MissionWorker {
  /**
   * @param {HeidiMemory} memory
   * @param {ActionExecutor} actions
   * @param {object} opts  { intervalMs, batchSize, log }
   */
  constructor(memory, actions, opts = {}) {
    this.memory = memory;
    this.actions = actions;
    this.intervalMs = opts.intervalMs || Number(process.env.MISSION_WORKER_INTERVAL_MS) || 15000;
    this.batchSize = opts.batchSize || 10;
    this.log = opts.log || console.log;
    this.timer = null;
    this.ticking = false; // reentrancy guard -- a slow action must not overlap the next tick
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

  /** Find the first pending mission carrying a valid structured action. */
  async claimNext() {
    const pending = await this.memory.getMissions('pending', this.batchSize);
    for (const mission of pending || []) {
      const context = this.parseContext(mission.context);
      if (context && context.action && context.action.type) {
        return { mission, action: context.action };
      }
    }
    return null;
  }

  parseContext(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch { return null; }
  }

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const claimed = await this.claimNext();
      if (!claimed) return;
      await this.processMission(claimed.mission, claimed.action);
    } finally {
      this.ticking = false;
    }
  }

  async processMission(mission, action) {
    const id = mission.id;
    await this.memory.updateMission(id, 'active');

    const requiredLevel = REQUIRED_LEVEL[action.type];
    if (requiredLevel === undefined) {
      await this.memory.updateMission(id, 'failed', { error: `unsupported action type: ${action.type}` });
      this.log(`[MISSION WORKER] mission ${id} failed: unsupported action type '${action.type}'`);
      return;
    }

    if (!mission.assigned_agent) {
      await this.memory.updateMission(id, 'blocked', { error: 'no assigned_agent -- cannot determine permission level' });
      this.log(`[MISSION WORKER] mission ${id} blocked: no assigned_agent`);
      return;
    }

    let agent = null;
    try { agent = await this.memory.getAgent(mission.assigned_agent); } catch { /* treated as absent below */ }
    const level = agent && agent.enabled ? agent.permission_level : 0;

    if (level < requiredLevel) {
      await this.memory.updateMission(id, 'blocked', {
        error: `${mission.assigned_agent} is level ${level}, action '${action.type}' requires level ${requiredLevel}`
      });
      this.log(`[MISSION WORKER] mission ${id} blocked: ${mission.assigned_agent} level ${level} < required ${requiredLevel}`);
      return;
    }

    if (!this.actions.isSafe(action)) {
      await this.memory.updateMission(id, 'blocked', { error: 'action did not pass isSafe() pre-flight check' });
      this.log(`[MISSION WORKER] mission ${id} blocked: failed isSafe() pre-flight`);
      return;
    }

    const armed = process.env.HEIDI_AUTONOMOUS_ACTIONS === 'true';
    if (!armed) {
      await this.memory.updateMission(id, 'completed', { dryRun: true, wouldExecute: action });
      this.log(`[MISSION WORKER] mission ${id} DRY RUN (HEIDI_AUTONOMOUS_ACTIONS not set): would execute ${action.type}`);
      return;
    }

    try {
      const { result } = await this.actions.execute(action);
      await this.memory.updateMission(id, 'completed', result);
      this.log(`[MISSION WORKER] mission ${id} completed: ${action.type}`);
    } catch (e) {
      await this.memory.updateMission(id, 'failed', { error: e.message });
      this.log(`[MISSION WORKER] mission ${id} failed: ${e.message}`);
    }
  }
}

module.exports = MissionWorker;
