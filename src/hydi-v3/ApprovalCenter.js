'use strict';

/**
 * ApprovalCenter is the single, enriched view of everything waiting on the
 * owner: pending ExecutionGateway actions and pending BusinessWorkflowEngine
 * workflows, merged into one record shape with business value, expected
 * impact, risk, required resources, responsible agent, and execution plan.
 *
 * It is a thin, stateless coordinator — it holds no approval state of its
 * own and persists nothing. Every decision (approve/reject/modify/simulate)
 * is delegated to ExecutionGateway or BusinessWorkflowEngine, which remain
 * the only authorities that can change what actually happens. This mirrors
 * ExecutiveCockpit's approve/reject delegation, just with richer records and
 * two extra verbs (explain, simulate, request modification).
 */
const STALE_APPROVAL_MS = 60 * 60 * 1000;

class ApprovalCenter {
  constructor(config = {}) {
    this.executionGateway = config.executionGateway || null;
    this.workflowEngine = config.workflowEngine || null;
    this.strategicObjectives = config.strategicObjectives || null;
    this.businessEvidenceEngine = config.businessEvidenceEngine || null;
    this.trustEngine = config.trustEngine || null;
  }

  healthCheck() {
    const checks = {
      hasGateway: !!this.executionGateway,
      hasWorkflowEngine: !!this.workflowEngine,
    };
    return { ok: Object.values(checks).every(Boolean), checks };
  }

  /** Enriched, merged list of every pending approval. */
  list() {
    const out = [];
    if (this.executionGateway) {
      for (const entry of this.executionGateway.getPendingApprovals()) {
        out.push(this._fromExecution(entry));
      }
    }
    if (this.workflowEngine) {
      for (const wf of this.workflowEngine.getWorkflows({ status: 'awaiting-approval' })) {
        out.push(this._fromWorkflow(wf));
      }
    }
    return out.sort((a, b) => (b.businessValueNumeric || 0) - (a.businessValueNumeric || 0));
  }

  get(id) {
    return this.list().find((a) => a.id === id) || null;
  }

  async approve(id) {
    const record = this.get(id);
    if (!record) return { id, ok: false, message: `No pending approval found for "${id}".` };
    const stale = record.requestedAt && (Date.now() - record.requestedAt) > STALE_APPROVAL_MS;
    if (record.kind === 'execution') {
      const result = await this.executionGateway.approve(id);
      return { id, ok: true, kind: 'execution', result, stale, warning: stale ? 'This approval is stale; verify the situation is unchanged.' : undefined };
    }
    const approved = this.workflowEngine.approveWorkflow(id);
    return { id, ok: approved, kind: 'workflow', message: approved ? 'Workflow approved.' : 'Workflow was already approved.', stale, warning: stale ? 'This approval is stale; verify the situation is unchanged.' : undefined };
  }

  reject(id) {
    const record = this.get(id);
    if (!record) return { id, ok: false, message: `No pending approval found for "${id}".` };
    if (record.kind === 'execution') {
      const result = this.executionGateway.reject(id);
      return { id, ok: true, kind: 'execution', result };
    }
    const wf = this.workflowEngine.getWorkflow(id);
    wf.status = 'rejected';
    wf.updatedAt = Date.now();
    if (typeof this.workflowEngine._persist === 'function') this.workflowEngine._persist();
    return { id, ok: true, kind: 'workflow', message: 'Workflow rejected.' };
  }

  requestModification(id, notes) {
    const record = this.get(id);
    if (!record) return { id, ok: false, message: `No pending approval found for "${id}".` };
    if (record.kind === 'execution') {
      const result = this.executionGateway.requestModification(id, notes);
      return { id, ok: true, kind: 'execution', result };
    }
    const wf = this.workflowEngine.getWorkflow(id);
    wf.modificationRequested = true;
    wf.modificationNotes = notes || '';
    wf.updatedAt = Date.now();
    if (typeof this.workflowEngine._persist === 'function') this.workflowEngine._persist();
    return { id, ok: true, kind: 'workflow', message: 'Modification requested.', notes: wf.modificationNotes };
  }

  /** Dry-run preview. Never mutates approval state. */
  async simulate(id) {
    const record = this.get(id);
    if (!record) return { id, ok: false, message: `No pending approval found for "${id}".` };
    if (record.kind === 'execution') {
      const preview = await this.executionGateway.simulatePending(id);
      return { id, ok: true, kind: 'execution', preview };
    }
    const wf = this.workflowEngine.getWorkflow(id);
    return {
      id,
      ok: true,
      kind: 'workflow',
      preview: {
        simulated: true,
        steps: wf.steps.map((s) => ({ name: s.name, kind: s.kind, wouldComplete: s.completion })),
      },
    };
  }

  /** Every recommendation/approval must answer: why, expected outcome, business
   * impact, risk, effort, strategic objective, confidence, required approval,
   * evidence, undo path, and audit consequences. */
  explain(id) {
    const record = this.get(id);
    if (!record) return { id, ok: false, message: `No pending approval found for "${id}".` };

    const evidenceSummary = this.businessEvidenceEngine
      ? this.businessEvidenceEngine.getEvidenceSummary(id)
      : null;
    const evidenceItems = evidenceSummary && evidenceSummary.evidence
      ? evidenceSummary.evidence.map((e) => `${e.source} (${e.measurementType || 'unknown'})`)
      : [];

    let undoPath = 'No undo information available.';
    if (record.kind === 'execution' && this.trustEngine && this.executionGateway) {
      const action = { id: record.id, adapter: record.executionPlan[1] && record.executionPlan[1].adapter };
      undoPath = this.trustEngine.canUndo(action, this.executionGateway.adapters)
        ? 'A matching adapter undo is available; execution can be reversed.'
        : 'This action does not provide an undo mechanism.';
    } else if (record.kind === 'workflow') {
      undoPath = 'Workflows require manual rollback if approved.';
    }

    const auditConsequences = record.kind === 'execution'
      ? 'Approving records action-approved and action-executed entries. Rejecting records action-rejected.'
      : 'Approving records workflow-approved. Rejecting records workflow-rejected.';

    return {
      id,
      ok: true,
      recommendation: record.title,
      why: record.expectedImpact,
      whyItExists: record.expectedImpact,
      expectedOutcome: record.executionPlan.length
        ? `Completing ${record.executionPlan.length} step(s): ${record.executionPlan.map((s) => s.name || s.step).join(', ')}`
        : 'No execution plan recorded.',
      businessImpact: `Business value ${record.businessValue}`,
      expectedImpact: `Business value ${record.businessValue}`,
      risk: record.risk,
      undoPath,
      auditConsequences,
      estimatedEffort: record.requiredEffort,
      strategicObjective: record.objective || 'None matched.',
      confidence: record.confidence,
      requiredApproval: 'Yes — currently awaiting operator decision.',
      responsibleAgent: record.responsibleAgent,
      evidence: evidenceItems.length ? evidenceItems.join(', ') : 'No evidence collected yet.',
    };
  }

  // -------------------------------------------------------------------------
  // Internal record shaping
  // -------------------------------------------------------------------------

  _fromExecution(entry) {
    const objective = this.strategicObjectives
      ? this.strategicObjectives.match({ name: entry.type, description: JSON.stringify(entry.params || {}), tags: [entry.adapter] })
      : null;
    return {
      id: entry.id,
      kind: 'execution',
      title: `${entry.type} (${entry.adapter})`,
      businessValue: 'Not scored for direct actions.',
      businessValueNumeric: 0,
      expectedImpact: `${entry.type} requested by ${entry.requestingAgent}`,
      risk: entry.actionClass,
      requiredEffort: 1,
      requiredResources: [entry.adapter],
      responsibleAgent: entry.requestingAgent,
      executionPlan: [{ step: entry.type, adapter: entry.adapter, params: entry.params }],
      requestedAt: entry.timestamp,
      objective: objective ? objective.id : null,
      confidence: 'Not scored.',
      modificationRequested: !!entry.modificationRequested,
      modificationNotes: entry.modificationNotes || null,
    };
  }

  _fromWorkflow(wf) {
    const objective = this.strategicObjectives
      ? this.strategicObjectives.match({ name: wf.title, description: wf.reason, tags: [wf.type] })
      : null;
    const risk = typeof wf.probability === 'number' ? Number((1 - wf.probability).toFixed(2)) : 'Not scored.';
    return {
      id: wf.id,
      kind: 'workflow',
      title: wf.title,
      businessValue: wf.expectedValue,
      businessValueNumeric: wf.expectedValue || 0,
      expectedImpact: wf.reason,
      risk,
      requiredEffort: wf.requiredEffort,
      requiredResources: wf.dependencies && wf.dependencies.length ? wf.dependencies : ['None recorded'],
      responsibleAgent: wf.assignedAgent,
      executionPlan: wf.steps.map((s) => ({ step: s.id, name: s.name, kind: s.kind, status: s.status })),
      requestedAt: wf.approvalRequestedAt || wf.createdAt,
      objective: objective ? objective.id : null,
      confidence: typeof wf.score === 'number' ? Math.min(0.95, Math.max(0.1, wf.score / (wf.score + 500))) : 'Not scored.',
      modificationRequested: !!wf.modificationRequested,
      modificationNotes: wf.modificationNotes || null,
    };
  }
}

module.exports = ApprovalCenter;
