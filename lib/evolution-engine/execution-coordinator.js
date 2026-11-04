'use strict';

const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');

const DESTRUCTIVE_CODES = new Set(['paid_llm_enabled', 'billing.offboarding_execute']);

/**
 * Coordinates approved improvements inside an isolated workspace — no clean-main writes.
 */
class ExecutionCoordinator {
  /**
   * @param {{
   *   repoRoot: string,
   *   workspaceRoot?: string,
   *   rollback: import('./rollback-manager').RollbackManager,
   *   verify: import('./verification-engine').VerificationEngine,
   *   memory: import('./evolution-memory').EvolutionMemory,
   * }} deps
   */
  constructor(deps) {
    this.repoRoot = deps.repoRoot;
    this.workspaceRoot = deps.workspaceRoot || path.join(deps.repoRoot, '.runtime', 'evolution', 'workspace');
    this.rollback = deps.rollback;
    this.verify = deps.verify;
    this.memory = deps.memory;
    this._active = null;
  }

  status() {
    return {
      active: this._active,
      workspace: this.workspaceRoot,
      allow_git: process.env.EVOLUTION_ALLOW_GIT === 'true',
      allow_execute: process.env.EVOLUTION_ALLOW_EXECUTE === 'true',
    };
  }

  stop() {
    const prev = this._active;
    this._active = null;
    return { stopped: Boolean(prev), previous: prev };
  }

  /**
   * @param {object} item backlog item from ImprovementPlanner
   * @param {{ approved?: boolean, operatorId?: string, simulatePatch?: boolean, regressionProbe?: Function }} opts
   */
  async execute(item, opts = {}) {
    if (this._active) {
      return { ok: false, error: 'execution_in_progress', active: this._active };
    }
    if (!opts.approved) {
      return {
        ok: false,
        error: 'approval_required',
        message: 'Set approved:true after operator review (mobile confirm or chat).',
        item_id: item.id,
      };
    }
    if (DESTRUCTIVE_CODES.has(item.code) && process.env.EVOLUTION_ALLOW_DESTRUCTIVE !== 'true') {
      return { ok: false, error: 'destructive_blocked', item_id: item.id };
    }
    if (process.env.EVOLUTION_ALLOW_EXECUTE !== 'true' && !opts.simulatePatch) {
      return {
        ok: false,
        error: 'execute_gate_closed',
        hint: 'Set EVOLUTION_ALLOW_EXECUTE=true on the host to run workspace patches.',
        item_id: item.id,
      };
    }

    const attemptId = randomBytes(6).toString('hex');
    this._active = { attemptId, item_id: item.id, started_at: new Date().toISOString() };
    fs.mkdirSync(this.workspaceRoot, { recursive: true });

    const relPatch = path.join('patches', `${attemptId}.txt`);
    this.rollback.snapshot(relPatch, attemptId);
    const patchBody = `# Evolution patch ${attemptId}\n# Item: ${item.id}\n# ${item.title}\n`;
    fs.mkdirSync(path.dirname(path.join(this.workspaceRoot, relPatch)), { recursive: true });
    fs.writeFileSync(path.join(this.workspaceRoot, relPatch), patchBody);

    const baseline = opts.baseline || {};
    const verification = await this.verify.verify({
      baseline,
      testFiles: opts.testFiles,
      regressionProbe: opts.regressionProbe,
      afterMetrics: opts.afterMetrics,
    });

    let outcome;
    if (!verification.ok) {
      const rb = this.rollback.rollback(attemptId);
      outcome = 'rolled_back';
      this.memory.record('improvement_failed', { attemptId, item, verification, rollback: rb });
      this._active = null;
      return { ok: false, attemptId, verification, rollback: rb, outcome };
    }

    this.memory.record('improvement_applied', { attemptId, item, verification, patch: relPatch });
    outcome = 'verified';
    this._active = null;
    return { ok: true, attemptId, verification, outcome, patch: relPatch };
  }

  rollbackAttempt(attemptId, opts = {}) {
    if (!opts.approved) {
      return { ok: false, error: 'approval_required' };
    }
    const rb = this.rollback.rollback(attemptId);
    this.memory.record('manual_rollback', { attemptId, rollback: rb });
    return { ok: rb.ok, ...rb };
  }
}

module.exports = { ExecutionCoordinator };
