'use strict';

/**
 * AgentWorkspace turns the raw, stateless reports produced by ExecutiveAgents
 * (src/hydi-v3/ExecutiveAgents.js) into an operator-facing workspace view for
 * each of the eight executive agents: current priorities, recent work,
 * pending work, recommendations, risks, confidence, and explainability.
 *
 * It reads only from components that are already wired into the executive
 * stack (BusinessMemory via ExecutiveOperatingSystem, ExecutionGateway,
 * BusinessWorkflowEngine). It never invents data: every field a caller asks
 * for either comes from a real report/query or is explicitly marked
 * unavailable, so "never fabricate missing data" holds for the per-agent view
 * exactly as it does for the executive briefing.
 */

const AGENT_ORDER = [
  'Operations Manager',
  'Sales Manager',
  'Manufacturing Manager',
  'Research Manager',
  'Creative Director',
  'Finance Analyst',
  'Technical Architect',
  'Product Manager',
];

const AGENT_DOMAINS = {
  'Operations Manager': {
    keywords: ['operations', 'infrastructure', 'delivery', 'task', 'bottleneck', 'workflow'],
    objectiveId: 'protoforge-operations',
    explain: () => `activeTaskCount/blockedTaskCount are BusinessMemory counts of type=task with status=active/blocked. topBottleneck is the highest-value blocked task.`,
  },
  'Sales Manager': {
    keywords: ['sale', 'customer', 'quote', 'revenue', 'proposal', 'pipeline', 'lead'],
    objectiveId: null,
    explain: () => `openOpportunities/pipelineValue sum BusinessMemory entities with type=opportunity, status=active. activeLeads/activeCustomers count type=client entities tagged "lead" or status=active.`,
  },
  'Manufacturing Manager': {
    keywords: ['manufactur', 'produce', 'printer', 'equipment', 'material'],
    objectiveId: 'manufacturing',
    explain: () => `activeEquipment counts type=equipment with status=active. needsMaintenance flags equipment with status=maintenance or an overdue payload.nextMaintenance. lowInventory flags inventory-tagged equipment at or below its reorder threshold.`,
  },
  'Research Manager': {
    keywords: ['research', 'experiment', 'prototype', 'knowledge'],
    objectiveId: 'research',
    explain: () => `activeExperiments/completedExperiments count type=project entities tagged "research" by status. topExperiment is the highest-value active one.`,
  },
  'Creative Director': {
    keywords: ['creative', 'music', 'release', 'asset', 'design'],
    objectiveId: 'music',
    explain: () => `activeCreativeProjects counts type=project entities tagged "creative" with status=active. prototypeCount counts type=product entities with status=prototype.`,
  },
  'Finance Analyst': {
    keywords: ['finance', 'expense', 'ledger', 'revenue', 'cost', 'budget'],
    objectiveId: null,
    explain: () => `revenueOpportunityValue sums active type=opportunity value. trackedExpenses sums type=expense value. projectedNet is revenue minus expenses; assetValue sums type=asset value.`,
  },
  'Technical Architect': {
    keywords: ['system', 'technical', 'maintenance', 'tech-debt', 'architecture', 'infrastructure'],
    objectiveId: null,
    explain: () => `degradedSystems lists type=equipment entities tagged "system" with status=degraded or maintenance. techDebtCount counts type=task entities tagged "tech-debt".`,
  },
  'Product Manager': {
    keywords: ['flagship', 'resonate', 'roadmap', 'release', 'signal', 'product'],
    objectiveId: 'resonate',
    explain: () => `flagship is the first BusinessMemory entity tagged "flagship". releaseReadiness is completed / total milestone-tagged entities. customerSignals counts entities tagged "signal" or "customer-signal".`,
  },
};

function textOf(item) {
  return `${item.action || item.title || item.name || ''} ${item.reason || item.detail || ''}`.toLowerCase();
}

function matchesDomain(item, domain) {
  const text = textOf(item);
  return domain.keywords.some((k) => text.includes(k));
}

/**
 * AgentWorkspace is a stateless read-model: it holds no data of its own and
 * persists nothing. It is always constructed against a live
 * ExecutiveOperatingSystem (for agents + BusinessMemory + briefing) and,
 * optionally, an ExecutionGateway and BusinessWorkflowEngine for work state.
 */
class AgentWorkspace {
  constructor(config = {}) {
    this.executiveOS = config.executiveOS || null;
    this.executionGateway = config.executionGateway || null;
    this.workflowEngine = config.workflowEngine || null;
  }

  healthCheck() {
    const checks = {
      hasExecutiveOS: !!this.executiveOS,
      knownAgentCount: AGENT_ORDER.length === 8,
    };
    return { ok: Object.values(checks).every(Boolean), checks };
  }

  listAgentNames() {
    return [...AGENT_ORDER];
  }

  /** Compact summary of every agent, for the workspace overview panel. */
  listAgents() {
    return AGENT_ORDER.map((name) => this._summary(name));
  }

  /** Resolve a free-text domain word (e.g. "manufacturing") to an agent name. */
  findAgentByQuery(text) {
    const t = (text || '').toLowerCase().trim();
    if (!t) return null;
    const direct = AGENT_ORDER.find((name) => name.toLowerCase() === t || name.toLowerCase().startsWith(t));
    if (direct) return direct;
    for (const name of AGENT_ORDER) {
      const domain = AGENT_DOMAINS[name];
      if (domain.keywords.some((k) => t.includes(k) || k.includes(t))) return name;
    }
    return null;
  }

  /** Full workspace view for one agent. */
  getAgent(name) {
    if (!AGENT_DOMAINS[name]) throw new Error(`Unknown agent "${name}"`);
    if (!this.executiveOS) {
      return { name, available: false, reason: 'ExecutiveOperatingSystem not connected.' };
    }
    if (!this.executiveOS.memory) {
      return { name, available: false, reason: 'BusinessMemory not connected.' };
    }

    const agent = this.executiveOS.agents.get(name);
    if (!agent) return { name, available: false, reason: `Agent "${name}" is not registered.` };

    const domain = AGENT_DOMAINS[name];
    const report = agent.report(this.executiveOS.memory);
    const briefing = this.executiveOS.morningBriefing();
    const risks = (briefing.risks || []).filter((r) => matchesDomain(r, domain));
    const recommendations = (briefing.recommendations || [])
      .filter((r) => matchesDomain(r, domain))
      .map((r) => ({ ...r, ...this.explainRecommendation(r, domain) }));

    const recentWork = this.executionGateway
      ? this.executionGateway.getExecutionHistory({ requestingAgent: name }).slice(0, 10)
      : [];
    const pendingWork = this.workflowEngine
      ? this.workflowEngine.getWorkflows({ assignedAgent: name }).filter((w) => w.status === 'awaiting-approval' || w.status === 'running')
      : [];
    const completedWork = this.workflowEngine
      ? this.workflowEngine.getWorkflows({ assignedAgent: name }).filter((w) => w.status === 'completed').slice(0, 10)
      : [];

    const missingData = briefing.missingData || [];
    const confidence = this._confidence({ risks, missingData, report });

    return {
      name,
      available: true,
      priorities: this._priorities(name, report, risks),
      report,
      recentWork,
      pendingWork,
      completedWork,
      recommendations,
      risks,
      confidence,
      confidenceBasis: 'Heuristic: starts at 0.9, -0.15 per high-severity domain risk, -0.1 per medium, -0.05 per unrelated missing data source. Not a model prediction.',
      explainability: domain.explain(report),
      objectiveId: domain.objectiveId,
    };
  }

  /**
   * Shared "why/what/impact/risk/effort/objective/confidence/approval"
   * explanation used by both the agent workspace and the approval center so
   * a recommendation is explained identically everywhere it appears.
   */
  explainRecommendation(rec, domain = null) {
    const actionClass = (rec.type && this.executionGateway && typeof this.executionGateway._classify === 'function')
      ? this.executionGateway._classify(rec.type)
      : null;
    const requiresApproval = actionClass ? actionClass !== 'autonomous' : null;
    return {
      why: rec.reason || 'No reason recorded.',
      expectedOutcome: rec.expectedImpact || 'Not estimated.',
      businessImpact: rec.expectedImpact || 'Not estimated.',
      risk: rec.risk !== undefined ? rec.risk : 'Not scored.',
      estimatedEffort: rec.effort !== undefined ? rec.effort : rec.requiredEffort !== undefined ? rec.requiredEffort : 'Not estimated.',
      strategicObjective: rec.objective || (domain ? domain.objectiveId : null) || 'None matched.',
      confidence: typeof rec.score === 'number' ? Math.min(0.95, Math.max(0.1, rec.score / (rec.score + 10))) : 'Not scored.',
      requiredApproval: requiresApproval === null ? 'Unknown — not routed through a classified action yet.' : (requiresApproval ? 'Yes — review required before execution.' : 'No — autonomous action class.'),
    };
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  _summary(name) {
    const full = this.getAgent(name);
    if (!full.available) return { name, available: false, reason: full.reason };
    return {
      name,
      available: true,
      headline: full.priorities[0] || 'No priority identified.',
      confidence: full.confidence,
      pendingCount: full.pendingWork.length,
      riskCount: full.risks.length,
      recommendationCount: full.recommendations.length,
    };
  }

  _priorities(name, report, risks) {
    const out = [];
    if (risks.length > 0) out.push(`Resolve ${risks.length} ${risks.length === 1 ? 'risk' : 'risks'}: ${risks[0].name}`);

    switch (name) {
      case 'Operations Manager':
        if (report.blockedTaskCount) out.push(`Unblock ${report.blockedTaskCount} blocked task(s)${report.topBottleneck ? `, starting with "${report.topBottleneck.name}"` : ''}`);
        if (report.activeTaskCount) out.push(`Progress ${report.activeTaskCount} active task(s)`);
        break;
      case 'Sales Manager':
        if (report.activeLeads) out.push(`Follow up on ${report.activeLeads} active lead(s)`);
        if (report.openOpportunities) out.push(`Advance ${report.openOpportunities} open opportunit${report.openOpportunities === 1 ? 'y' : 'ies'} worth ${report.pipelineValue}`);
        break;
      case 'Manufacturing Manager':
        if ((report.needsMaintenance || []).length) out.push(`Schedule maintenance for ${report.needsMaintenance.length} equipment item(s)`);
        if ((report.lowInventory || []).length) out.push(`Reorder ${report.lowInventory.length} low-inventory item(s)`);
        break;
      case 'Research Manager':
        if (report.activeExperiments) out.push(`Continue ${report.activeExperiments} active experiment(s)${report.topExperiment ? `, top: "${report.topExperiment.name}"` : ''}`);
        break;
      case 'Creative Director':
        if (report.activeCreativeProjects) out.push(`Advance ${report.activeCreativeProjects} creative project(s)`);
        break;
      case 'Finance Analyst':
        if ((report.trackedExpenses || 0) > (report.revenueOpportunityValue || 0) * 0.5) out.push('Review expense ledger against pipeline value');
        break;
      case 'Technical Architect':
        if ((report.degradedSystems || []).length) out.push(`Address ${report.degradedSystems.length} degraded system(s)`);
        if (report.techDebtCount) out.push(`Plan for ${report.techDebtCount} tech-debt item(s)`);
        break;
      case 'Product Manager':
        if (report.flagship && report.flagship !== 'No flagship registered') out.push(`Advance ${report.flagship} toward release (${Math.round((report.releaseReadiness || 0) * 100)}% ready)`);
        break;
      default:
        break;
    }

    if (out.length === 0) out.push('No open priorities identified from current BusinessMemory data.');
    return out;
  }

  _confidence({ risks, missingData }) {
    let score = 0.9;
    for (const r of risks) score -= r.severity === 'high' ? 0.15 : 0.1;
    score -= Math.min(missingData.length, 3) * 0.05;
    return Math.max(0.1, Math.min(0.95, Number(score.toFixed(2))));
  }
}

module.exports = AgentWorkspace;
module.exports.AGENT_ORDER = AGENT_ORDER;
module.exports.AGENT_DOMAINS = AGENT_DOMAINS;
