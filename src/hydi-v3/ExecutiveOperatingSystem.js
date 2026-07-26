'use strict';

const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');
const StrategicObjectives = require('./StrategicObjectives');
const BriefingRenderer = require('./BriefingRenderer');
const TrustEngine = require('./TrustEngine');
const {
  OperationsManager, SalesManager, ManufacturingManager, ResearchManager,
  CreativeDirector, FinanceAnalyst, TechnicalArchitect, ProductManager,
} = require('./ExecutiveAgents');

const PERSISTENCE_VERSION = 1;

/**
 * ExecutiveOperatingSystem is the COO layer for the ProtoForge ecosystem.
 *
 * It aggregates evidence from BusinessMemory (world model), TaskEngine (execution),
 * ProjectPlanner (engineering pipeline), and ObservabilityDashboard (system health)
 * into a single executive briefing: status, priority actions, risks, and
 * recommendations. It never executes actions without approval, but it can prepare
 * work and queue tasks through the existing TaskEngine.
 */
class ExecutiveOperatingSystem extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      dataPath: config.dataPath || path.resolve(__dirname, '../../data'),
      persistDebounceMs: config.persistDebounceMs ?? 50,
      logger: config.logger || console,
      ...config,
    };

    this.memory = config.businessMemory || null;
    this.taskEngine = config.taskEngine || null;
    this.planner = config.projectPlanner || null;
    this.observability = config.observability || null;
    this.strategicObjectives = config.strategicObjectives || new StrategicObjectives({ ownerPriority: config.ownerPriority || 'default' });
    this.trustEngine = new TrustEngine({ businessMemory: this.memory, strategicObjectives: this.strategicObjectives, logger: this.config.logger });

    this.agents = new Map();
    this.lastBriefing = null;
    this.decisions = [];

    this._registerDefaultAgents();

    this._persistTimer = null;
    this._persistPending = false;
    this._started = false;
    this._destroyed = false;

    this.storePath = path.join(this.config.dataPath, 'executive-os.json');
  }

  _registerDefaultAgents() {
    this.addAgent(new OperationsManager());
    this.addAgent(new SalesManager());
    this.addAgent(new ManufacturingManager());
    this.addAgent(new ResearchManager());
    this.addAgent(new CreativeDirector());
    this.addAgent(new FinanceAnalyst());
    this.addAgent(new TechnicalArchitect());
    this.addAgent(new ProductManager());
  }

  addAgent(agent) {
    if (this._destroyed) throw new Error('ExecutiveOperatingSystem has been destroyed');
    this.agents.set(agent.name, agent);
  }

  removeAgent(name) {
    if (this._destroyed) throw new Error('ExecutiveOperatingSystem has been destroyed');
    return this.agents.delete(name);
  }

  async initialize() {
    return this.start();
  }

  async start() {
    if (this._destroyed) throw new Error('ExecutiveOperatingSystem has been destroyed');
    if (this._started) return;

    await this._ensureDataDir();
    await this._load();
    this._started = true;
    this.config.logger.log('[ExecutiveOS] started');
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
    this.config.logger.log('[ExecutiveOS] stopped');
  }

  async destroy() {
    if (this._destroyed) return;
    this.stop();
    await this._flush();
    this.agents.clear();
    this.lastBriefing = null;
    this.decisions = [];
    this.removeAllListeners();
    this._destroyed = true;
  }

  healthCheck() {
    const checks = {
      initialized: !this._destroyed,
      hasMemory: !!this.memory,
      agentsLoaded: this.agents.size >= 7,
      lastBriefingFresh: this.lastBriefing ? (Date.now() - this.lastBriefing.generatedAt) < 86400000 : true,
    };
    const ok = Object.values(checks).every(Boolean);
    return { ok, checks, agentCount: this.agents.size, briefingCount: this.decisions.length };
  }

  /**
   * Generate the daily COO briefing. Aggregates all agent reports and world state.
   */
  morningBriefing() {
    if (this._destroyed) throw new Error('ExecutiveOperatingSystem has been destroyed');
    if (!this.memory) throw new Error('BusinessMemory not connected');

    const reports = {};
    for (const [name, agent] of this.agents.entries()) {
      try {
        reports[name] = agent.report(this.memory);
      } catch (e) {
        reports[name] = { error: e instanceof Error ? e.message : String(e) };
      }
    }

    const status = this.getStatus(reports);
    const priorityActions = this.priorityActions(5);
    const risks = this.risks();
    const resonateStatus = this.getObjectiveStatus('resonate', priorityActions);
    const strategicObjectives = this.strategicObjectives ? this.strategicObjectives.summarize(this.memory) : [];
    const recommendations = this.recommendations(priorityActions, risks, reports, resonateStatus);

    const briefing = {
      generatedAt: Date.now(),
      executiveSummary: this._executiveSummary(status, priorityActions, risks, recommendations),
      strategicObjectives,
      protoForgeStatus: status,
      priorityActions,
      risks,
      recommendations,
      resonateStatus,
      missingData: this._missingData(reports),
      agentReports: reports,
    };

    this.lastBriefing = briefing;
    this.decisions.push({ at: Date.now(), type: 'briefing', summary: `Generated briefing with ${priorityActions.length} actions, ${risks.length} risks` });
    this._persist();
    this.emit('briefing', briefing);
    return briefing;
  }

  getStatus(agentReports = {}) {
    if (!this.memory) {
      return { memoryConnected: false };
    }
    const memStatus = this.memory.getStatus();
    const sales = agentReports['Sales Manager'] || {};
    const ops = agentReports['Operations Manager'] || {};
    const manufacturing = agentReports['Manufacturing Manager'] || {};
    const tech = agentReports['Technical Architect'] || {};

    return {
      memoryConnected: true,
      revenueOpportunities: sales.openOpportunities || 0,
      revenuePipelineValue: sales.pipelineValue || 0,
      productionStatus: {
        activeTasks: ops.activeTaskCount || 0,
        blockedTasks: ops.blockedTaskCount || 0,
        activeEquipment: manufacturing.activeEquipment || 0,
        degradedSystems: (tech.degradedSystems || []).length,
      },
      activeProjects: memStatus.counts.project || 0,
      customerActivity: {
        activeCustomers: sales.activeCustomers || 0,
        activeLeads: sales.activeLeads || 0,
      },
      systemHealth: this.observability ? this.observability.getHealthScore() : null,
    };
  }

  getObjectiveStatus(objectiveId, priorityActions = []) {
    if (!this.memory || !this.strategicObjectives) return { tracked: false };
    const objective = this.strategicObjectives.get(objectiveId);
    if (!objective) return { tracked: false };

    const matches = this.memory.find({}).filter((e) => this.strategicObjectives.match(e)?.id === objectiveId);
    const topMatch = priorityActions.find((a) => this.strategicObjectives.match(a)?.id === objectiveId) || null;
    const blockers = matches.filter((e) => e.status === 'blocked' || e.tags?.includes('blocker'));
    const milestones = matches.filter((e) => e.tags?.includes('milestone') || e.type === 'milestone');
    const opportunities = this.memory.find({ type: 'opportunity' }).filter((o) => this.strategicObjectives.match(o)?.id === objectiveId);
    const signals = matches.filter((e) => e.tags?.includes('signal') || e.tags?.includes('customer-signal'));
    const completed = milestones.filter((m) => m.status === 'completed').length;
    const total = milestones.length || matches.length || 1;
    const progress = completed / total;
    const releaseReady = progress >= 0.8 && blockers.length === 0;

    return {
      tracked: matches.length > 0,
      objectiveId,
      name: objective.name,
      progress,
      blockers: blockers.map((b) => ({ id: b.id, name: b.name, reason: b.payload?.reason || 'Unknown blocker' })),
      milestones: milestones.map((m) => ({ id: m.id, name: m.name, status: m.status })),
      opportunities: opportunities.map((o) => ({ id: o.id, name: o.name, value: o.value })),
      decisionsNeeded: blockers.length + (releaseReady ? 0 : 1),
      customerSignals: signals.length,
      releaseReady,
      topPriority: topMatch ? { id: topMatch.id, name: topMatch.name, score: topMatch.score } : null,
    };
  }

  priorityActions(limit = 5) {
    if (!this.memory) return [];
    const ranked = this.memory.rankOpportunities({ types: ['opportunity', 'task'] });
    const blocked = this.memory.find({ status: 'blocked' });
    const blockedScored = blocked.map((b) => ({ ...b, score: this.memory._score ? this.memory._score(b) : 0 }));
    const combined = [...ranked, ...blockedScored].sort((a, b) => b.score - a.score);
    const seen = new Set();
    const actions = [];
    for (const item of combined) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      actions.push({
        id: item.id,
        name: item.name,
        type: item.type,
        value: item.value,
        effort: item.effort,
        risk: item.risk,
        score: item.score,
        reason: this._reasonFor(item),
      });
      if (actions.length >= limit) break;
    }
    return actions;
  }

  risks() {
    if (!this.memory) return [];
    const risks = [];

    // Missed deadlines / overdue
    const now = Date.now();
    const projects = this.memory.find({ type: 'project' });
    for (const p of projects) {
      if (p.payload?.deadline && p.payload.deadline < now && p.status !== 'completed') {
        risks.push({ severity: 'high', category: 'deadline', entity: p.id, name: p.name, detail: 'Deadline passed' });
      }
    }

    // Resource conflicts: equipment tagged as maintenance while project active
    const equipment = this.memory.find({ type: 'equipment' });
    const maintenance = equipment.filter((e) => e.status === 'maintenance').map((e) => e.id);
    const active = this.memory.find({ type: 'project', status: 'active' });
    for (const p of active) {
      const rels = this.memory.getRelated(p.id);
      const blocking = rels.filter((r) => maintenance.includes(r.targetId));
      if (blocking.length > 0) {
        risks.push({ severity: 'medium', category: 'resource-conflict', entity: p.id, name: p.name, detail: `Depends on equipment in maintenance: ${blocking.map((b) => b.entity.name).join(', ')}` });
      }
    }

    // Equipment problems
    for (const e of equipment) {
      if (e.status === 'maintenance' || e.status === 'degraded') {
        risks.push({ severity: 'medium', category: 'equipment', entity: e.id, name: e.name, detail: `Status: ${e.status}` });
      }
    }

    // Financial leakage: high-value opportunity with no client relationship
    const opportunities = this.memory.find({ type: 'opportunity' });
    for (const o of opportunities) {
      const rels = this.memory.getRelated(o.id, 'for');
      if ((o.value || 0) > 1000 && rels.length === 0) {
        risks.push({ severity: 'medium', category: 'financial-leakage', entity: o.id, name: o.name, detail: 'High-value opportunity has no linked client' });
      }
    }

    // Blocked projects
    for (const p of active) {
      const deps = this.memory.getRelated(p.id, 'depends-on');
      const incompleteDeps = deps.filter((d) => d.entity && d.entity.status !== 'completed');
      if (incompleteDeps.length > 0) {
        risks.push({ severity: 'medium', category: 'blocked-project', entity: p.id, name: p.name, detail: `Blocked by ${incompleteDeps.length} incomplete dependencies` });
      }
    }

    return risks.sort((a, b) => (b.severity === 'high' ? 1 : 0) - (a.severity === 'high' ? 1 : 0));
  }

  recommendations(priorityActions, risks, agentReports = {}, resonateStatus = null) {
    const recs = [];
    const finance = agentReports['Finance Analyst'] || {};
    const sales = agentReports['Sales Manager'] || {};

    if (priorityActions.length > 0) {
      const top = priorityActions[0];
      recs.push({
        action: `Complete "${top.name}"`,
        reason: `Highest score (${top.score.toFixed(2)}) among ${priorityActions.length} open actions; value ${top.value}, effort ${top.effort}.`,
        expectedImpact: 'Revenue or capability gain',
        expectedOutcome: `Opportunity "${top.name}" is completed and its value ${top.value} is realized.`,
        changes: `Entity "${top.name}" transitions from ${top.status || 'active'} to completed.`,
        id: top.id,
      });
    }

    if ((sales.activeLeads || 0) > 0) {
      recs.push({
        action: 'Review active leads with Sales Manager',
        reason: `${sales.activeLeads} lead(s) need follow-up.`,
        expectedImpact: 'Shortest path to new revenue',
        expectedOutcome: 'Sales-qualified leads receive follow-up and progress to quotes.',
        changes: 'Lead statuses updated; pipeline value recalculated.',
      });
    }

    const maintenanceRisk = risks.find((r) => r.category === 'equipment');
    if (maintenanceRisk) {
      recs.push({
        action: `Address ${maintenanceRisk.name}`,
        reason: `Equipment status is ${maintenanceRisk.detail}.`,
        expectedImpact: 'Protect production capacity',
        expectedOutcome: 'Equipment restored to active status and production risk reduced.',
        changes: `Entity "${maintenanceRisk.name}" transitions from ${maintenanceRisk.entity} status to active.`,
      });
    }

    if ((finance.trackedExpenses || 0) > (finance.revenueOpportunityValue || 0) * 0.5) {
      recs.push({
        action: 'Review expense ledger',
        reason: `Expenses are ${((finance.trackedExpenses / (finance.revenueOpportunityValue || 1)) * 100).toFixed(0)}% of open revenue opportunities.`,
        expectedImpact: 'Financial leakage control',
        expectedOutcome: 'Unnecessary or mis-categorized expenses are flagged.',
        changes: 'Expense records updated; financial confidence recalculated.',
      });
    }

    if (resonateStatus && resonateStatus.tracked) {
      if (resonateStatus.releaseReady) {
        recs.push({
          action: 'Prepare Resonate release',
          reason: 'Flagship product is release-ready.',
          expectedImpact: 'Ecosystem growth and brand value',
          expectedOutcome: 'Resonate is ready for public release.',
          changes: 'Release status recorded; launch workflow can begin.',
        });
      } else {
        const b = resonateStatus.blockers;
        recs.push({
          action: b.length > 0 ? `Resolve ${b.length} Resonate blocker${b.length === 1 ? '' : 's'}` : 'Advance Resonate milestone',
          reason: `Resonate is the flagship product. Progress ${(resonateStatus.progress * 100).toFixed(0)}%, ${b.length} blocker${b.length === 1 ? '' : 's'}.`,
          expectedImpact: 'Flagship revenue and strategic positioning',
          expectedOutcome: 'Resonate moves closer to release readiness.',
          changes: 'Blockers cleared or milestones advanced.',
        });
      }
    }

    if (recs.length === 0) {
      recs.push(this.trustEngine.iDontKnow('No memory entities or agent reports support a recommendation.'));
    }

    return recs.map((r) => {
      const provenance = this.trustEngine.generateProvenance(r, this.memory);
      return { ...r, confidence: provenance.confidence, provenance };
    });
  }

  /**
   * Human-readable briefing. Rendering lives in BriefingRenderer so the CLI,
   * the local dashboard route, and this method can never diverge.
   */
  toText(briefing) {
    return BriefingRenderer.toText(briefing);
  }

  /**
   * Format-neutral section model for alternate operator surfaces.
   */
  toSections(briefing) {
    return BriefingRenderer.toSections(briefing);
  }

  _executiveSummary(status, priorityActions, risks, recommendations) {
    // Health comes from BriefingRenderer so the summary sentence and the
    // rendered status line can never disagree.
    const health = BriefingRenderer.healthOf({ risks });
    const top = priorityActions[0];
    const topAction = recommendations[0] || (top ? { action: top.name, reason: top.reason } : null);
    const highestObjective = this.strategicObjectives ? this.strategicObjectives.getActive()[0]?.name || 'None' : 'None';
    return `ProtoForge is ${health}. ${priorityActions.length} priority actions, ${risks.length} risks. Highest strategic objective: ${highestObjective}. ${topAction ? `Recommended next action: ${topAction.action} (${topAction.reason})` : 'No recommendations available.'}`;
  }

  _missingData(reports) {
    const missing = [];
    if (!this.memory) missing.push('BusinessMemory not connected.');
    if (!this.observability) missing.push('Observability dashboard not connected.');
    if (!this.planner) missing.push('Project planner not connected.');
    for (const [name, report] of Object.entries(reports)) {
      if (report && report.error) missing.push(`${name} report failed: ${report.error}`);
    }
    return missing;
  }

  _reasonFor(entity) {
    if (entity.type === 'opportunity') return `Revenue opportunity worth ${entity.value}`;
    if (entity.status === 'blocked') return 'Blocked; unblocking may unlock dependencies';
    return 'Open task';
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  async _ensureDataDir() {
    try {
      await fs.mkdir(this.config.dataPath, { recursive: true });
    } catch (e) {
      this.config.logger.error('[ExecutiveOS] data dir error', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  async _load() {
    try {
      const raw = await fs.readFile(this.storePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.decisions)) {
        this.decisions = parsed.decisions;
        this.lastBriefing = parsed.lastBriefing || null;
      } else {
        throw new Error('invalid snapshot');
      }
    } catch (e) {
      if (e.code === 'ENOENT') {
        this.decisions = [];
        this.lastBriefing = null;
      } else {
        this.config.logger.error('[ExecutiveOS] load error, archiving corrupt store', { error: e instanceof Error ? e.message : String(e) });
        await this._archiveCorruptStore();
        this.decisions = [];
        this.lastBriefing = null;
      }
    }
  }

  async _archiveCorruptStore() {
    try {
      const corruptPath = `${this.storePath}.corrupt.${Date.now()}`;
      await fs.rename(this.storePath, corruptPath);
    } catch (archiveError) {
      this.config.logger.error('[ExecutiveOS] failed to archive corrupt store', { error: archiveError instanceof Error ? archiveError.message : String(archiveError) });
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
      lastBriefing: this.lastBriefing,
      decisions: this.decisions.slice(-1000),
    };
    const temp = `${this.storePath}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(snapshot, null, 2));
      await fs.rename(temp, this.storePath);
    } catch (e) {
      this.config.logger.error('[ExecutiveOS] persist error', { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

module.exports = ExecutiveOperatingSystem;
