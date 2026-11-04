'use strict';

const path = require('path');
const { EvolutionMemory } = require('./evolution-memory');
const { SystemObserver } = require('./system-observer');
const { CapabilityAuditor } = require('./capability-auditor');
const { PerformanceAnalyzer } = require('./performance-analyzer');
const { MemoryAuditor } = require('./memory-auditor');
const { SecurityAuditor } = require('./security-auditor');
const { SourceQualityAuditor } = require('./source-quality-auditor');
const { ImprovementPlanner } = require('./improvement-planner');
const { VerificationEngine } = require('./verification-engine');
const { RollbackManager } = require('./rollback-manager');
const { ExecutionCoordinator } = require('./execution-coordinator');

/**
 * Autonomous evolution engine facade — composes existing evolution/ + observation modules.
 * @param {object} [opts]
 */
function createEvolutionEngine(opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  const memory = opts.memory || new EvolutionMemory({ rootDir: opts.memoryDir });
  const workspaceRoot = opts.workspaceRoot || path.join(repoRoot, '.runtime', 'evolution', 'workspace');

  const observer = new SystemObserver({
    repoRoot,
    probeUrl: opts.probeUrl,
  });
  const capabilityAuditor = new CapabilityAuditor();
  const performance = new PerformanceAnalyzer();
  const memoryAuditor = new MemoryAuditor({ runMemoryAudit: opts.runMemoryAudit });
  const securityAuditor = new SecurityAuditor();
  const sourceQuality = new SourceQualityAuditor({ repoRoot });
  const planner = new ImprovementPlanner();
  const verification = new VerificationEngine({ repoRoot, execFile: opts.execFile });
  const rollback = new RollbackManager({ workspaceRoot });
  const coordinator = new ExecutionCoordinator({
    repoRoot,
    workspaceRoot,
    rollback,
    verify: verification,
    memory,
  });

  let lastAudit = null;
  let lastPlan = null;

  async function runAudit(role = 'owner') {
    const observation = await observer.collect();
    memory.record('observation', { observation });

    const cap = capabilityAuditor.auditCapabilities(role);
    const fix = capabilityAuditor.auditFixList(opts.fixListInputs || {});
    const mem = await memoryAuditor.audit();
    const sec = securityAuditor.audit();
    const src = sourceQuality.audit();

    const perfEvents = opts.pipelineEvents || [];
    const perf = performance.analyzeEvents(perfEvents, opts.performanceOpts);

    const findings = [
      ...cap.findings,
      ...fix.findings,
      ...(mem.findings || []),
      ...sec.findings,
      ...src.findings,
      ...(perf.findings || []).map((f) => ({
        ...f,
        subsystem: f.subsystem || 'pipeline',
        remediation: f.remediation || 'Review pipeline telemetry and CASCADE/ProtoForge logs.',
      })),
    ];

    if (observation.host.freemem_mb != null && observation.host.freemem_mb < 512) {
      findings.push({
        severity: 'high',
        subsystem: 'host',
        code: 'low_freemem',
        message: `Free memory ${observation.host.freemem_mb}MB — risk of OOM during builds.`,
        evidence: { freemem_mb: observation.host.freemem_mb },
        remediation: 'Run storage guard / reduce parallel workers / free caches.',
      });
    }

    lastAudit = {
      generated_at: new Date().toISOString(),
      observation,
      performance: perf,
      findings,
      counts: { total: findings.length, high: findings.filter((f) => f.severity === 'high').length },
    };
    memory.record('audit_complete', { counts: lastAudit.counts });
    memory.saveSnapshot('last_audit', lastAudit);
    return lastAudit;
  }

  function generatePlan() {
    if (!lastAudit) return { ok: false, error: 'no_audit', hint: 'Run audit first.' };
    lastPlan = planner.plan(lastAudit.findings);
    memory.record('plan_generated', { backlog_size: lastPlan.backlog.length });
    memory.saveSnapshot('last_plan', lastPlan);
    return { ok: true, ...lastPlan };
  }

  function status() {
    return {
      engine: 'evolution-engine',
      version: 1,
      last_audit_at: lastAudit?.generated_at || null,
      last_plan_at: lastPlan?.generated_at || null,
      finding_count: lastAudit?.counts?.total ?? null,
      backlog_size: lastPlan?.backlog?.length ?? null,
      coordinator: coordinator.status(),
      history_tail: memory.readHistory(5),
    };
  }

  return {
    status,
    runAudit,
    generatePlan,
    executeImprovement: (itemId, execOpts) => {
      if (!lastPlan?.backlog?.length) {
        return Promise.resolve({ ok: false, error: 'no_plan' });
      }
      const item = lastPlan.backlog.find((b) => b.id === itemId) || lastPlan.backlog[0];
      return coordinator.execute(item, { ...execOpts, itemId });
    },
    stopExecution: () => coordinator.stop(),
    rollback: (attemptId, opts) => coordinator.rollbackAttempt(attemptId, opts),
    verify: (ctx) => verification.verify(ctx),
    getHistory: (limit) => memory.readHistory(limit),
    getLastAudit: () => lastAudit,
    getLastPlan: () => lastPlan,
    _components: {
      memory,
      coordinator,
      verification,
    },
  };
}

module.exports = {
  createEvolutionEngine,
  EvolutionMemory,
  SystemObserver,
  CapabilityAuditor,
  PerformanceAnalyzer,
  MemoryAuditor,
  SecurityAuditor,
  SourceQualityAuditor,
  ImprovementPlanner,
  VerificationEngine,
  RollbackManager,
  ExecutionCoordinator,
};
