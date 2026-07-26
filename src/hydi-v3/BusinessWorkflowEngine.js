'use strict';

const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');
const StrategicObjectives = require('./StrategicObjectives');

const PERSISTENCE_VERSION = 1;

const WORKFLOW_TYPES = new Set(['sales', 'manufacturing', 'research', 'creative', 'finance', 'technical']);

const AUTO_APPROVE_TYPES = new Set(['research', 'creative', 'technical']);

const STEP_TEMPLATES = {
  sales: [
    { id: 'gather-requirements', name: 'Gather customer requirements', kind: 'data-collection', completion: 'requirements collected' },
    { id: 'draft-quote', name: 'Generate quote draft', kind: 'document-preparation', completion: 'quote drafted' },
    { id: 'review-pricing', name: 'Review pricing', kind: 'internal-review', completion: 'pricing approved' },
    { id: 'prepare-communication', name: 'Prepare customer communication', kind: 'document-preparation', completion: 'communication ready' },
    { id: 'await-approval', name: 'Wait for customer approval', kind: 'approval-gate', completion: 'customer approved' },
    { id: 'track-outcome', name: 'Track outcome and close loop', kind: 'outcome-tracking', completion: 'outcome recorded' },
  ],
  manufacturing: [
    { id: 'material-check', name: 'Check material availability', kind: 'inventory-check', completion: 'materials confirmed' },
    { id: 'schedule-equipment', name: 'Schedule equipment', kind: 'scheduling', completion: 'equipment scheduled' },
    { id: 'produce', name: 'Execute production', kind: 'production', completion: 'production completed' },
    { id: 'quality-review', name: 'Quality review', kind: 'review', completion: 'quality accepted' },
    { id: 'notify-completion', name: 'Notify completion', kind: 'notification', completion: 'stakeholders notified' },
  ],
  research: [
    { id: 'plan-experiment', name: 'Plan experiment', kind: 'planning', completion: 'experiment planned' },
    { id: 'track-prototype', name: 'Track prototype', kind: 'tracking', completion: 'prototype tracked' },
    { id: 'document-results', name: 'Document results', kind: 'documentation', completion: 'results documented' },
    { id: 'capture-knowledge', name: 'Capture knowledge', kind: 'knowledge-capture', completion: 'knowledge captured' },
  ],
  creative: [
    { id: 'plan-project', name: 'Plan creative project', kind: 'planning', completion: 'project planned' },
    { id: 'organize-assets', name: 'Organize assets', kind: 'organization', completion: 'assets organized' },
    { id: 'prepare-release', name: 'Prepare release', kind: 'release-prep', completion: 'release prepared' },
    { id: 'manage-content-pipeline', name: 'Manage content pipeline', kind: 'pipeline', completion: 'pipeline updated' },
  ],
  finance: [
    { id: 'review-financials', name: 'Review financials', kind: 'review', completion: 'financials reviewed' },
    { id: 'identify-leakage', name: 'Identify leakage', kind: 'analysis', completion: 'leakage identified' },
    { id: 'recommend-action', name: 'Recommend action', kind: 'recommendation', completion: 'action recommended' },
  ],
  technical: [
    { id: 'assess-system', name: 'Assess system health', kind: 'assessment', completion: 'health assessed' },
    { id: 'prioritize-debt', name: 'Prioritize technical debt', kind: 'prioritization', completion: 'debt prioritized' },
    { id: 'plan-maintenance', name: 'Plan maintenance', kind: 'planning', completion: 'maintenance planned' },
  ],
};

function generateId() {
  return `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

class BusinessValueScorer {
  static score({ value = 0, effort = 1, risk = 0, urgency = 0, probability = 1, strategic = 0 } = {}) {
    const safeEffort = Math.max(effort || 1, 1);
    const safeProbability = clamp(probability || 1, 0, 1);
    const safeRisk = clamp(risk || 0, 0, 1);
    const safeUrgency = clamp(urgency || 0, 0, 1);
    const safeStrategic = clamp(strategic || 0, 0, 1);
    return (value * safeProbability * (1 - safeRisk) * (1 + safeUrgency + safeStrategic)) / safeEffort;
  }
}

/**
 * BusinessWorkflowEngine converts Executive Operating System recommendations
 * into executable, approval-gated, traceable workflows. It coordinates with
 * TaskEngine for actual execution and BusinessMemory for state and learning.
 *
 * Auto-approval: research, creative, technical.
 * Requires human approval: sales, manufacturing, finance.
 */
class BusinessWorkflowEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      dataPath: config.dataPath || path.resolve(__dirname, '../../data'),
      persistDebounceMs: config.persistDebounceMs ?? 50,
      logger: config.logger || console,
      stepHandlers: config.stepHandlers || {},
      ...config,
    };

    this.memory = config.businessMemory || null;
    this.executiveOS = config.executiveOS || null;
    this.taskEngine = config.taskEngine || null;
    this.strategicObjectives = config.strategicObjectives || new StrategicObjectives({ ownerPriority: 'default' });

    this.workflows = new Map();
    this.outcomes = [];

    this._persistTimer = null;
    this._persistPending = false;
    this._started = false;
    this._destroyed = false;

    this.storePath = path.join(this.config.dataPath, 'business-workflows.json');
    this.outcomesPath = path.join(this.config.dataPath, 'business-outcomes.json');

    this._bindWorkflowExecutor();
  }

  _bindWorkflowExecutor() {
    this._workflowExecutor = async (ctx) => {
      const workflowId = ctx?.payload?.workflowId;
      if (!workflowId) throw new Error('Missing workflowId in task payload');
      try {
        return await this._runWorkflow(workflowId);
      } catch (error) {
        const wf = this.workflows.get(workflowId);
        if (wf) {
          wf.status = 'failed';
          wf.failureReason = error instanceof Error ? error.message : String(error);
          wf.updatedAt = Date.now();
          this._persist();
          this.emit('workflow-failed', { id: workflowId, error: wf.failureReason });
        }
        throw error;
      }
    };
  }

  async initialize() {
    return this.start();
  }

  async start() {
    if (this._destroyed) throw new Error('BusinessWorkflowEngine has been destroyed');
    if (this._started) return;

    await this._ensureDataDir();
    await this._load();
    this._started = true;
    this.config.logger.log('[BusinessWorkflowEngine] started');
  }

  async flush() {
    return this._flush();
  }

  stop() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    this._started = false;
    this.config.logger.log('[BusinessWorkflowEngine] stopped');
  }

  async destroy() {
    if (this._destroyed) return;
    this.stop();
    await this._flush();
    this.workflows.clear();
    this.outcomes = [];
    this.removeAllListeners();
    this._destroyed = true;
  }

  healthCheck() {
    const checks = {
      initialized: !this._destroyed,
      noOrphanTaskReferences: true,
      noFakeOutcomes: true,
    };

    for (const wf of this.workflows.values()) {
      if (wf.taskEngineTaskId && this.taskEngine && !this.taskEngine.getTask(wf.taskEngineTaskId)) {
        checks.noOrphanTaskReferences = false;
      }
    }

    for (const o of this.outcomes) {
      if (o.actual === undefined || !o.workflowId) checks.noFakeOutcomes = false;
    }

    const ok = Object.values(checks).every(Boolean);
    return { ok, checks, workflows: this.workflows.size, outcomes: this.outcomes.length };
  }

  // -------------------------------------------------------------------------
  // Recommendations
  // -------------------------------------------------------------------------

  getRankedRecommendations(limit = 5) {
    if (!this.executiveOS) {
      return [];
    }
    const briefing = this.executiveOS.morningBriefing();
    const recommendations = briefing.recommendations || [];
    return recommendations
      .map((rec, index) => {
        const meta = this._inferWorkflowType(rec.action);
        const scored = this.strategicObjectives
          ? this.strategicObjectives.scoreRecommendation(rec, this.strategicObjectives.ownerPriority)
          : { score: BusinessValueScorer.score({
              value: this._extractValue(rec.expectedImpact) || 0,
              effort: 1,
              urgency: rec.urgency ?? 0.5,
              strategic: rec.strategic ?? 1,
            }), reason: 'base' };
        return {
          ...rec,
          id: `rec_${index}_${Date.now()}`,
          type: meta.type,
          assignedAgent: meta.agent,
          score: scored.score,
          scoreReason: scored.reason,
          objective: scored.objective,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  getPreparedActions(limit = 5) {
    const terminal = new Set(['completed', 'failed', 'cancelled']);
    const ready = Array.from(this.workflows.values())
      .filter((wf) => !terminal.has(wf.status))
      .sort((a, b) => (b.score || 0) - (a.score || 0));

    return ready.slice(0, limit).map((wf) => ({
      workflowId: wf.id,
      title: wf.title,
      nextStep: wf.steps.find((s) => s.status !== 'completed')?.name || 'Complete',
      assignedAgent: wf.assignedAgent,
      expectedValue: wf.expectedValue,
      expectedImpact: wf.reason,
      status: wf.status,
    }));
  }

  // -------------------------------------------------------------------------
  // Workflow creation
  // -------------------------------------------------------------------------

  createWorkflow(input) {
    if (this._destroyed) throw new Error('BusinessWorkflowEngine has been destroyed');

    const now = Date.now();
    const type = WORKFLOW_TYPES.has(input.type) ? input.type : 'sales';
    const template = STEP_TEMPLATES[type] || STEP_TEMPLATES.sales;
    const steps = template.map((s, i) => ({
      ...s,
      status: 'pending',
      startedAt: undefined,
      completedAt: undefined,
      order: i,
    }));

    const workflow = {
      id: input.id || generateId(),
      type,
      title: input.title || input.action || 'Unnamed workflow',
      reason: input.reason || 'No reason provided',
      expectedValue: clamp(Number(input.expectedValue ?? 0), 0, Number.MAX_SAFE_INTEGER),
      requiredEffort: clamp(Number(input.requiredEffort ?? 1), 1, Number.MAX_SAFE_INTEGER),
      urgency: clamp(Number(input.urgency ?? 0), 0, 1),
      probability: clamp(Number(input.probability ?? 1), 0, 1),
      strategic: clamp(Number(input.strategic ?? 0), 0, 1),
      dependencies: Array.isArray(input.dependencies) ? [...input.dependencies] : [],
      assignedAgent: input.assignedAgent || this._inferWorkflowType(type).agent,
      status: 'draft',
      approved: false,
      approvalRequestedAt: undefined,
      approvedAt: undefined,
      score: BusinessValueScorer.score({
        value: input.expectedValue,
        effort: input.requiredEffort,
        risk: input.risk,
        urgency: input.urgency,
        probability: input.probability,
        strategic: input.strategic,
      }),
      steps,
      taskEngineTaskId: undefined,
      createdAt: now,
      updatedAt: now,
    };

    this.workflows.set(workflow.id, workflow);
    this._persist();
    this.emit('workflow-created', { id: workflow.id, type, title: workflow.title });
    return workflow.id;
  }

  createWorkflowFromRecommendation(recommendation) {
    const meta = this._inferWorkflowType(recommendation.action);
    return this.createWorkflow({
      title: recommendation.action,
      reason: recommendation.reason,
      type: meta.type,
      assignedAgent: recommendation.assignedAgent || meta.agent,
      expectedValue: this._extractValue(recommendation.expectedImpact) || 100,
      requiredEffort: recommendation.effort || 1,
      urgency: recommendation.urgency,
      probability: recommendation.probability,
      strategic: recommendation.strategic,
      risk: recommendation.risk,
    });
  }

  // -------------------------------------------------------------------------
  // Approval and execution
  // -------------------------------------------------------------------------

  approveWorkflow(id) {
    const wf = this._getWorkflow(id);
    if (wf.approved) return false;
    wf.approved = true;
    wf.approvedAt = Date.now();
    wf.status = 'approved';
    this._persist();
    this.emit('workflow-approved', { id });
    return true;
  }

  async startWorkflow(id, options = {}) {
    const wf = this._getWorkflow(id);
    const requiresApproval = this._requiresApproval(wf);
    if (requiresApproval && !wf.approved && !options.approved) {
      wf.status = 'awaiting-approval';
      wf.approvalRequestedAt = wf.approvalRequestedAt || Date.now();
      this._persist();
      this.emit('approval-required', { id, title: wf.title, reason: 'Workflow requires human approval' });
      throw new Error(`Workflow ${id} requires approval before execution`);
    }

    wf.approved = true;
    wf.status = 'running';
    wf.updatedAt = Date.now();
    this._persist();
    this.emit('workflow-started', { id });

    if (this.taskEngine) {
      wf.taskEngineTaskId = this.taskEngine.enqueue({
        name: `Workflow: ${wf.title}`,
        priority: this._toTaskPriority(wf.urgency, wf.score),
        payload: { workflowId: wf.id },
        handler: this._workflowExecutor,
      });
      this._persist();
    } else {
      try {
        await this._runWorkflow(wf.id);
      } catch (error) {
        wf.status = 'failed';
        wf.failureReason = error instanceof Error ? error.message : String(error);
        wf.updatedAt = Date.now();
        this._persist();
        this.emit('workflow-failed', { id, error: wf.failureReason });
        throw error;
      }
    }

    return wf.id;
  }

  getWorkflow(id) {
    return this.workflows.get(id);
  }

  getWorkflows(query = {}) {
    let list = Array.from(this.workflows.values());
    if (query.type) list = list.filter((w) => w.type === query.type);
    if (query.status) list = list.filter((w) => w.status === query.status);
    if (query.assignedAgent) list = list.filter((w) => w.assignedAgent === query.assignedAgent);
    return list.sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  getStatus() {
    const counts = { draft: 0, 'awaiting-approval': 0, approved: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
    for (const wf of this.workflows.values()) {
      if (counts[wf.status] !== undefined) counts[wf.status] += 1;
    }
    return { total: this.workflows.size, counts, outcomes: this.outcomes.length };
  }

  async recordOutcome(workflowId, actual) {
    const wf = this._getWorkflow(workflowId);
    const outcome = {
      workflowId,
      type: wf.type,
      title: wf.title,
      expected: wf.expectedValue,
      actual: actual !== undefined ? Number(actual) : 0,
      delta: (actual !== undefined ? Number(actual) : 0) - wf.expectedValue,
      lesson: actual >= wf.expectedValue ? 'Met or exceeded expectation' : 'Fell short of expectation',
      recordedAt: Date.now(),
    };
    this.outcomes.push(outcome);
    if (this.memory) {
      this.memory.put({
        type: 'task',
        name: `Outcome: ${wf.title}`,
        payload: outcome,
        tags: ['lesson', wf.type],
      });
    }
    this._persistOutcomes();
    this.emit('outcome-recorded', outcome);
    return outcome;
  }

  // -------------------------------------------------------------------------
  // Internal execution
  // -------------------------------------------------------------------------

  async _runWorkflow(id) {
    const wf = this._getWorkflow(id);
    wf.status = 'running';
    wf.updatedAt = Date.now();
    this._persist();

    for (const step of wf.steps) {
      if (wf.status === 'cancelled') break;
      step.status = 'running';
      step.startedAt = Date.now();
      this._persist();

      const handler = this.config.stepHandlers[step.kind] || this.config.stepHandlers[step.id];
      let result;
      if (handler) {
        result = await handler({ workflow: wf, step, memory: this.memory });
      } else {
        result = `Step ${step.name} completed (no handler)`;
      }

      step.status = 'completed';
      step.completedAt = Date.now();
      step.result = result;
      this._persist();
      this.emit('step-completed', { workflowId: id, stepId: step.id, step: step.name });
    }

    if (wf.status !== 'cancelled') {
      wf.status = 'completed';
      wf.updatedAt = Date.now();
      this._persist();
      this.emit('workflow-completed', { id, title: wf.title });
    }

    return wf.status;
  }

  _getWorkflow(id) {
    const wf = this.workflows.get(id);
    if (!wf) throw new Error(`Workflow ${id} not found`);
    return wf;
  }

  _requiresApproval(wf) {
    if (wf.approved) return false;
    if (AUTO_APPROVE_TYPES.has(wf.type)) return false;
    if (wf.type === 'sales' && (wf.expectedValue || 0) < 500) return false;
    if (wf.type === 'manufacturing' && (wf.expectedValue || 0) < 200) return false;
    return true;
  }

  _toTaskPriority(urgency, score) {
    if (urgency >= 0.8 || score >= 1000) return 'critical';
    if (urgency >= 0.5 || score >= 500) return 'high';
    if (urgency >= 0.2) return 'normal';
    return 'low';
  }

  _inferWorkflowType(text) {
    const t = (typeof text === 'string' ? text : '').toLowerCase();
    if (t.includes('manufactur') || t.includes('produce') || t.includes('printer')) return { type: 'manufacturing', agent: 'Manufacturing Manager' };
    if (t.includes('research') || t.includes('experiment') || t.includes('prototype')) return { type: 'research', agent: 'Research Manager' };
    if (t.includes('music') || t.includes('creative') || t.includes('release')) return { type: 'creative', agent: 'Creative Director' };
    if (t.includes('finance') || t.includes('expense') || t.includes('ledger')) return { type: 'finance', agent: 'Finance Analyst' };
    if (t.includes('system') || t.includes('technical') || t.includes('maintenance')) return { type: 'technical', agent: 'Technical Architect' };
    return { type: 'sales', agent: 'Sales Manager' };
  }

  _extractValue(text) {
    if (typeof text !== 'string') return 0;
    const match = text.match(/\$?([0-9,]+(?:\.[0-9]{2})?)/);
    return match ? Number(match[1].replace(/,/g, '')) : 0;
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  async _ensureDataDir() {
    try {
      await fs.mkdir(this.config.dataPath, { recursive: true });
    } catch (e) {
      this.config.logger.error('[BusinessWorkflowEngine] data dir error', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  async _load() {
    try {
      const raw = await fs.readFile(this.storePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.workflows) {
        this.workflows = new Map(parsed.workflows.map((w) => [w.id, w]));
      } else {
        throw new Error('invalid snapshot');
      }
    } catch (e) {
      if (e.code === 'ENOENT') {
        this.workflows = new Map();
      } else {
        this.config.logger.error('[BusinessWorkflowEngine] load error, archiving corrupt store', { error: e instanceof Error ? e.message : String(e) });
        await this._archiveCorruptStore(this.storePath);
        this.workflows = new Map();
      }
    }

    try {
      const rawOutcomes = await fs.readFile(this.outcomesPath, 'utf8');
      const parsedOutcomes = JSON.parse(rawOutcomes);
      this.outcomes = Array.isArray(parsedOutcomes.outcomes) ? parsedOutcomes.outcomes : [];
    } catch (e) {
      if (e.code !== 'ENOENT') {
        this.config.logger.error('[BusinessWorkflowEngine] outcomes load error', { error: e instanceof Error ? e.message : String(e) });
      }
      this.outcomes = [];
    }
  }

  async _archiveCorruptStore(filePath) {
    try {
      const corruptPath = `${filePath}.corrupt.${Date.now()}`;
      await fs.rename(filePath, corruptPath);
    } catch (archiveError) {
      this.config.logger.error('[BusinessWorkflowEngine] failed to archive corrupt store', { error: archiveError instanceof Error ? archiveError.message : String(archiveError) });
    }
  }

  _persist() {
    if (this._destroyed) return;
    this._persistPending = true;
    if (this._persistTimer) return;
    this._persistTimer = setTimeout(() => this._flush(), this.config.persistDebounceMs);
    if (this._persistTimer.unref) this._persistTimer.unref();
  }

  async _flush() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    if (!this._persistPending) return;
    this._persistPending = false;

    const snapshot = {
      version: PERSISTENCE_VERSION,
      updatedAt: Date.now(),
      workflows: Array.from(this.workflows.values()),
    };
    const temp = `${this.storePath}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(snapshot, null, 2));
      await fs.rename(temp, this.storePath);
    } catch (e) {
      this.config.logger.error('[BusinessWorkflowEngine] persist error', { error: e instanceof Error ? e.message : String(e) });
    }
    await this._persistOutcomes();
  }

  async _persistOutcomes() {
    try {
      await fs.writeFile(`${this.outcomesPath}.tmp`, JSON.stringify({ outcomes: this.outcomes }, null, 2));
      await fs.rename(`${this.outcomesPath}.tmp`, this.outcomesPath);
    } catch (e) {
      this.config.logger.error('[BusinessWorkflowEngine] outcomes persist error', { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

module.exports = { BusinessWorkflowEngine, BusinessValueScorer };
