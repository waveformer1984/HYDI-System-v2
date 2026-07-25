'use strict';

const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');
const {
  OperationsManager, SalesManager, ManufacturingManager, ResearchManager,
  CreativeDirector, FinanceAnalyst, TechnicalArchitect,
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
    const recommendations = this.recommendations(priorityActions, risks, reports);

    const briefing = {
      generatedAt: Date.now(),
      protoForgeStatus: status,
      priorityActions,
      risks,
      recommendations,
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

  recommendations(priorityActions, risks, agentReports = {}) {
    const recs = [];
    const finance = agentReports['Finance Analyst'] || {};
    const sales = agentReports['Sales Manager'] || {};

    if (priorityActions.length > 0) {
      const top = priorityActions[0];
      recs.push({
        action: `Complete "${top.name}"`,
        reason: `Highest score (${top.score.toFixed(2)}) among ${priorityActions.length} open actions; value ${top.value}, effort ${top.effort}.`,
        expectedImpact: 'Revenue or capability gain',
      });
    }

    if ((sales.activeLeads || 0) > 0) {
      recs.push({
        action: 'Review active leads with Sales Manager',
        reason: `${sales.activeLeads} lead(s) need follow-up.`,
        expectedImpact: 'Shortest path to new revenue',
      });
    }

    const maintenanceRisk = risks.find((r) => r.category === 'equipment');
    if (maintenanceRisk) {
      recs.push({
        action: `Address ${maintenanceRisk.name}`,
        reason: `Equipment status is ${maintenanceRisk.detail}.`,
        expectedImpact: 'Protect production capacity',
      });
    }

    if ((finance.trackedExpenses || 0) > (finance.revenueOpportunityValue || 0) * 0.5) {
      recs.push({
        action: 'Review expense ledger',
        reason: `Expenses are ${((finance.trackedExpenses / (finance.revenueOpportunityValue || 1)) * 100).toFixed(0)}% of open revenue opportunities.`,
        expectedImpact: 'Financial leakage control',
      });
    }

    return recs;
  }

  toText(briefing) {
    const s = briefing.protoForgeStatus;
    const lines = [
      'ProtoForge status: stable.',
      '',
      `Revenue opportunities: ${s.revenueOpportunities} (${s.revenuePipelineValue || 0} value).`,
      `Production: ${s.productionStatus.activeTasks} active tasks, ${s.productionStatus.blockedTasks} blocked.`,
      `Active projects: ${s.activeProjects}.`,
      `Customer activity: ${s.customerActivity.activeCustomers} active customers, ${s.customerActivity.activeLeads} leads.`,
      '',
      'Priority actions:',
      ...briefing.priorityActions.map((a, i) => `${i + 1}. ${a.name} (score ${a.score.toFixed(2)}): ${a.reason}`),
      '',
      'Risks:',
      ...(briefing.risks.length ? briefing.risks.map((r) => `- ${r.name}: ${r.detail}`) : ['- None identified.']),
      '',
      'Recommendations:',
      ...(briefing.recommendations.length ? briefing.recommendations.map((r) => `- ${r.action}: ${r.reason}`) : ['- No specific recommendations.']),
    ];
    return lines.join('\n');
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
