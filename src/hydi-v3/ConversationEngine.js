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
    this.recommendationTracker = config.recommendationTracker || null;
    this.businessEvidenceEngine = config.businessEvidenceEngine || null;
    this.modelRouter = config.modelRouter || null;
    this.useLLMIntent = config.useLLMIntent !== false;
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
    const raw = String(rawText === undefined || rawText === null ? '' : rawText).trim();
    if (this.sessionMemory) this.sessionMemory.recordCommand(raw);

    const response = await this._route(raw);

    // cockpit.handleCommand() already emits 'interaction' itself when the
    // engine delegates to it, so only emit here for intents this engine
    // handled directly — otherwise the timeline would double-record.
    if (this.cockpit && typeof this.cockpit.emit === 'function'
      && response.intent !== 'cockpit' && response.intent !== 'unknown' && response.intent !== 'empty') {
      this.cockpit.emit('interaction', { at: Date.now(), command: response.intent, text: raw, response });
    }

    if (this.sessionMemory) this.sessionMemory.recordConversationTurn(raw, response);
    return response;
  }

  // -------------------------------------------------------------------------
  // Routing
  // -------------------------------------------------------------------------

  async _route(rawText) {
    const t = rawText.toLowerCase().trim().replace(/[.!?]+$/, '');
    if (!t) return this._respond('empty', { text: 'Say "good morning", "help", or ask a question.' });

    if (/^(good morning|morning|hello|hi|hey|hey there|hey there protoforge)$/.test(t)) return this._goodMorning();
    if (/^prepare (my |today'?s )?executive briefing$/.test(t)) return this._goodMorning();
    if (/^what changed since (this morning|the last briefing|the morning|lunch|breakfast|dinner|yesterday)\??$/.test(t)) return this._whatChangedSinceBriefing();
    if (/^what changed( overnight| today| recently)?\??$/.test(t) || /^what'?s new\??$/.test(t) || /^what happened since (lunch|breakfast|dinner|yesterday|this morning)\??$/.test(t)) return this._whatChanged();
    if (/^what deserves my attention( today| right now| now)?\??$/.test(t) || /^what needs my attention( today)?\??$/.test(t) || /^what'?s urgent\??$/.test(t) || /^anything urgent\??$/.test(t) || /^what should i look at\??$/.test(t) || /^what needs me\??$/.test(t)) return this._attention();
    if (/^what should (we|i) (build|work on)( today| first| next)?\??$/.test(t) || /^what to build( today)?\??$/.test(t) || /^what needs (building|work)( today)?\??$/.test(t) || /^what are my priorities\??$/.test(t)) return this._buildToday();
    if (/^what'?s blocking( me| us| progress| work)?\??$/.test(t) || /^what is blocking( me| us| progress| work)?\??$/.test(t) || /^where am i stuck\??$/.test(t) || /^where are we stuck\??$/.test(t) || /^what is stuck\??$/.test(t)) return this._blocking();
    if (/^what'?s blocking (revenue|sales|money)\??$/.test(t) || /^what is blocking (revenue|sales|money)\??$/.test(t) || /^why is revenue down\??$/.test(t) || /^sales blockers\??$/.test(t)) return this._blockingRevenue();
    if (/^what did we learn( yesterday| today| recently)?\??$/.test(t) || /^what have we learned\??$/.test(t) || /^lessons( learned)?\??$/.test(t)) return this._whatDidWeLearn();
    if (/^which recommendation turned out to be wrong\??$/.test(t) || /^what recommendations failed\??$/.test(t) || /^which one was wrong\??$/.test(t) || /^failed recommendations\??$/.test(t) || /^recommendation mistakes\??$/.test(t) || /^which recommendation was wrong\??$/.test(t)) return this._wrongRecommendations();
    if (/^show me (the )?risky assumptions\??$/.test(t) || /^show me (the )?risks?\??$/.test(t) || /^what are (our|the) risky assumptions\??$/.test(t) || /^what could go wrong\??$/.test(t)) return this._showRisks();
    if (/^why are you recommending this\??$/.test(t) || /^why this recommendation\??$/.test(t)) return this._explainThisRecommendation();
    if (/^what would you do( next)? if i left for the day\??$/.test(t) || /^what would you do next\??$/.test(t) || /^what should you do next\??$/.test(t) || /^what should (we|i) do next\??$/.test(t)) return this._whatWouldYouDo();
    if (/^what can you do (without me|autonomously|on your own|alone)\??$/.test(t) || /^what do you not need me for\??$/.test(t) || /^autonomous actions\??$/.test(t) || /^what can you do without asking\??$/.test(t)) return this._autonomousCapabilities();
    if (/^recommend$/.test(t) || /^recommendations$/.test(t) || /^what should i do\??$/.test(t) || /^what should (we|i) do next\??$/.test(t) || /^what would you recommend\??$/.test(t) || /^what do you suggest\??$/.test(t) || /^what should (we|i) work on next\??$/.test(t) || /^what are your recommendations\??$/.test(t)) return this._recommend();
    if (/^review status\??$/.test(t) || /^midday review\??$/.test(t) || /^afternoon status\??$/.test(t)) return this._delegate('review status');
    if (/^daily close\??$/.test(t) || /^end of day\??$/.test(t) || /^close$/.test(t) || /^what did we do today\??$/.test(t) || /^good night$/.test(t) || /^goodnight$/.test(t)) return this._delegate('daily close');

    let m;
    if ((m = t.match(/^what about (.+?)\??$/))) return this._whatAbout(m[1]);
    if ((m = t.match(/^explain recommendation (.+)$/))) return this._explainRecommendation(m[1]);
    if ((m = t.match(/^explain (?:approval )?(.+)$/)) && this.approvalCenter && this.approvalCenter.get(m[1].trim())) {
      return this._explainApproval(m[1].trim());
    }
    if ((m = t.match(/^show (approvals|approval center)$/))) return this._showApprovals();
    if ((m = t.match(/^show (history|learning|kpis|measured learning|measured)$/))) {
      const cmd = m[1] === 'measured learning' ? 'measured' : m[1];
      return this._delegate(cmd);
    }
    if ((m = t.match(/^show (.+)$/))) return this._showAgent(m[1]);
    if ((m = t.match(/^focus (?:on )?(.+)$/))) return this._focus(m[1]);
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

    // Conversational action creation
    if ((m = t.match(/^do\s+(.+)$/))) return this._createAction('do', m[1]);
    if ((m = t.match(/^start\s+(.+)$/))) return this._createAction('start', m[1]);
    if ((m = t.match(/^create\s+(?:a\s+)?task[:;]?\s*(.+)$/))) return this._createAction('create-task', m[1]);
    if ((m = t.match(/^remind\s+me\s+(?:to\s+)?(.+)$/))) return this._createAction('remind', m[1]);
    if ((m = t.match(/^investigate\s+(.+)$/))) return this._createAction('investigate', m[1]);
    if ((m = t.match(/^analyze\s+(.+)$/))) return this._createAction('analyze', m[1]);
    if ((m = t.match(/^print\s+(.+)$/))) return this._createAction('print', m[1]);
    if ((m = t.match(/^generate\s+(.+)$/))) return this._createAction('generate', m[1]);
    if ((m = t.match(/^build\s+(.+)$/))) return this._createAction('build', m[1]);
    if ((m = t.match(/^monitor\s+(.+)$/))) return this._createAction('monitor', m[1]);
    if ((m = t.match(/^review\s+(.+)$/))) {
      const subject = m[1].trim();
      if (this.workflowEngine && this.workflowEngine.getWorkflow && this.workflowEngine.getWorkflow(subject)) {
        return this._delegate(text);
      }
      return this._createAction('review', subject);
    }

    if (/^(help|\?|what can i ask|what should i say|commands|what are the commands|available commands)$/.test(t)) return this._help();

    if (this.modelRouter && this.useLLMIntent) {
      const resolved = await this._resolveLLMIntent(rawText);
      if (resolved) return resolved;
    }

    return this._delegate(rawText);
  }

  async _resolveLLMIntent(text) {
    try {
      const extracted = await this.modelRouter.extractIntent(text);
      if (!extracted || !extracted.intent || extracted.intent === 'unknown') return null;
      switch (extracted.intent) {
        case 'good-morning': return this._goodMorning();
        case 'status': return this._delegate('status');
        case 'focus': return this._delegate('focus');
        case 'attention': return this._attention();
        case 'what-changed': return this._whatChanged();
        case 'recommendations': return this._recommend();
        case 'approvals': return this._showApprovals();
        case 'history': return this._delegate('history');
        case 'learning': return this._whatDidWeLearn();
        case 'risks': return this._showRisks();
        case 'daily-close': return this._delegate('daily close');
        case 'help': return this._help();
        default: return null;
      }
    } catch (e) {
      this.logger.error('[ConversationEngine] LLM intent extraction failed', { error: e instanceof Error ? e.message : String(e) });
      return null;
    }
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

  _blocking() {
    const risks = this.executiveOS ? this.executiveOS.risks() : [];
    const blocked = this.agentWorkspace ? Object.entries(this.agentWorkspace.getAll ? this.agentWorkspace.getAll() : {})
      .flatMap(([name, agent]) => (agent.blockedTasks || []).map((task) => ({ agent: name, task }))) : [];
    const lines = ['What is blocking progress:', ''];
    if (risks.length === 0 && blocked.length === 0) {
      lines.push('No risks or blocked tasks are currently tracked.');
    } else {
      if (risks.length) {
        lines.push(`Risks (${risks.length}):`);
        risks.slice(0, 5).forEach((r) => lines.push(`  - [${r.severity}] ${r.name}: ${r.detail}`));
      }
      if (blocked.length) {
        lines.push('', `Blocked work (${blocked.length}):`);
        blocked.slice(0, 5).forEach((b) => lines.push(`  - ${b.agent}: ${b.task}`));
      }
    }
    return this._respond('blocking', { text: lines.join('\n'), risks, blocked });
  }

  _whatDidWeLearn() {
    if (!this.businessEvidenceEngine) return this._respond('what-did-we-learn', { text: 'Learning engine is not connected.' });
    const completed = this.businessEvidenceEngine.getCompletedLearning ? this.businessEvidenceEngine.getCompletedLearning().slice(0, 10) : [];
    if (completed.length === 0) return this._respond('what-did-we-learn', { text: 'No measured outcomes yet. Record some with "measure <id> success" or "measure revenue +X".' });
    const lines = ['What we learned:', ''];
    completed.forEach((r) => {
      const outcome = r.observedOutcome || {};
      lines.push(`- [${r.id}] ${r.action}: ${outcome.type}${outcome.actual !== null && outcome.actual !== undefined ? ` (${outcome.actual})` : ''} — confidence ${r.confidence ? (r.confidence * 100).toFixed(0) + '%' : 'unknown'}`);
    });
    return this._respond('what-did-we-learn', { text: lines.join('\n'), completed });
  }

  _wrongRecommendations() {
    if (!this.businessEvidenceEngine) return this._respond('wrong-recommendations', { text: 'Learning engine is not connected.' });
    const losing = this.businessEvidenceEngine.getRecommendationsLosingConfidence ? this.businessEvidenceEngine.getRecommendationsLosingConfidence().slice(0, 5) : [];
    const failed = this.businessEvidenceEngine.getCompletedLearning ? this.businessEvidenceEngine.getCompletedLearning().filter((r) => r.observedOutcome && ['failed', 'unsuccessful', 'abandoned'].includes(r.observedOutcome.type)).slice(0, 5) : [];
    if (losing.length === 0 && failed.length === 0) return this._respond('wrong-recommendations', { text: 'No recommendations have been marked wrong or are losing confidence.' });
    const lines = ['Recommendations that turned out wrong:', ''];
    failed.forEach((r) => lines.push(`- [${r.id}] ${r.action}: ${r.observedOutcome.type}`));
    if (losing.length) {
      lines.push('', 'Losing confidence:');
      losing.forEach((r) => lines.push(`- [${r.id}] ${r.action}: ${r.change ? (r.change * 100).toFixed(0) + '%' : 'down'}`));
    }
    return this._respond('wrong-recommendations', { text: lines.join('\n'), failed, losing });
  }

  _showRisks() {
    const risks = this.executiveOS ? this.executiveOS.risks() : [];
    if (risks.length === 0) return this._respond('show-risks', { text: 'No risks are currently tracked.' });
    const lines = ['Risks and assumptions:', ''];
    risks.forEach((r) => lines.push(`- [${r.severity}] ${r.name}: ${r.detail}`));
    return this._respond('show-risks', { text: lines.join('\n'), risks });
  }

  _explainThisRecommendation() {
    if (!this.lastRecommendations || this.lastRecommendations.length === 0) {
      return this._respond('explain-recommendation', { text: 'Ask for "recommend", "good morning", or "what should I build" first so I have a recommendation in context.' });
    }
    return this._explainRecommendation('1');
  }

  _whatChangedSinceBriefing() {
    if (!this.lastBriefingAt) return this._whatChanged();
    if (this.executiveOS && this.executiveOS.recentActivitySummary) {
      const sinceMs = Date.now() - this.lastBriefingAt;
      const summary = this.executiveOS.recentActivitySummary(sinceMs);
      const lines = ['What changed since the last briefing:', '', ...summary.lines];
      return this._respond('what-changed-since', { text: lines.join('\n'), ...summary });
    }
    if (!this.timeline) return this._respond('what-changed-since', { text: 'Executive timeline is not connected.' });
    const diff = this.timeline.since(this.lastBriefingAt);
    if (diff.count === 0) {
      return this._respond('what-changed-since', { text: 'Nothing recorded since the last briefing.', ...diff });
    }
    const lines = ['Since the last briefing:', ''];
    for (const [category, items] of Object.entries(diff.byCategory)) {
      lines.push(`${category} (${items.length}):`);
      items.slice(0, 5).forEach((i) => lines.push(`  - ${i.summary}`));
    }
    return this._respond('what-changed-since', { text: lines.join('\n'), ...diff });
  }

  _whatWouldYouDo() {
    const recs = this._rankedRecommendations(3);
    const caps = this.executionGateway ? this.executionGateway.getCapabilities().filter((c) => c.actionClass === 'autonomous') : [];
    const lines = ['If you left for the day, I would:', ''];
    if (recs.length === 0) {
      lines.push('There are no ranked recommendations to act on.');
    } else {
      lines.push('Top recommendations to pursue:');
      recs.forEach((r, i) => lines.push(`  ${i + 1}. ${r.action || r.title}${r.reason ? ` — ${r.reason}` : ''}`));
    }
    if (caps.length) {
      lines.push('', 'Autonomous actions I could run without approval:');
      caps.slice(0, 5).forEach((c) => lines.push(`  - ${c.action} (${c.adapter})`));
    }
    lines.push('', 'All other actions would be queued for your approval.');
    return this._respond('what-would-you-do', { text: lines.join('\n'), recommendations: recs, capabilities: caps });
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

  async _createAction(intent, subject) {
    if (!this.executionGateway) return this._respond('create-action', { text: 'ExecutionGateway is not connected.' });

    let recommendationId = null;
    if (this.recommendationTracker) {
      recommendationId = this.recommendationTracker.track({
        action: `${intent} ${subject}`,
        reason: `operator requested ${intent} action`,
        expectedValue: 0,
        originatingAgent: 'operator',
      });
    }

    const action = {
      type: intent,
      params: { description: subject },
      requestingAgent: 'operator',
      recommendationId,
    };
    try {
      const result = await this.executionGateway.execute(action);
      const id = result.id;
      this.lastApprovalIds = [id, ...this.lastApprovalIds].slice(0, 10);
      this.lastMentionedApprovalId = id;
      const recText = recommendationId ? ` (recommendation ${recommendationId})` : '';
      return this._respond('create-action', {
        text: `Created ${intent} action "${subject}" (${id})${recText}. It is ${result.status === 'awaiting-approval' ? 'awaiting approval' : result.status}. Use "approve ${id}" or "approve it" to execute.`,
        action: { id, intent, subject, status: result.status, recommendationId },
      });
    } catch (error) {
      return this._respond('create-action', {
        text: `Could not create ${intent} action: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async _help() {
    if (this.cockpit) await this.cockpit.handleCommand('help');
    const lines = [
      'Available commands:',
      '  good morning | status | what changed | what changed since this morning',
      '  what deserves my attention today | what needs my attention | what\'s blocking progress',
      '  what should we build today | what\'s blocking revenue | what can you do without me',
      '  what did we learn | which recommendation turned out to be wrong | show me the risks',
      '  why are you recommending this | what would you do next if I left for the day',
      '  what about <objective or agent> | focus <resonate|revenue|manufacturing|...>',
      '  show approvals | show <agent domain> | approve <id|it> | reject <id|it>',
      '  explain recommendation <n> | modify <id> <notes> | simulate [<id>]',
      '  do <x> | start <x> | create task <x> | remind me <x> | investigate <x> | analyze <x>',
      '  print <x> | generate <x> | build <x> | review <x> | monitor <x>',
      '  measure <id|keyword> success|failed|partial|abandoned [+/-value]',
      '  customer satisfied | project completed | build failed | awaiting measurements',
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
