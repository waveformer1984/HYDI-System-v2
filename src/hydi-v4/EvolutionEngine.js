'use strict';

const fs = require('fs').promises;
const path = require('path');
const HModule = require('./HModule');
const AutonomousEngineering = require('./AutonomousEngineering');
const Scorecard = require('./Scorecard');
const ProtoForgeFactory = require('./ProtoForgeFactory');

class EvolutionEngine extends HModule {
  constructor(kernel, manifest = {}) {
    super(kernel, {
      id: manifest.id || 'evolution-engine',
      name: manifest.name || 'Evolution Engine',
      version: manifest.version || '1.0.0',
      capabilities: ['evolution.observe', 'evolution.plan', 'evolution.validate', 'evolution.learn'],
      dependencies: ['autonomous-engineering', 'scorecard', 'protoforge'],
      ...manifest,
    });
    this.config = {
      intervalMs: manifest.intervalMs || 300000,
      historyPath: manifest.historyPath || path.join(kernel.config.dataPath, 'evolution', 'history.json'),
      maxHistory: manifest.maxHistory || 500,
      autoStart: manifest.autoStart === true,
      ...manifest,
    };
    this.engineering = manifest.engineering || new AutonomousEngineering(kernel, manifest.engineeringOptions);
    this.scorecard = manifest.scorecard || new Scorecard(kernel, manifest.scorecardOptions);
    this.factory = manifest.factory || new ProtoForgeFactory(kernel, manifest.factoryOptions);
    this.validator = manifest.validator || null;
    this.history = [];
    this.queues = { immediate: [], nextSprint: [], longTerm: [] };
    this.plans = new Map();
    this._timer = null;
    this._running = false;
  }

  async initialize() {
    await super.initialize();
    await this._loadHistory();
  }

  async start() {
    await super.start();
    this._running = true;
    if (this.config.autoStart) {
      this._timer = setInterval(() => this.runCycle().catch((error) => this._recordFailure(error)), this.config.intervalMs);
      if (this._timer.unref) this._timer.unref();
    }
  }

  async stop() {
    this._running = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    await super.stop();
  }

  async dispose() {
    await this.stop();
    await super.dispose();
  }

  async observe() {
    const audit = await this.engineering.auditRepository();
    const health = this.kernel.healthMonitor.getLast();
    const scorecard = await this.scorecard.evaluate({
      auditor: { auditRepository: () => Promise.resolve(audit) },
      health,
    });
    const systemIntelligence = this.kernel.moduleRegistry.get('system-intelligence');
    const system = systemIntelligence?.getSnapshot?.() || {};
    const state = {
      observedAt: new Date().toISOString(),
      kernel: this.kernel.getStatus(),
      health,
      system,
      audit,
      scorecard,
    };
    await this.kernel.remember('evolution:latest-state', state, { namespace: 'evolution' });
    this.publish('evolution.observed', { score: scorecard.overall, issues: audit.issueCounts });
    return state;
  }

  prioritize(state) {
    const issues = state.audit.issueCounts || {};
    const scores = state.scorecard.scores || {};
    const candidates = [
      this._candidate('reliability.timer-leaks', 'reliability', issues.timerLeaks || 0, 100, 'Remove timer leaks and prove clean shutdown.'),
      this._candidate('reliability.resource-leaks', 'reliability', issues.resourceLeaks || 0, 90, 'Bound external resources and verify cleanup.'),
      this._candidate('architecture.circular-imports', 'architecture', issues.circularImports || 0, 95, 'Remove circular dependency edges through Kernel interfaces.'),
      this._candidate('architecture.duplicate-logic', 'maintainability', issues.duplicateLogic || 0, 60, 'Extract verified shared behavior without changing contracts.'),
      this._candidate('technical-debt.dead-code', 'maintainability', issues.deadCode || 0, 35, 'Verify unused exports and remove only confirmed dead code.'),
      this._candidate('score.offline-readiness', 'offline', Math.max(0, 90 - (scores.offlineReadiness || 0)), 2, 'Add and pass deterministic offline validation.'),
      this._candidate('score.commercial-readiness', 'commercial', Math.max(0, 80 - (scores.commercialReadiness || 0)), 1, 'Generate and validate a ProtoForge commercialization plan.'),
    ].filter((candidate) => candidate.impact > 0);

    candidates.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    this.queues = {
      immediate: candidates.filter((candidate) => candidate.priority >= 80),
      nextSprint: candidates.filter((candidate) => candidate.priority >= 35 && candidate.priority < 80),
      longTerm: candidates.filter((candidate) => candidate.priority < 35),
    };
    return this.getQueues();
  }

  design(candidate, state) {
    const plan = {
      id: `plan:${candidate.id}:${Date.parse(state.observedAt)}`,
      status: 'proposed',
      createdAt: new Date().toISOString(),
      candidate,
      evidence: {
        audit: state.audit.issueCounts,
        scores: state.scorecard.scores,
      },
      architectureReview: `Confirm ${candidate.id} preserves Kernel ownership, module boundaries, and acyclic dependencies.`,
      dependencyReview: 'Identify affected modules and validate capability contracts before implementation.',
      securityReview: 'Run the security audit and preserve local-first secret handling.',
      performancePrediction: `Expected quality gain is proportional to priority ${candidate.priority}; reject measurable regressions.`,
      rollbackStrategy: 'Revert the isolated change set and restore the prior validated artifact.',
      migrationStrategy: 'No migration unless persistent state or public contracts change; otherwise document a reversible migration.',
      testPlan: ['unit', 'integration', 'regression', 'open-handle detection', 'release validation'],
      documentationPlan: ['architecture decision', 'operator runbook', 'release note'],
      validationPlan: ['architecture', 'security', 'performance', 'offline', 'release'],
    };
    this.plans.set(plan.id, plan);
    return plan;
  }

  approve(planId) {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`plan not found: ${planId}`);
    plan.status = 'approved';
    plan.approvedAt = new Date().toISOString();
    return plan;
  }

  async executeApproved(planId, executor) {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`plan not found: ${planId}`);
    if (plan.status !== 'approved') throw new Error('plan requires explicit approval');
    if (typeof executor !== 'function') throw new Error('executor is required');
    if (!this.hasPermission('execute', 'evolution')) throw new Error('evolution execution permission denied');

    const validation = this.validator ? await this.validator(plan) : { passed: true, skipped: true };
    if (!validation.passed) {
      return this._learn({ plan, status: 'rejected', validation, result: null });
    }
    const result = await executor(plan);
    return this._learn({ plan, status: 'completed', validation, result });
  }

  async runCycle() {
    const state = await this.observe();
    const queues = this.prioritize(state);
    const candidate = queues.immediate[0] || queues.nextSprint[0] || queues.longTerm[0] || null;
    const plan = candidate ? this.design(candidate, state) : null;
    const outcome = { state, queues, plan };
    this.publish('evolution.planned', { planId: plan?.id || null, candidate: candidate?.id || null });
    return outcome;
  }

  async productize(moduleId) {
    const module = this.kernel.moduleRegistry.get(moduleId);
    if (!module) throw new Error(`module not found: ${moduleId}`);
    return this.factory.generateForModule(module);
  }

  getQueues() {
    return {
      immediate: [...this.queues.immediate],
      nextSprint: [...this.queues.nextSprint],
      longTerm: [...this.queues.longTerm],
    };
  }

  async health() {
    return {
      healthy: this._running,
      initialized: this._initialized,
      queues: Object.fromEntries(Object.entries(this.queues).map(([key, value]) => [key, value.length])),
      history: this.history.length,
    };
  }

  _candidate(id, dimension, impact, weight, objective) {
    return { id, dimension, impact, priority: weight + Math.min(impact, 10), objective };
  }

  async _learn(entry) {
    const record = { ...entry, completedAt: new Date().toISOString() };
    this.history.push(record);
    if (this.history.length > this.config.maxHistory) this.history.splice(0, this.history.length - this.config.maxHistory);
    await this._saveHistory();
    await this.kernel.remember(`evolution:history:${this.history.length}`, record, { namespace: 'evolution' });
    this.publish('evolution.learned', { planId: entry.plan.id, status: entry.status });
    return record;
  }

  async _recordFailure(error) {
    await this._learn({ plan: { id: 'cycle' }, status: 'failed', validation: null, result: { error: error.message } });
  }

  async _loadHistory() {
    try {
      const raw = await fs.readFile(this.config.historyPath, 'utf8');
      const history = JSON.parse(raw);
      this.history = Array.isArray(history) ? history.slice(-this.config.maxHistory) : [];
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  async _saveHistory() {
    await fs.mkdir(path.dirname(this.config.historyPath), { recursive: true });
    await fs.writeFile(this.config.historyPath, JSON.stringify(this.history, null, 2));
  }
}

module.exports = EvolutionEngine;
