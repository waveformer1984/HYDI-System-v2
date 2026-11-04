'use strict';

const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');
const { buildApprovalContract, validateApprovalContract, assertPathAllowed } = require('./approval-contract');
const { EvidenceBundle } = require('./evidence-bundle');
const { GitWorkspace } = require('./git-workspace');

const DESTRUCTIVE_CODES = new Set(['paid_llm_enabled', 'billing.offboarding_execute']);

/**
 * Coordinates approved improvements inside an isolated workspace — no clean-main writes.
 */
class ExecutionCoordinator {
  /**
   * @param {object} deps
   */
  constructor(deps) {
    this.repoRoot = deps.repoRoot;
    this.workspaceRoot = deps.workspaceRoot || path.join(deps.repoRoot, '.runtime', 'evolution', 'workspace');
    this.rollback = deps.rollback;
    this.verify = deps.verify;
    this.memory = deps.memory;
    this.runStore = deps.runStore;
    this.evidence = deps.evidence || new EvidenceBundle({ rootDir: path.join(path.dirname(this.workspaceRoot), 'evidence') });
    this.getBaseSha = deps.getBaseSha || (() => null);
    this.gitWorkspace = deps.gitWorkspace || null;
    this._active = null;
  }

  _git() {
    if (!this.gitWorkspace && process.env.EVOLUTION_ALLOW_GIT === 'true') {
      this.gitWorkspace = new GitWorkspace({ repoRoot: this.repoRoot });
    }
    return this.gitWorkspace;
  }

  status() {
    return {
      active: this._active,
      workspace: this.workspaceRoot,
      allow_git: process.env.EVOLUTION_ALLOW_GIT === 'true',
      allow_execute: process.env.EVOLUTION_ALLOW_EXECUTE === 'true',
      emergency_stop: this.runStore ? this.runStore.isEmergencyStop() : false,
    };
  }

  stop() {
    if (this.runStore) this.runStore.setEmergencyStop('operator_stop');
    const prev = this._active;
    this._active = null;
    if (prev?.run_id && this.runStore) {
      this.runStore.transition(prev.run_id, 'cancelled', { cancel_reason: 'operator_stop' });
    }
    return { stopped: Boolean(prev), previous: prev, emergency_stop: true };
  }

  /**
   * @param {object} item backlog item
   * @param {object} opts
   */
  async execute(item, opts = {}) {
    if (this.runStore?.isEmergencyStop()) {
      return { ok: false, error: 'emergency_stop', message: 'Evolution emergency stop is active.' };
    }

    const idempotencyKey = opts.idempotency_key || opts.idempotencyKey || null;
    if (this.runStore && idempotencyKey) {
      const existing = this.runStore.findByIdempotency(idempotencyKey);
      if (existing && ['running', 'verifying', 'ready_for_review', 'failed', 'rolled_back'].includes(existing.state)) {
        return { ok: existing.state === 'ready_for_review', duplicate: true, run: existing, attemptId: existing.attempt_id };
      }
    }

    if (this._active) {
      return { ok: false, error: 'execution_in_progress', active: this._active };
    }

    const workspaceRel = `${path.relative(this.repoRoot, this.workspaceRoot).replace(/\\/g, '/')}/`;
    const contract = opts.contract || buildApprovalContract(item, {
      repoRoot: this.repoRoot,
      baseSha: opts.baseSha || this.getBaseSha(),
      operatorId: opts.operatorId,
      workspaceRel,
    });
    if (!contract.allowed_paths?.includes(workspaceRel)) {
      contract.allowed_paths = [workspaceRel, ...(contract.allowed_paths || [])];
    }

    const contractCheck = validateApprovalContract(contract, {
      approved: opts.approved,
      currentBaseSha: opts.baseSha || this.getBaseSha(),
    });
    if (!contractCheck.ok) {
      return { ok: false, error: contractCheck.code, item_id: item.id, contractCheck };
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

    let run = null;
    if (this.runStore) {
      if (opts.run_id) {
        run = this.runStore.get(opts.run_id);
        if (!run) return { ok: false, error: 'run_not_found', run_id: opts.run_id };
        if (['ready_for_review', 'failed', 'rolled_back', 'cancelled'].includes(run.state)) {
          return { ok: run.state === 'ready_for_review', duplicate: true, run };
        }
      } else {
        const created = this.runStore.createRun({
          idempotency_key: idempotencyKey,
          contract,
          item_id: item.id,
          initiator: opts.operatorId || 'evolution-engine',
        });
        run = created.run;
        if (created.duplicate) {
          return { ok: run.state === 'ready_for_review', duplicate: true, run };
        }
      }
      if (run.state === 'proposed') this.runStore.transition(run.run_id, 'approved');
      const workerId = opts.workerId || `worker-${process.pid}`;
      const lease = this.runStore.claimLease(run.run_id, workerId);
      if (!lease.ok) return { ok: false, error: lease.error, run };
      this.runStore.transition(run.run_id, 'running');
      run = lease.run;
    }

    const attemptId = randomBytes(6).toString('hex');
    this._active = { attemptId, item_id: item.id, run_id: run?.run_id, started_at: new Date().toISOString() };
    fs.mkdirSync(this.workspaceRoot, { recursive: true });

    const relPatch = path.join('patches', `${attemptId}.txt`);
    const relFromRepo = path.relative(this.repoRoot, path.join(this.workspaceRoot, relPatch)).replace(/\\/g, '/');
    const pathCheck = assertPathAllowed(relFromRepo, contract);
    if (!pathCheck.ok) {
      if (run && this.runStore) this.runStore.transition(run.run_id, 'blocked', { block_reason: pathCheck.code });
      this._active = null;
      return { ok: false, error: pathCheck.code, path: relPatch };
    }

    this.rollback.snapshot(relPatch, attemptId);
    const patchBody = `# Evolution patch ${attemptId}\n# Item: ${item.id}\n# ${item.title}\n`;
    fs.mkdirSync(path.dirname(path.join(this.workspaceRoot, relPatch)), { recursive: true });
    fs.writeFileSync(path.join(this.workspaceRoot, relPatch), patchBody);

    const frozenContract = contract.verification_contract;
    if (this.runStore && run) this.runStore.transition(run.run_id, 'verifying', { attempt_id: attemptId });

    const verification = await this.verify.verify({
      baseline: opts.baseline,
      testFiles: opts.testFiles || frozenContract?.test_files,
      regressionProbe: opts.regressionProbe,
      regressionInjected: opts.regressionInjected === true,
      afterMetrics: opts.afterMetrics,
      frozenContract,
      testIntegrityBefore: opts.testIntegrityBefore,
      testIntegrityAfter: opts.testIntegrityAfter,
    });

    const recovery = {
      categories: ['code'],
      git_instructions: this.rollback.instructionsGit(attemptId, opts.branchName),
      data_effects: 'none — workspace-only patch file',
    };

    let outcome;
    if (!verification.ok) {
      const rb = this.rollback.rollback(attemptId);
      outcome = 'rolled_back';
      const evidenceWrite = this.evidence.write({
        run_id: run?.run_id || attemptId,
        initiator: opts.operatorId || 'evolution-engine',
        approvals: { approved: true, contract },
        base_sha: contract.base_sha,
        candidate_sha: null,
        verification,
        recovery,
        outcome: 'rolled_back',
        rollback: rb,
        limitations: verification.checks.filter((c) => !c.ok).map((c) => c.name),
      });
      if (run && this.runStore) {
        this.runStore.transition(run.run_id, 'rolled_back', {
          attempt_id: attemptId,
          evidence_path: evidenceWrite.path,
        });
      }
      this.memory.record('improvement_failed', { attemptId, run_id: run?.run_id, item, verification, rollback: rb, evidence: evidenceWrite });
      this._active = null;
      return {
        ok: false,
        attemptId,
        run_id: run?.run_id,
        verification,
        rollback: rb,
        outcome,
        recovery_complete: rb.ok,
        evidence: evidenceWrite,
      };
    }

    let gitOutcome = null;
    const evidenceDraft = {
      run_id: run?.run_id || attemptId,
      initiator: opts.operatorId || 'evolution-engine',
      approvals: { approved: true, contract, approve_pr: opts.approve_pr === true },
      base_sha: contract.base_sha,
      verification,
      recovery,
      outcome: 'ready_for_review',
      limitations: [],
    };
    if (opts.useGit && process.env.EVOLUTION_ALLOW_GIT === 'true') {
      const git = this._git();
      if (git) {
        const prBody = path.join(this.evidence.evolutionRoot || path.dirname(this.evidence.rootDir), 'evidence', `_pr_body_${attemptId}.md`);
        fs.mkdirSync(path.dirname(prBody), { recursive: true });
        fs.writeFileSync(prBody, `# Evolution ${run?.run_id || attemptId}\n\n${item.title}\n`);
        gitOutcome = await git.applyPatchAndOptionalPr({
          runId: run?.run_id || attemptId,
          baseSha: contract.base_sha || this.getBaseSha(),
          patchRelPath: path.join('docs', 'evolution-runs', `${run?.run_id || attemptId}.md`),
          patchBody: patchBody,
          createPr: opts.approve_pr === true,
          prBodyPath: prBody,
          prTitle: `evolution: ${item.code || item.id}`,
        });
        evidenceDraft.git = gitOutcome;
        evidenceDraft.candidate_branch = gitOutcome.branch || null;
        evidenceDraft.pr_url = gitOutcome.pr_url || null;
      }
    } else if (opts.approve_pr) {
      evidenceDraft.pr_blocked = 'EVOLUTION_ALLOW_GIT and useGit required for PR creation';
    }

    const evidenceWrite = this.evidence.write(evidenceDraft);
    if (run && this.runStore) {
      this.runStore.transition(run.run_id, 'ready_for_review', {
        attempt_id: attemptId,
        evidence_path: evidenceWrite.path,
        pr_url: evidenceDraft.pr_url || null,
      });
    }
    this.memory.record('improvement_applied', { attemptId, run_id: run?.run_id, item, verification, patch: relPatch, evidence: evidenceWrite, git: gitOutcome });
    outcome = 'verified';
    this._active = null;
    return {
      ok: true,
      attemptId,
      run_id: run?.run_id,
      verification,
      outcome,
      evidence: evidenceWrite,
      approval_scope: contract.approval_scope,
      git: gitOutcome,
    };
  }

  rollbackAttempt(attemptId, opts = {}) {
    if (!opts.approved) {
      return { ok: false, error: 'approval_required' };
    }
    const rb = this.rollback.rollback(attemptId);
    const recovery_complete = rb.ok;
    this.memory.record('manual_rollback', { attemptId, rollback: rb, recovery_complete });
    return { ok: rb.ok, recovery_complete, ...rb };
  }
}

module.exports = { ExecutionCoordinator };
