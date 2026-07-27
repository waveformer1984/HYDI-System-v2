'use strict';

const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');
const StrategicObjectives = require('./StrategicObjectives');
const StartupIntegrity = require('./StartupIntegrity');

const PERSISTENCE_VERSION = 1;
const VALID_PRIORITIES = new Set(['resonate', 'operations', 'manufacturing', 'music', 'research', 'revenue', 'creative', 'default']);

/**
 * ExecutiveCockpit is the local-first operator interface for ProtoForge.
 *
 * It aggregates BusinessMemory, ExecutiveOperatingSystem, BusinessWorkflowEngine,
 * and ExecutionGateway into a single conversational command surface. All actions
 * continue to route through ExecutionGateway; the cockpit is an interface, not an
 * authority escalation path.
 */
class ExecutiveCockpit extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      dataPath: config.dataPath || path.resolve(__dirname, '../../data'),
      persistDebounceMs: config.persistDebounceMs ?? 50,
      logger: config.logger || console,
      ...config,
    };

    this.memory = config.businessMemory || null;
    this.executiveOS = config.executiveOS || null;
    this.workflowEngine = config.workflowEngine || null;
    this.executionGateway = config.executionGateway || null;
    this.learningMetrics = config.learningMetrics || null;
    this.recommendationTracker = config.recommendationTracker || null;
    this.businessEvidenceEngine = config.businessEvidenceEngine || null;
    this.strategicObjectives = config.strategicObjectives || new StrategicObjectives({ ownerPriority: 'default' });
    this.startupIntegrity = new StartupIntegrity({
      strategicObjectives: this.strategicObjectives,
      businessMemory: this.memory,
      executionGateway: this.executionGateway,
      workflowEngine: this.workflowEngine,
      observability: config.observability || null,
      backup: config.backup || null,
      logger: this.config.logger,
    });

    this.ownerPriority = 'default';
    this.interactions = [];

    this._persistTimer = null;
    this._persistPending = false;
    this._started = false;
    this._destroyed = false;

    this.storePath = path.join(this.config.dataPath, 'executive-cockpit.json');
  }

  async initialize() {
    return this.start();
  }

  async start() {
    if (this._destroyed) throw new Error('ExecutiveCockpit has been destroyed');
    if (this._started) return;

    await this._ensureDataDir();
    await this._load();
    this._started = true;
    this.config.logger.log('[ExecutiveCockpit] started');
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
    this.config.logger.log('[ExecutiveCockpit] stopped');
  }

  async destroy() {
    if (this._destroyed) return;
    this.stop();
    await this._flush();
    this.removeAllListeners();
    this._destroyed = true;
  }

  healthCheck() {
    const checks = {
      initialized: !this._destroyed,
      hasGateway: !!this.executionGateway,
      hasMemory: !!this.memory,
      validPriority: VALID_PRIORITIES.has(this.ownerPriority),
    };
    const ok = Object.values(checks).every(Boolean);
    return { ok, checks, ownerPriority: this.ownerPriority, interactions: this.interactions.length };
  }

  // -------------------------------------------------------------------------
  // Conversational interface
  // -------------------------------------------------------------------------

  parseCommand(text) {
    const t = (text || '').toLowerCase().trim().replace(/[.!?]+$/, '');
    if (/^(good morning|morning|hello|hi|hey)$/.test(t)) return { command: 'good-morning' };
    if (/^(how are we doing|how's it going|how is it going|status|how are things)$/.test(t)) return { command: 'status' };
    if (/^(what should i focus on|focus|priorities|what next|what should i do)$/.test(t)) return { command: 'focus' };
    if (/^(pending|approvals|what needs approval)$/.test(t)) return { command: 'approvals' };
    if (/^(history|executions|recent actions|log)$/.test(t)) return { command: 'history' };
    if (/^(workflows|active workflows|what is active)$/.test(t)) return { command: 'workflows' };
    if (/^(learning|learn|prediction accuracy|recommendation success|lessons learned|recommendation history)$/.test(t)) return { command: 'learning' };
    if (/^(evidence|business evidence|evidence summary)$/.test(t)) return { command: 'evidence' };
    if (/^(outcomes|outcome review|outcome queue)$/.test(t)) return { command: 'outcomes' };
    if (/^(kpis|business kpis|kpi dashboard)$/.test(t)) return { command: 'kpis' };
    if (/^review\s+(.+)$/.test(t)) {
      const parts = t.match(/^review\s+(.+)$/)[1].trim().split(/\s+/);
      const id = parts[0];
      const answer = parts.slice(1).join(' ');
      return { command: 'review', id, answer };
    }
    if (/^(startup|health|startup check|system health)$/.test(t)) return { command: 'startup' };
    if (/^(what changed|what changed today|what's new|whats new)$/.test(t)) return { command: 'what-changed' };
    if (/^approve\s+(.+)$/.test(t)) return { command: 'approve', id: t.match(/^approve\s+(.+)$/)[1].trim() };
    if (/^reject\s+(.+)$/.test(t)) return { command: 'reject', id: t.match(/^reject\s+(.+)$/)[1].trim() };
    if (/^priority\s+(.+)$/.test(t)) {
      const p = t.match(/^priority\s+(.+)$/)[1].trim();
      return { command: 'priority', priority: p };
    }
    if (/^(help|\?)$/.test(t)) return { command: 'help' };
    return { command: 'unknown', text };
  }

  async handleCommand(text) {
    const parsed = this.parseCommand(text);
    const started = Date.now();
    let response;

    switch (parsed.command) {
      case 'good-morning':
        response = this.goodMorning();
        break;
      case 'status':
        response = this.howAreWeDoing();
        break;
      case 'focus':
        response = this.focusForToday();
        break;
      case 'approvals':
        response = this.listApprovals();
        break;
      case 'history':
        response = this.listHistory();
        break;
      case 'workflows':
        response = this.listWorkflows();
        break;
      case 'learning':
        response = this.getLearningDashboard();
        break;
      case 'evidence':
        response = this.getEvidenceDashboard();
        break;
      case 'outcomes':
        response = this.getOutcomeDashboard();
        break;
      case 'kpis':
        response = this.getKPIDashboard();
        break;
      case 'review':
        response = this.review(parsed.id, parsed.answer);
        break;
      case 'approve':
        response = await this.approveById(parsed.id);
        break;
      case 'reject':
        response = await this.rejectById(parsed.id);
        break;
      case 'priority':
        response = this.setOwnerPriority(parsed.priority);
        break;
      case 'startup':
        response = await this.startupCheck();
        break;
      case 'what-changed':
        response = this.whatChanged();
        break;
      case 'help':
        response = this.getHelp();
        break;
      default:
        response = { text: 'I did not understand. Try "status", "focus", "approvals", or "help".' };
    }

    this.interactions.push({ at: started, command: parsed.command, text, response });
    this._persist();
    this.emit('interaction', { at: started, command: parsed.command, text, response });
    return response;
  }

  goodMorning() {
    const status = this._getStatus();
    const pending = this._getPendingSummary();
    const rec = this._topRecommendation();

    const highest = (this.strategicObjectives.getActive()[0] || {}).name || 'None';
    const lines = [
      'Good morning.',
      '',
      `ProtoForge status: ${status.health}.`,
      `Operations are ${status.operations}.`,
      `Current strategic focus: ${this.ownerPriority} (highest objective: ${highest}).`,
      '',
      'Completed:',
      ...status.completed.map((c) => `- ${c}`),
      '',
      'Attention required:',
      ...pending.map((p) => `- ${p}`),
      '',
      'Recommended next action:',
      rec,
    ];
    return { text: lines.join('\n'), ...status, pending, recommendation: rec, highestPriorityObjective: highest };
  }

  async startupCheck() {
    const result = await this.startupIntegrity.check();
    return { text: this.startupIntegrity.toText(result), status: result.status, checks: result.checks };
  }

  howAreWeDoing() {
    const data = this.getDashboardData();
    const lines = [
      'ProtoForge status:',
      '',
      `Active workflows: ${data.activeWorkflows}`,
      `Pending approvals: ${data.pendingApprovals}`,
      `Completed actions today: ${data.completedToday}`,
      `Revenue opportunities: ${data.revenueOpportunities}`,
      `Active customers: ${data.customerActivity}`,
      `Production tasks: ${data.productionTasks}`,
    ];
    if (data.risks.length > 0) {
      lines.push('', 'Risks:', ...data.risks.map((r) => `- ${r}`));
    }
    return { text: lines.join('\n'), ...data };
  }

  whatChanged() {
    if (!this.executiveOS) return { text: 'ExecutiveOperatingSystem not connected.' };
    const summary = this.executiveOS.recentActivitySummary(86400000);
    const lines = ['What changed today:', ''];
    lines.push(...summary.lines);
    return { text: lines.join('\n'), ...summary };
  }

  focusForToday() {
    let recs = [];
    if (this.workflowEngine && this.workflowEngine.getRankedRecommendations) {
      recs = this.workflowEngine.getRankedRecommendations(10);
    } else if (this.executiveOS) {
      recs = (this.executiveOS.morningBriefing().recommendations || []).map((r, i) => ({ ...r, id: `rec_${i}` }));
    }

    const scored = recs.map((r, i) => {
      const scored = this.strategicObjectives.scoreRecommendation({ ...r, id: r.id || `rec_${i}` }, this.ownerPriority);
      return { ...r, ...scored, explanation: `score ${scored.score.toFixed(2)} — ${scored.reason}` };
    }).sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      return { text: 'No ranked recommendations are available right now.' };
    }

    const top = scored.slice(0, 3);
    const lines = [
      `Focus for today (priority: ${this.ownerPriority}):`,
      '',
      ...top.map((r, i) => `${i + 1}. ${r.action || r.title}: ${r.reason || r.detail} (${r.explanation})`),
    ];
    return { text: lines.join('\n'), recommendations: top };
  }

  listApprovals() {
    const approvals = this._getPendingApprovals();
    if (approvals.length === 0) return { text: 'No pending approvals.', approvals: [] };
    const lines = [
      `Pending approvals (${approvals.length}):`,
      '',
      ...approvals.map((a, i) => `${i + 1}. [${a.id}] ${a.title || a.type} — requested by ${a.requestingAgent || a.assignedAgent || 'unknown'} (${a.reason || 'no reason'})`),
    ];
    return { text: lines.join('\n'), approvals };
  }

  listHistory() {
    if (!this.executionGateway) return { text: 'ExecutionGateway not connected.' };
    const history = this.executionGateway.getExecutionHistory({}).slice(0, 20);
    if (history.length === 0) return { text: 'No execution history yet.' };
    const lines = [
      'Recent execution history:',
      '',
      ...history.map((h, i) => `${i + 1}. [${h.status}] ${h.type} (${h.adapter}) by ${h.requestingAgent} — ${h.result ? 'completed' : (h.failureReason || 'pending')}`),
    ];
    return { text: lines.join('\n'), history };
  }

  listWorkflows() {
    if (!this.workflowEngine) return { text: 'BusinessWorkflowEngine not connected.' };
    const active = this.workflowEngine.getWorkflows({ status: 'running' }).slice(0, 10);
    const pending = this.workflowEngine.getWorkflows({ status: 'awaiting-approval' }).slice(0, 10);
    if (active.length === 0 && pending.length === 0) return { text: 'No active workflows.' };
    const lines = ['Active workflows:', ''];
    active.forEach((w, i) => lines.push(`${i + 1}. [${w.id}] ${w.title} (${w.type}) — ${w.assignedAgent}`));
    if (pending.length > 0) {
      lines.push('', 'Awaiting approval:');
      pending.forEach((w, i) => lines.push(`${i + 1}. [${w.id}] ${w.title}`));
    }
    return { text: lines.join('\n'), active, pending };
  }

  getLearningDashboard() {
    if (!this.learningMetrics) return { text: 'LearningMetrics not connected.' };
    const dashboard = this.learningMetrics.getDashboardData();
    const accuracy = dashboard.predictionAccuracy !== null ? `${(dashboard.predictionAccuracy * 100).toFixed(0)}%` : 'N/A';
    const successRate = dashboard.recommendationSuccessRate !== null ? `${(dashboard.recommendationSuccessRate * 100).toFixed(0)}%` : 'N/A';
    const confidence = `${(dashboard.averageConfidence * 100).toFixed(0)}%`;
    const drift = `${(dashboard.confidenceDrift * 100).toFixed(2)}%`;
    const topAgent = dashboard.topAgents[0]?.agent || 'none';
    const lowestArea = dashboard.lowestConfidenceAreas[0]?.area || 'none';

    const lines = [
      'Learning Dashboard',
      '',
      `Prediction accuracy: ${accuracy}`,
      `Recommendation success rate: ${successRate}`,
      `Average confidence: ${confidence} (drift ${drift})`,
      `Recommendations awaiting outcome: ${dashboard.total - dashboard.completed}`,
      `Top performing agent: ${topAgent}`,
      `Lowest confidence area: ${lowestArea}`,
      '',
      'Recent lessons:',
      ...(dashboard.recentLessons.length ? dashboard.recentLessons.map((l, i) => `${i + 1}. ${l.lesson}`) : ['No lessons recorded yet.']),
      '',
      'Recommendation history:',
      ...(dashboard.recommendationHistory.length ? dashboard.recommendationHistory.slice(0, 10).map((r, i) => `${i + 1}. [${r.id}] ${r.action} — ${r.ownerDecision} (${r.outcome || 'pending'})`) : ['No recommendations recorded yet.']),
    ];
    return { text: lines.join('\n'), dashboard };
  }

  getEvidenceDashboard() {
    if (!this.businessEvidenceEngine) return { text: 'BusinessEvidenceEngine not connected.' };
    const summary = this.businessEvidenceEngine.getEvidenceSummary();
    const bySource = summary.bySource || {};
    const lines = [
      'Evidence Dashboard',
      '',
      `Total evidence collected: ${summary.total}`,
      'By source:',
      ...Object.entries(bySource).map(([s, c]) => `- ${s}: ${c}`),
    ];
    return { text: lines.join('\n'), summary };
  }

  getOutcomeDashboard() {
    if (!this.businessEvidenceEngine) return { text: 'BusinessEvidenceEngine not connected.' };
    const awaiting = this.businessEvidenceEngine.getRecommendationsAwaitingReview();
    const confirmed = this.businessEvidenceEngine.getRecentlyConfirmedOutcomes(5);
    const accuracy = this.businessEvidenceEngine.getPredictionAccuracy();
    const lines = [
      'Outcome Review Queue',
      '',
      `Awaiting review: ${awaiting.length}`,
      `Prediction accuracy: ${accuracy === null ? 'building baseline' : `${(accuracy * 100).toFixed(0)}%`}`,
      '',
      'Recently confirmed:',
      ...(confirmed.length ? confirmed.map((c) => `- [${c.id}] ${c.action}: ${c.outcome}`) : ['No confirmed outcomes yet.']),
      '',
      'Awaiting:',
      ...(awaiting.length ? awaiting.map((r) => `- [${r.id}] ${r.action}`) : ['No recommendations awaiting review.']),
    ];
    return { text: lines.join('\n'), awaiting, confirmed, accuracy };
  }

  getKPIDashboard() {
    if (!this.businessEvidenceEngine) return { text: 'BusinessEvidenceEngine not connected.' };
    const kpis = this.businessEvidenceEngine.getBusinessKPIs();
    const lines = [
      'Business KPI Dashboard',
      '',
      ...Object.values(kpis).map((k) => `${k.name}: ${k.value === null ? 'unknown' : k.value} ${k.unit} (target ${k.target}, ${k.status})`),
    ];
    return { text: lines.join('\n'), kpis };
  }

  review(id, answer) {
    if (!this.businessEvidenceEngine) return { text: 'BusinessEvidenceEngine not connected.' };
    if (!answer) {
      try {
        const review = this.businessEvidenceEngine.requestManualReview(id);
        return { text: `${review.question} Options: ${review.options.join(', ')}.`, review };
      } catch (e) {
        return { text: `Review request failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    try {
      const result = this.businessEvidenceEngine.submitManualReview(id, answer);
      return { text: `Outcome evaluated as ${result.classification}. ${result.explanation}`, result };
    } catch (e) {
      return { text: `Review submission failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  getHelp() {
    return {
      text: `Available commands:\n- "Good morning" or "status"\n- "focus"\n- "approvals"\n- "history"\n- "workflows"\n- "learning"\n- "evidence"\n- "outcomes"\n- "kpis"\n- "review <id>" or "review <id> yes|partially|no|unknown"\n- "startup" or "health"\n- "approve <id>"\n- "reject <id>"\n- "priority <resonate|operations|manufacturing|music|research|revenue|creative|default>"\n- "help"`,
    };
  }

  // -------------------------------------------------------------------------
  // Actions through the gateway
  // -------------------------------------------------------------------------

  async executeAction(action) {
    if (!this.executionGateway) throw new Error('ExecutionGateway not connected');
    return this.executionGateway.execute(action);
  }

  async approveById(id) {
    if (!id) return { text: 'Please provide an id to approve.' };
    try {
      if (this.executionGateway && this.executionGateway.pending.has(id)) {
        const result = await this.executionGateway.approve(id);
        return { text: `Approved and executed ${id}.`, result };
      }
      if (this.workflowEngine && this.workflowEngine.getWorkflow(id)) {
        this.workflowEngine.approveWorkflow(id);
        return { text: `Approved workflow ${id}.` };
      }
      return { text: `No pending item found for ${id}.` };
    } catch (error) {
      return { text: `Approval failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  async rejectById(id) {
    if (!id) return { text: 'Please provide an id to reject.' };
    try {
      if (this.executionGateway && this.executionGateway.pending.has(id)) {
        const result = this.executionGateway.reject(id);
        return { text: `Rejected ${id}.`, result };
      }
      if (this.workflowEngine && this.workflowEngine.getWorkflow(id)) {
        const wf = this.workflowEngine.getWorkflow(id);
        wf.status = 'rejected';
        return { text: `Rejected workflow ${id}.` };
      }
      return { text: `No pending item found for ${id}.` };
    } catch (error) {
      return { text: `Rejection failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  setOwnerPriority(priority) {
    const p = priority.toLowerCase().trim();
    if (!VALID_PRIORITIES.has(p)) {
      return { text: `Unknown priority "${priority}". Use resonate, operations, manufacturing, music, research, revenue, creative, or default.` };
    }
    this.ownerPriority = p;
    this.strategicObjectives.setOwnerPriority(p);
    if (this.memory && this.memory.strategicObjectives) {
      this.memory.strategicObjectives.setOwnerPriority(p);
    }
    if (this.executiveOS && this.executiveOS.strategicObjectives) {
      this.executiveOS.strategicObjectives.setOwnerPriority(p);
    }
    this._persist();
    return { text: `Owner priority set to ${p}.` };
  }

  // -------------------------------------------------------------------------
  // Dashboard
  // -------------------------------------------------------------------------

  getDashboardData() {
    const activeWorkflows = this.workflowEngine ? this.workflowEngine.getStatus().total : 0;
    const pendingApprovals = (this.executionGateway ? this.executionGateway.getPendingApprovals().length : 0)
      + (this.workflowEngine ? this.workflowEngine.getWorkflows({ status: 'awaiting-approval' }).length : 0);
    const completedToday = this.executionGateway
      ? this.executionGateway.getExecutionHistory({ status: 'completed' }).filter((e) => Date.now() - e.timestamp < 86400000).length
      : 0;
    const revenueOpportunities = this.memory
      ? this.memory.find({ type: 'opportunity', status: 'active' }).length
      : 0;
    const customerActivity = this.memory
      ? this.memory.find({ type: 'client', status: 'active' }).length
      : 0;
    const productionTasks = this.memory
      ? this.memory.find({ type: 'task', status: 'active' }).length
      : 0;
    const risks = this.executiveOS
      ? (this.executiveOS.morningBriefing().risks || []).slice(0, 5)
      : [];

    const strategic = this.strategicObjectives ? this.strategicObjectives.summarize(this.memory) : [];
    const highestObjective = strategic[0] || null;

    const learning = this.learningMetrics ? this.learningMetrics.getDashboardData() : null;
    return {
      activeWorkflows,
      pendingApprovals,
      completedToday,
      revenueOpportunities,
      customerActivity,
      productionTasks,
      risks,
      ownerPriority: this.ownerPriority,
      strategicObjectives: strategic,
      highestPriorityObjective: highestObjective ? highestObjective.name : null,
      agentActivity: this.executionGateway ? this.executionGateway.getDashboardData().agentActivity : {},
      history: this.executionGateway ? this.executionGateway.getExecutionHistory({}).slice(0, 10) : [],
      learning,
    };
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  _getStatus() {
    const completed = [];
    let completedActions = 0;
    if (this.executionGateway) {
      const today = this.executionGateway.getExecutionHistory({ status: 'completed' }).filter((e) => Date.now() - e.timestamp < 86400000);
      completedActions = today.length;
      completed.push(`${completedActions} execution actions`);
    }
    if (this.workflowEngine) {
      const done = this.workflowEngine.getWorkflows({ status: 'completed' });
      completed.push(`${done.length} workflows`);
    }
    if (completed.length === 0) completed.push('nothing recorded yet');

    const health = this.healthCheck().ok ? 'stable' : 'degraded';
    const operations = this.workflowEngine && this.workflowEngine.getStatus().total > 0 ? 'active' : 'quiet';

    return { completed, health, operations };
  }

  _getPendingSummary() {
    const pending = [];
    const egPending = this.executionGateway ? this.executionGateway.getPendingApprovals().length : 0;
    if (egPending > 0) pending.push(`${egPending} execution approval${egPending === 1 ? '' : 's'} waiting`);
    const wfPending = this.workflowEngine ? this.workflowEngine.getWorkflows({ status: 'awaiting-approval' }).length : 0;
    if (wfPending > 0) pending.push(`${wfPending} workflow${wfPending === 1 ? '' : 's'} awaiting approval`);
    const risks = this.executiveOS ? (this.executiveOS.morningBriefing().risks || []) : [];
    if (risks.length > 0) pending.push(`${risks.length} risk${risks.length === 1 ? '' : 's'} identified`);
    if (pending.length === 0) pending.push('nothing urgent');
    return pending;
  }

  _getPendingApprovals() {
    const out = [];
    if (this.executionGateway) {
      out.push(...this.executionGateway.getPendingApprovals().map((a) => ({ ...a, kind: 'execution' })));
    }
    if (this.workflowEngine) {
      out.push(...this.workflowEngine.getWorkflows({ status: 'awaiting-approval' }).map((w) => ({
        id: w.id,
        title: w.title,
        reason: w.reason,
        assignedAgent: w.assignedAgent,
        kind: 'workflow',
        expectedValue: w.expectedValue,
      })));
    }
    return out;
  }

  _topRecommendation() {
    if (this.workflowEngine) {
      const recs = this.workflowEngine.getRankedRecommendations(1);
      if (recs.length > 0) {
        const r = recs[0];
        return `${r.action || r.title} because ${r.reason} (score ${r.score.toFixed ? r.score.toFixed(2) : r.score})`;
      }
    }
    if (this.executiveOS) {
      const recs = this.executiveOS.morningBriefing().recommendations || [];
      if (recs.length > 0) return `${recs[0].action} because ${recs[0].reason}`;
    }
    return 'No recommendations available. Add business data to BusinessMemory.';
  }

  _matchesPriority(recommendation, priority) {
    const text = `${recommendation.action || ''} ${recommendation.title || ''} ${recommendation.reason || ''}`.toLowerCase();
    const map = {
      revenue: ['sale', 'customer', 'quote', 'revenue', 'proposal', 'pipeline'],
      manufacturing: ['manufacturing', 'produce', 'printer', 'equipment', 'material'],
      creative: ['creative', 'music', 'release', 'asset', 'design'],
      research: ['research', 'experiment', 'prototype', 'knowledge'],
    };
    const terms = map[priority] || [];
    return terms.some((term) => text.includes(term));
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  async _ensureDataDir() {
    try {
      await fs.mkdir(this.config.dataPath, { recursive: true });
    } catch (e) {
      this.config.logger.error('[ExecutiveCockpit] data dir error', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  async _load() {
    try {
      const raw = await fs.readFile(this.storePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.ownerPriority) {
        this.ownerPriority = parsed.ownerPriority;
        this.interactions = Array.isArray(parsed.interactions) ? parsed.interactions : [];
      } else {
        throw new Error('invalid snapshot');
      }
    } catch (e) {
      if (e.code === 'ENOENT') {
        this.ownerPriority = 'default';
        this.interactions = [];
      } else {
        this.config.logger.error('[ExecutiveCockpit] load error, archiving corrupt store', { error: e instanceof Error ? e.message : String(e) });
        await this._archiveCorruptStore();
        this.ownerPriority = 'default';
        this.interactions = [];
      }
    }
  }

  async _archiveCorruptStore() {
    try {
      const corruptPath = `${this.storePath}.corrupt.${Date.now()}`;
      await fs.rename(this.storePath, corruptPath);
    } catch (archiveError) {
      this.config.logger.error('[ExecutiveCockpit] failed to archive corrupt store', { error: archiveError instanceof Error ? archiveError.message : String(archiveError) });
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
      ownerPriority: this.ownerPriority,
      interactions: this.interactions.slice(-1000),
    };
    const temp = `${this.storePath}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(snapshot, null, 2));
      await fs.rename(temp, this.storePath);
    } catch (e) {
      this.config.logger.error('[ExecutiveCockpit] persist error', { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

module.exports = ExecutiveCockpit;
module.exports.VALID_PRIORITIES = VALID_PRIORITIES;
