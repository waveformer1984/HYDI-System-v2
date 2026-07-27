'use strict';

const BriefingRenderer = require('./BriefingRenderer');
const { VALID_PRIORITIES } = require('./ExecutiveCockpit');

const ORDINAL_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};

function parseOrdinal(token) {
  if (!token) return null;
  const t = token.trim().toLowerCase();
  if (ORDINAL_WORDS[t]) return ORDINAL_WORDS[t];
  const n = parseInt(t.replace(/(st|nd|rd|th)$/, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * ConversationEngine is the interaction layer described in Phase 15: a
 * context-aware conversation surface built strictly on top of
 * ExecutiveOperatingSystem, ExecutiveCockpit, ApprovalCenter, AgentWorkspace,
 * ExecutiveTimeline, and SessionMemory.
 *
 * It intentionally does not replace ExecutiveCockpit — every command
 * ExecutiveCockpit already understands (status, focus, approvals, history,
 * workflows, approve/reject <id>, priority <p>, help) keeps working exactly
 * as before, because unrecognized text always falls through to
 * `cockpit.handleCommand`. This engine only adds what the cockpit could not
 * do on its own: a full briefing on greeting, contextual follow-ups that
 * remember what was just discussed, ordinal/pronoun resolution ("explain
 * recommendation two", "approve it"), agent-workspace and timeline access,
 * and the extra command-palette verbs (recommend, simulate, health, backup).
 *
 * Every action that changes anything still goes through ApprovalCenter, which
 * in turn only ever calls ExecutionGateway or BusinessWorkflowEngine. This
 * layer adds language, not authority.
 */
class ConversationEngine {
  constructor(config = {}) {
    this.cockpit = config.cockpit || null;
    this.executiveOS = config.executiveOS || null;
    this.memory = config.memory || null;
    this.workflowEngine = config.workflowEngine || null;
    this.executionGateway = config.executionGateway || null;
    this.strategicObjectives = config.strategicObjectives || null;
    this.agentWorkspace = config.agentWorkspace || null;
    this.approvalCenter = config.approvalCenter || null;
    this.timeline = config.timeline || null;
    this.sessionMemory = config.sessionMemory || null;
    this.certify = config.certify || null;
    this.logger = config.logger || console;

    // Transient, re-derived-each-turn caches. Not persisted: they are cheap
    // to recompute and always reflect the live system rather than a stale
    // snapshot from a previous session.
    this.lastRecommendations = [];
    this.lastApprovalIds = [];
    this.lastMentionedApprovalId = null;
    this.lastBriefingAt = null;
  }

  healthCheck() {
    const checks = {
      hasCockpit: !!this.cockpit,
      hasExecutiveOS: !!this.executiveOS,
    };
    return { ok: Object.values(checks).every(Boolean), checks };
  }

  context() {
    return this.sessionMemory ? this.sessionMemory.getContext() : {};
  }

  /**
   * Handle one line of natural-language input. Always returns
   * `{ text, intent, ... }`. Never throws for a bad or ambiguous command —
   * it responds like a COO would: it says what it does not have.
   */
  async ask(rawText) {
    const text = String(rawText === undefined || rawText === null ? '' : rawText).trim();
    if (this.sessionMemory) this.sessionMemory.recordCommand(text);

    const response = await this._route(text);

    // cockpit.handleCommand() already emits 'interaction' itself when the
    // engine delegates to it, so only emit here for intents this engine
    // handled directly — otherwise the timeline would double-record.
    if (this.cockpit && typeof this.cockpit.emit === 'function'
      && response.intent !== 'cockpit' && response.intent !== 'unknown' && response.intent !== 'empty') {
      this.cockpit.emit('interaction', { at: Date.now(), command: response.intent, text, response });
    }

    if (this.sessionMemory) this.sessionMemory.recordConversationTurn(text, response);
    return response;
  }

  // -------------------------------------------------------------------------
  // Routing
  // -------------------------------------------------------------------------

  async _route(text) {
    const t = text.toLowerCase().trim().replace(/[.!?]+$/, '');
    if (!t) return this._respond('empty', { text: 'Say "good morning", "help", or ask a question.' });

    if (/^(good morning|morning|hello|hi|hey)$/.test(t)) return this._goodMorning();
    if (/^what changed( overnight)?\??$/.test(t) || /^what'?s new\??$/.test(t)) return this._whatChanged();
    if (/^what deserves my attention\??$/.test(t) || /^what needs my attention\??$/.test(t)) return this._attention();
    if (/^what should (we|i) build( today)?\??$/.test(t)) return this._buildToday();
    if (/^what'?s blocking (revenue|sales)\??$/.test(t) || /^what is blocking (revenue|sales)\??$/.test(t)) return this._blockingRevenue();
    if (/^what can you do (without me|autonomously|on your own)\??$/.test(t)) return this._autonomousCapabilities();
    if (/^review status\??$/.test(t) || /^midday review\??$/.test(t)) return this._delegate('review status');
    if (/^daily close\??$/.test(t) || /^end of day\??$/.test(t)) return this._delegate('daily close');

    let m;
    if ((m = t.match(/^what about (.+?)\??$/))) return this._whatAbout(m[1]);
    if ((m = t.match(/^explain recommendation (.+)$/))) return this._explainRecommendation(m[1]);
    if ((m = t.match(/^explain (?:approval )?(.+)$/)) && this.approvalCenter && this.approvalCenter.get(m[1].trim())) {
      return this._explainApproval(m[1].trim());
    }
    if ((m = t.match(/^show (approvals|approval center)$/))) return this._showApprovals();
    if ((m = t.match(/^show (.+)$/))) return this._showAgent(m[1]);
    if ((m = t.match(/^focus (?:on )?(.+)$/))) return this._focus(m[1]);
    if (/^recommend$/.test(t)) return this._recommend();
    if (/^recommendations$/.test(t)) return this._delegate('recommendations');
    if (/^timeline$/.test(t)) return this._timeline();
    if (/^hydi health$/.test(t)) return this._systemStatus();
    if (/^(business )?health$/.test(t)) return this._health();
    if (/^backup$/.test(t)) return this._backup();

    if ((m = t.match(/^approve\s+(it|this|that)$/))) return this._approve(this._resolvePronoun());
    if ((m = t.match(/^reject\s+(it|this|that)$/))) return this._reject(this._resolvePronoun());
    if ((m = t.match(/^simulate(?:\s+(.+))?$/))) return this._simulate(m[1] ? this._resolveApprovalToken(m[1]) : this._defaultApprovalId());
    if ((m = t.match(/^(?:request )?modif(?:y|ication)\s+(it|this|that)[:,]?\s*(.*)$/))) {
      return this._requestModification(this._resolvePronoun(), m[2]);
    }
    if ((m = t.match(/^(?:request )?modif(?:y|ication)\s+(\S+)[:,]?\s*(.*)$/))) {
      return this._requestModification(this._resolveApprovalToken(m[1]), m[2]);
    }
    if ((m = t.match(/^approve\s+(\S+)$/))) return this._approve(this._resolveApprovalToken(m[1]));
    if ((m = t.match(/^reject\s+(\S+)$/))) return this._reject(this._resolveApprovalToken(m[1]));

    if (/^help$/.test(t) || t === '?') return this._help();

    return this._delegate(text);
  }

  // -------------------------------------------------------------------------
  // Greeting / situational awareness
  // -------------------------------------------------------------------------

  _goodMorning() {
    if (!this.executiveOS) return this._delegate('good morning');
    const briefing = this.executiveOS.morningBriefing();
    this.lastRecommendations = (briefing.recommendations || []).map((r, i) => ({ ...r, ordinal: i + 1 }));
    this.lastBriefingAt = briefing.generatedAt;
    return this._respond('good-morning', {
      text: BriefingRenderer.toText(briefing),
      briefing,
      sections: BriefingRenderer.toSections(briefing),
    });
  }

  _whatChanged() {
    if (this.executiveOS && this.executiveOS.recentActivitySummary) {
      const summary = this.executiveOS.recentActivitySummary(86400000);
      const lines = ['What changed today:', '', ...summary.lines];
      return this._respond('what-changed', { text: lines.join('\n'), ...summary });
    }
    if (!this.timeline) return this._respond('what-changed', { text: 'Executive timeline is not connected.' });
    const since = this.lastBriefingAt || (Date.now() - 86400000);
    const diff = this.timeline.since(since);
    if (diff.count === 0) {
      return this._respond('what-changed', { text: 'Nothing recorded since the last briefing.', ...diff });
    }
    const lines = ['Since the last briefing:', ''];
    for (const [category, items] of Object.entries(diff.byCategory)) {
      lines.push(`${category} (${items.length}):`);
      items.slice(0, 5).forEach((i) => lines.push(`  - ${i.summary}`));
    }
    return this._respond('what-changed', { text: lines.join('\n'), ...diff });
  }

  _attention() {
    const risks = this.executiveOS ? this.executiveOS.risks() : [];
    const approvals = this.approvalCenter ? this.approvalCenter.list() : [];
    this.lastApprovalIds = approvals.map((a) => a.id);
    const lines = ['What deserves your attention:', ''];
    if (risks.length === 0 && approvals.length === 0) {
      lines.push('Nothing urgent. All tracked risks are clear and there are no pending approvals.');
    } else {
      if (risks.length) {
        lines.push(`Risks (${risks.length}):`);
        risks.slice(0, 5).forEach((r) => lines.push(`  - [${r.severity}] ${r.name}: ${r.detail}`));
      }
      if (approvals.length) {
        lines.push('', `Pending approvals (${approvals.length}):`);
        approvals.slice(0, 5).forEach((a) => lines.push(`  - [${a.id}] ${a.title} — ${a.businessValue}`));
      }
    }
    return this._respond('attention', { text: lines.join('\n'), risks, approvals });
  }

  _buildToday() {
    const recs = this._rankedRecommendations(5);
    this.lastRecommendations = recs.map((r, i) => ({ ...r, ordinal: i + 1 }));
    if (recs.length === 0) return this._respond('build-today', { text: 'No scored recommendations available yet — add business data or approve a workflow to seed one.' });
    const lines = ['What to build today:', ''];
    recs.forEach((r, i) => lines.push(`${i + 1}. ${r.action || r.title}: ${r.reason || r.detail}`));
    return this._respond('build-today', { text: lines.join('\n'), recommendations: recs });
  }

  _blockingRevenue() {
    const risks = this.executiveOS ? this.executiveOS.risks() : [];
    const salesView = this.agentWorkspace ? this.agentWorkspace.getAgent('Sales Manager') : null;
    const relevant = risks.filter((r) => /sale|revenue|customer|opportunity|financial/.test(`${r.category} ${r.name} ${r.detail}`.toLowerCase()));
    const lines = ['Blocking revenue:', ''];
    if (relevant.length === 0 && (!salesView || salesView.risks.length === 0)) {
      lines.push('No revenue-blocking risks identified from current BusinessMemory data.');
    } else {
      relevant.forEach((r) => lines.push(`- [${r.severity}] ${r.name}: ${r.detail}`));
      if (salesView) salesView.risks.forEach((r) => lines.push(`- [${r.severity}] ${r.name}: ${r.detail}`));
    }
    if (salesView) {
      lines.push('', 'Sales priorities:');
      salesView.priorities.forEach((p) => lines.push(`  - ${p}`));
    }
    return this._respond('blocking-revenue', { text: lines.join('\n'), risks: relevant, salesView });
  }

  _autonomousCapabilities() {
    const caps = this.executionGateway ? this.executionGateway.getCapabilities().filter((c) => c.actionClass === 'autonomous') : [];
    const autoApproveTypes = ['research', 'creative', 'technical'];
    const lines = ['Without asking you, I can:', ''];
    caps.forEach((c) => lines.push(`  - ${c.action} (${c.adapter})`));
    lines.push('', `Workflow types that auto-approve below their thresholds: ${autoApproveTypes.join(', ')}, plus small sales/manufacturing workflows.`);
    lines.push('', 'Everything else is prepared and queued, but waits for your approval in the Approval Center.');
    return this._respond('autonomous-capabilities', { text: lines.join('\n'), capabilities: caps });
  }

  // -------------------------------------------------------------------------
  // Contextual follow-ups
  // -------------------------------------------------------------------------

  _whatAbout(query) {
    const q = query.trim();

    const objective = this.strategicObjectives
      ? this.strategicObjectives.getAll().find((o) => o.id === q.toLowerCase().replace(/\s+/g, '-') || o.name.toLowerCase() === q.toLowerCase())
      : null;

    // Flagship objectives (e.g., Resonate) are reported as strategic status first.
    if (objective && objective.category === 'flagship' && this.executiveOS) {
      if (this.sessionMemory) { this.sessionMemory.setFocus(objective.id); this.sessionMemory.setActiveObjective(objective.id); }
      const priorityActions = this.executiveOS.priorityActions(10);
      const status = this.executiveOS.getObjectiveStatus(objective.id, priorityActions);
      const lines = [
        `${objective.name} (${objective.category}, priority ${objective.priority}):`,
        '',
        `Progress: ${Math.round((status.progress || 0) * 100)}%, release ready: ${!!status.releaseReady}.`,
        `Blockers: ${status.blockers.length}`,
        ...status.blockers.map((b) => `  - ${b.name}${b.reason ? `: ${b.reason}` : ''}`),
        `Opportunities: ${status.opportunities.length}`,
        `Customer signals: ${status.customerSignals}`,
      ];
      return this._respond('what-about', { text: lines.join('\n'), objective, status });
    }

    const agentName = this.agentWorkspace ? this.agentWorkspace.findAgentByQuery(q) : null;
    if (agentName) return this._showAgent(agentName);

    if (objective && this.executiveOS) {
      if (this.sessionMemory) { this.sessionMemory.setFocus(objective.id); this.sessionMemory.setActiveObjective(objective.id); }
      const priorityActions = this.executiveOS.priorityActions(10);
      const status = this.executiveOS.getObjectiveStatus(objective.id, priorityActions);
      const lines = [
        `${objective.name} (${objective.category}, priority ${objective.priority}):`,
        '',
        `Progress: ${Math.round((status.progress || 0) * 100)}%, release ready: ${!!status.releaseReady}.`,
        `Blockers: ${status.blockers.length}`,
        ...status.blockers.map((b) => `  - ${b.name}${b.reason ? `: ${b.reason}` : ''}`),
        `Opportunities: ${status.opportunities.length}`,
        `Customer signals: ${status.customerSignals}`,
      ];
      return this._respond('what-about', { text: lines.join('\n'), objective, status });
    }

    return this._respond('what-about', { text: `I don't have "${query}" tracked as a strategic objective or agent domain yet.` });
  }

  _explainRecommendation(token) {
    const ordinal = parseOrdinal(token);
    const index = ordinal ? ordinal - 1 : -1;
    const rec = this.lastRecommendations[index];
    if (!rec) {
      return this._respond('explain-recommendation', {
        text: `I don't have a recommendation "${token}" in view. Ask for "recommend" or "good morning" first.`,
      });
    }
    const explanation = this.agentWorkspace ? this.agentWorkspace.explainRecommendation(rec) : {};
    const confidence = explanation.confidence || (rec.confidence !== undefined ? `${Math.round(rec.confidence * 100)}%` : 'unknown');
    const sources = (rec.provenance && rec.provenance.sources) || explanation.dataSources || [];
    const assumptions = (rec.provenance && rec.provenance.assumptions) || explanation.assumptions || [];
    const lines = [
      `${rec.action || rec.title}:`,
      '',
      `Why: ${explanation.why || rec.reason || rec.provenance?.reasoning || 'No explicit reasoning recorded.'}`,
      `Expected outcome: ${explanation.expectedOutcome || rec.expectedOutcome || rec.expectedImpact || 'Not modeled.'}`,
      `Business impact: ${explanation.businessImpact || rec.expectedImpact || 'Not quantified.'}`,
      `Risk: ${explanation.risk || (rec.risk !== undefined ? rec.risk.toFixed(2) : 'unknown')}`,
      `Estimated effort: ${explanation.estimatedEffort || rec.effort || 'unknown'}`,
      `Strategic objective: ${explanation.strategicObjective || rec.objective || rec.provenance?.objective || 'None'}`,
      `Confidence: ${confidence}`,
      `Requires approval: ${explanation.requiredApproval || 'Depends on action type'}`,
      '',
      'Data sources used:',
      ...(sources.length ? sources.map((s) => `- ${s}`) : ['- None recorded.']),
      '',
      'Assumptions:',
      ...(assumptions.length ? assumptions.map((a) => `- ${a}`) : ['- None recorded.']),
    ];
    return this._respond('explain-recommendation', { text: lines.join('\n'), recommendation: rec, explanation, provenance: rec.provenance });
  }

  _explainApproval(id) {
    const explained = this.approvalCenter.explain(id);
    if (!explained.ok) return this._respond('explain-approval', { text: explained.message });
    this.lastMentionedApprovalId = id;
    const lines = [
      `Recommendation: ${explained.recommendation}`,
      `Why: ${explained.why}`,
      `Expected outcome: ${explained.expectedOutcome}`,
      `Business impact: ${explained.businessImpact}`,
      `Risk: ${explained.risk}`,
      `Undo path: ${explained.undoPath}`,
      `Audit consequences: ${explained.auditConsequences}`,
      `Estimated effort: ${explained.estimatedEffort}`,
      `Strategic objective: ${explained.strategicObjective}`,
      `Confidence: ${explained.confidence}`,
      `Required approval: ${explained.requiredApproval}`,
      `Responsible agent: ${explained.responsibleAgent}`,
      `Evidence: ${explained.evidence}`,
    ];
    return this._respond('explain-approval', { text: lines.join('\n'), explanation: explained });
  }

  _showApprovals() {
    if (!this.approvalCenter) return this._respond('show-approvals', { text: 'Approval Center is not connected.' });
    const approvals = this.approvalCenter.list();
    this.lastApprovalIds = approvals.map((a) => a.id);
    if (approvals.length === 1) this.lastMentionedApprovalId = approvals[0].id;
    if (approvals.length === 0) return this._respond('show-approvals', { text: 'No pending approvals.', approvals });
    const lines = [`Pending approvals (${approvals.length}):`, ''];
    approvals.forEach((a, i) => lines.push(`${i + 1}. [${a.id}] ${a.title} — value ${a.businessValue}, risk ${a.risk}, agent ${a.responsibleAgent}`));
    return this._respond('show-approvals', { text: lines.join('\n'), approvals });
  }

  _showAgent(query) {
    if (!this.agentWorkspace) return this._respond('show-agent', { text: 'Agent Workspace is not connected.' });
    const name = this.agentWorkspace.findAgentByQuery(query.trim());
    if (!name) return this._respond('show-agent', { text: `No agent domain matches "${query}".` });
    const view = this.agentWorkspace.getAgent(name);
    if (this.sessionMemory) this.sessionMemory.setFocus(name);
    if (!view.available) return this._respond('show-agent', { text: `${name}: ${view.reason}` });
    const lines = [
      `${name}:`,
      '',
      'Priorities:',
      ...view.priorities.map((p) => `  - ${p}`),
      '',
      `Confidence: ${Math.round(view.confidence * 100)}%`,
      `Pending work: ${view.pendingWork.length}`,
      `Risks: ${view.risks.length}`,
    ];
    return this._respond('show-agent', { text: lines.join('\n'), agent: view });
  }

  _focus(token) {
    const p = token.trim().toLowerCase();
    if (VALID_PRIORITIES.has(p)) {
      if (this.cockpit) this.cockpit.setOwnerPriority(p);
      if (this.sessionMemory) { this.sessionMemory.setOwnerPriority(p); this.sessionMemory.setFocus(p); }
      const objective = this.strategicObjectives ? this.strategicObjectives.getByOwnerPriority(p) : null;
      if (objective && this.executiveOS) return this._whatAbout(objective.name);
      return this._respond('focus', { text: `Owner priority set to ${p}.` });
    }
    return this._whatAbout(token);
  }

  _recommend() {
    const recs = this._rankedRecommendations(5);
    this.lastRecommendations = recs.map((r, i) => ({ ...r, ordinal: i + 1 }));
    if (recs.length === 0) return this._respond('recommend', { text: 'No ranked recommendations available right now.' });
    const lines = ['Recommendations:', ''];
    recs.forEach((r, i) => lines.push(`${i + 1}. ${r.action || r.title}: ${r.reason || r.detail}`));
    return this._respond('recommend', { text: lines.join('\n'), recommendations: recs });
  }

  _timeline() {
    if (!this.timeline) return this._respond('timeline', { text: 'Executive timeline is not connected.' });
    const items = this.timeline.list({ limit: 20 });
    if (items.length === 0) return this._respond('timeline', { text: 'No timeline events recorded yet.', items });
    const lines = ['Recent activity:', ''];
    items.forEach((i) => lines.push(`[${new Date(i.at).toISOString()}] (${i.category}) ${i.summary}`));
    return this._respond('timeline', { text: lines.join('\n'), items });
  }

  _systemStatus() {
    if (!this.certify) return this._delegate('hydi health');
    // Lazily required to avoid a circular require with HYDIStartupSequence,
    // which itself constructs an OperatorSession (which constructs this).
    const { toStatusText } = require('./HYDIStartupSequence');
    const report = this.certify();
    return this._respond('system-status', { text: toStatusText(report), report });
  }

  _health() {
    const health = this.buildBusinessHealth();
    const lines = [
      'Business health:', '',
      `Revenue opportunities: ${health.revenue.openOpportunities} (${health.revenue.pipelineValue})`,
      `Manufacturing readiness: ${health.manufacturing.activeEquipment} active, ${health.manufacturing.needsMaintenance} need maintenance`,
      `Research progress: ${health.research.activeExperiments} active, ${health.research.completedExperiments} completed`,
      `Creative pipeline: ${health.creative.activeProjects} active, ${health.creative.prototypes} prototypes`,
      `Financial summary: revenue ${health.financial.revenue}, expenses ${health.financial.expenses}, net ${health.financial.net}`,
      `Known data gaps: ${health.dataGaps.length ? health.dataGaps.join('; ') : 'none'}`,
    ];
    return this._respond('health', { text: lines.join('\n'), health });
  }

  async _backup() {
    const result = await this._runBackup();
    return this._respond('backup', { text: result.text, backup: result });
  }

  async _help() {
    if (this.cockpit) await this.cockpit.handleCommand('help');
    const lines = [
      'Available commands:',
      '  good morning | status | what changed | what deserves my attention',
      '  what should we build today | what\'s blocking revenue | what can you do without me',
      '  what about <objective or agent> | focus <resonate|revenue|manufacturing|...>',
      '  show approvals | show <agent domain> | approve <id|it> | reject <id|it>',
      '  explain recommendation <n> | modify <id> <notes> | simulate [<id>]',
      '  recommend | timeline | health | hydi health | backup | help',
    ];
    return this._respond('help', { text: lines.join('\n') });
  }

  // -------------------------------------------------------------------------
  // Approval verbs (shared by pronoun and explicit-id routes)
  // -------------------------------------------------------------------------

  async _approve(id) {
    if (!id || !this.approvalCenter) return this._respond('approve', { text: 'No pending approval to approve.' });
    const result = await this.approvalCenter.approve(id);
    return this._respond('approve', { text: result.ok ? `Approved ${id}.` : result.message, result });
  }

  async _reject(id) {
    if (!id || !this.approvalCenter) return this._respond('reject', { text: 'No pending approval to reject.' });
    const result = this.approvalCenter.reject(id);
    return this._respond('reject', { text: result.ok ? `Rejected ${id}.` : result.message, result });
  }

  async _simulate(id) {
    if (!id || !this.approvalCenter) return this._respond('simulate', { text: 'No pending approval to simulate.' });
    const result = await this.approvalCenter.simulate(id);
    return this._respond('simulate', { text: result.ok ? `Simulated ${id}: ${JSON.stringify(result.preview)}` : result.message, result });
  }

  _requestModification(id, notes) {
    if (!id || !this.approvalCenter) return this._respond('modify', { text: 'No pending approval to modify.' });
    const result = this.approvalCenter.requestModification(id, notes);
    return this._respond('modify', { text: result.ok ? `Modification requested on ${id}.` : result.message, result });
  }

  _resolvePronoun() {
    if (this.lastMentionedApprovalId) return this.lastMentionedApprovalId;
    if (this.lastApprovalIds.length === 1) return this.lastApprovalIds[0];
    if (this.approvalCenter) {
      const list = this.approvalCenter.list();
      if (list.length === 1) return list[0].id;
    }
    return null;
  }

  _resolveApprovalToken(token) {
    const t = (token || '').trim();
    const ordinal = parseOrdinal(t);
    if (ordinal && this.lastApprovalIds[ordinal - 1]) return this.lastApprovalIds[ordinal - 1];
    if (this.approvalCenter && this.approvalCenter.get(t)) {
      this.lastMentionedApprovalId = t;
      return t;
    }
    return t || null;
  }

  _defaultApprovalId() {
    if (!this.approvalCenter) return null;
    const list = this.approvalCenter.list();
    return list.length > 0 ? list[0].id : null;
  }

  // -------------------------------------------------------------------------
  // Shared read-models
  // -------------------------------------------------------------------------

  _rankedRecommendations(limit) {
    if (this.workflowEngine && this.workflowEngine.getRankedRecommendations) {
      const recs = this.workflowEngine.getRankedRecommendations(limit);
      if (recs.length > 0) return recs;
    }
    if (this.executiveOS) {
      return (this.executiveOS.morningBriefing().recommendations || []).slice(0, limit);
    }
    return [];
  }

  buildBusinessHealth() {
    const reports = this.executiveOS ? this.executiveOS.morningBriefing().agentReports || {} : {};
    const sales = reports['Sales Manager'] || {};
    const manufacturing = reports['Manufacturing Manager'] || {};
    const research = reports['Research Manager'] || {};
    const creative = reports['Creative Director'] || {};
    const finance = reports['Finance Analyst'] || {};
    const missingData = this.executiveOS ? (this.executiveOS.morningBriefing().missingData || []) : [];
    const strategic = this.strategicObjectives && this.executiveOS ? this.strategicObjectives.summarize(this.executiveOS.memory) : [];

    return {
      revenue: { openOpportunities: sales.openOpportunities || 0, pipelineValue: sales.pipelineValue || 0 },
      manufacturing: {
        activeEquipment: manufacturing.activeEquipment || 0,
        needsMaintenance: (manufacturing.needsMaintenance || []).length,
      },
      research: {
        activeExperiments: research.activeExperiments || 0,
        completedExperiments: research.completedExperiments || 0,
      },
      creative: {
        activeProjects: creative.activeCreativeProjects || 0,
        prototypes: creative.prototypeCount || 0,
      },
      financial: {
        revenue: finance.revenueOpportunityValue || 0,
        expenses: finance.trackedExpenses || 0,
        net: finance.projectedNet || 0,
      },
      strategicObjectives: strategic,
      dataGaps: missingData,
    };
  }

  async _runBackup() {
    // Delegated to whatever host object provides a backup implementation
    // (ConsoleAPI wires this up with real filesystem access, and records the
    // timeline entry itself). Without one, report the limitation rather than
    // pretending a backup happened.
    if (typeof this.onBackup === 'function') {
      return this.onBackup();
    }
    return { text: 'No backup handler configured.', ok: false };
  }

  // -------------------------------------------------------------------------
  // Fallback
  // -------------------------------------------------------------------------

  async _delegate(text) {
    if (!this.cockpit) return this._respond('unknown', { text: 'I did not understand. Try "help".' });
    const response = await this.cockpit.handleCommand(text);
    return { ...response, intent: response.intent || 'cockpit' };
  }

  _respond(intent, payload) {
    return { intent, ...payload };
  }
}

module.exports = ConversationEngine;
module.exports.parseOrdinal = parseOrdinal;
