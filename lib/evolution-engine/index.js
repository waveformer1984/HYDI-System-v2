'use strict';

const path = require('path');
const { execFileSync } = require('child_process');
const { EvolutionMemory } = require('./evolution-memory');
const { SystemObserver } = require('./system-observer');
const { CapabilityAuditor } = require('./capability-auditor');
const { PerformanceAnalyzer } = require('./performance-analyzer');
const { MemoryAuditor } = require('./memory-auditor');
const { SecurityAuditor } = require('./security-auditor');
const { SourceQualityAuditor } = require('./source-quality-auditor');
const { DependencyAuditor } = require('./dependency-auditor');
const { AuthAuditor } = require('./auth-auditor');
const { ImprovementPlanner } = require('./improvement-planner');
const { VerificationEngine } = require('./verification-engine');
const { RollbackManager } = require('./rollback-manager');
const { ExecutionCoordinator } = require('./execution-coordinator');
const { EvolutionRunStore } = require('./run-store');
const { EvidenceBundle } = require('./evidence-bundle');
const { MetricsTrendStore } = require('./metrics-trends');
const { buildArchitectureAudit } = require('./architecture-audit');
const { buildApprovalContract } = require('./approval-contract');

/**
 * Autonomous evolution engine facade — composes existing evolution/ + observation modules.
 * @param {object} [opts]
 */
function createEvolutionEngine(opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  const evolutionRoot = opts.memoryDir || path.join(repoRoot, '.runtime', 'evolution');
  const memory = opts.memory || new EvolutionMemory({ rootDir: evolutionRoot });
  const workspaceRoot = opts.workspaceRoot || path.join(evolutionRoot, 'workspace');
  const runStore = opts.runStore || new EvolutionRunStore({ rootDir: path.join(evolutionRoot, 'runs') });
  const trends = opts.trends || new MetricsTrendStore({ rootDir: evolutionRoot });

  const getBaseSha = opts.getBaseSha || (() => {
    try {
      return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', timeout: 3000 }).trim();
    } catch {
      return null;
    }
  });

  const observer = new SystemObserver({
    repoRoot,
    probeUrl: opts.probeUrl,
  });
  const capabilityAuditor = new CapabilityAuditor();
  const performance = new PerformanceAnalyzer();
  const memoryAuditor = new MemoryAuditor({ runMemoryAudit: opts.runMemoryAudit });
  const securityAuditor = new SecurityAuditor();
  const sourceQuality = new SourceQualityAuditor({ repoRoot });
  const dependencyAuditor = new DependencyAuditor({ repoRoot });
  const authAuditor = new AuthAuditor();
  const planner = new ImprovementPlanner();
  const verification = new VerificationEngine({ repoRoot, execFile: opts.execFile });
  const rollback = new RollbackManager({ workspaceRoot });
  const coordinator = new ExecutionCoordinator({
    repoRoot,
    workspaceRoot,
    rollback,
    verify: verification,
    memory,
    runStore,
    evidence: opts.evidence || new EvidenceBundle({ rootDir: path.join(evolutionRoot, 'evidence') }),
    getBaseSha,
  });

  let lastAudit = null;
  let lastPlan = null;
  let lastArchitectureAudit = null;

  async function runAudit(role = 'owner') {
    const observation = await observer.collect();
    trends.append({
      ...observation,
      pipeline: opts.pipelineEvents?.length
        ? { event_count: opts.pipelineEvents.length, status: 'measured' }
        : { status: 'not_measured' },
    });
    memory.record('observation', { observation });

    const cap = capabilityAuditor.auditCapabilities(role);
    const fix = capabilityAuditor.auditFixList(opts.fixListInputs || {});
    const mem = await memoryAuditor.audit();
    if (mem.memory_retrieval_accuracy != null && mem.memory_retrieval_accuracy !== 'not_measured') {
      trends.append({
        ts: new Date().toISOString(),
        memory_retrieval_accuracy: mem.memory_retrieval_accuracy,
        host: observation.host,
      });
    }
    const sec = securityAuditor.audit();
    const src = sourceQuality.audit();
    const dep = dependencyAuditor.audit();
    const auth = authAuditor.audit();

    const perfEvents = opts.pipelineEvents || [];
    const perf = performance.analyzeEvents(perfEvents, opts.performanceOpts);

    const findings = [
      ...cap.findings,
      ...fix.findings,
      ...(mem.findings || []),
      ...sec.findings,
      ...src.findings,
      ...dep.findings,
      ...auth.findings,
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
      trends_recent: trends.readRecent(5),
    };
    memory.record('audit_complete', { counts: lastAudit.counts });
    memory.saveSnapshot('last_audit', lastAudit);
    return lastAudit;
  }

  function generatePlan() {
    if (!lastAudit) return { ok: false, error: 'no_audit', hint: 'Run audit first.' };
    lastPlan = planner.plan(lastAudit.findings);
    const baseSha = getBaseSha();
    lastPlan.backlog = lastPlan.backlog.map((item) => ({
      ...item,
      approval_contract_preview: buildApprovalContract(item, { repoRoot, baseSha }),
    }));
    memory.record('plan_generated', { backlog_size: lastPlan.backlog.length });
    memory.saveSnapshot('last_plan', lastPlan);
    return { ok: true, ...lastPlan };
  }

  function runArchitectureAudit() {
    lastArchitectureAudit = buildArchitectureAudit(repoRoot);
    lastArchitectureAudit.base_sha = lastArchitectureAudit.base_sha || getBaseSha();
    memory.record('architecture_audit', { base_sha: lastArchitectureAudit.base_sha });
    memory.saveSnapshot('architecture_audit', lastArchitectureAudit);
    return lastArchitectureAudit;
  }

  function status() {
    return {
      engine: 'evolution-engine',
      version: 2,
      last_audit_at: lastAudit?.generated_at || null,
      last_plan_at: lastPlan?.generated_at || null,
      last_architecture_audit_at: lastArchitectureAudit?.generated_at || null,
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
    runArchitectureAudit,
    getRun: (runId) => runStore.get(runId),
    executeImprovement: (itemId, execOpts) => {
      if (!lastPlan?.backlog?.length) {
        return Promise.resolve({ ok: false, error: 'no_plan' });
      }
      const item = lastPlan.backlog.find((b) => b.id === itemId) || lastPlan.backlog[0];
      return coordinator.execute(item, { ...execOpts, itemId, run_id: execOpts.run_id });
    },
    stopExecution: () => coordinator.stop(),
    clearEmergencyStop: () => runStore.clearEmergencyStop(),
    rollback: (attemptId, opts) => coordinator.rollbackAttempt(attemptId, opts),
    verify: (ctx) => verification.verify(ctx),
    getHistory: (limit) => memory.readHistory(limit),
    getLastAudit: () => lastAudit,
    getLastPlan: () => lastPlan,
    getArchitectureAudit: () => lastArchitectureAudit,
    _components: {
      memory,
      coordinator,
      verification,
      runStore,
      trends,
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
  DependencyAuditor,
  AuthAuditor,
  ImprovementPlanner,
  VerificationEngine,
  RollbackManager,
  ExecutionCoordinator,
  EvolutionRunStore,
  EvidenceBundle,
  buildArchitectureAudit,
};
