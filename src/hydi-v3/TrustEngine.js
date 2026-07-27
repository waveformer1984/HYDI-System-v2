'use strict';

/**
 * TrustEngine answers the executive questions that matter before any action is
 * taken. For every recommendation it can explain:
 *
 * - Why am I recommending this?
 * - Why is it safe?
 * - What data did I use?
 * - What assumptions did I make?
 * - What would happen if I executed it?
 * - What changed afterward?
 * - Can I undo it?
 */
class TrustEngine {
  constructor(config = {}) {
    this.strategicObjectives = config.strategicObjectives || null;
    this.memory = config.businessMemory || null;
    this.learningMetrics = config.learningMetrics || null;
    this.logger = config.logger || console;
  }

  /**
   * Compute a confidence score (0-1) based on the quality and completeness of
   * the underlying data.
   */
  computeConfidence(entity) {
    if (!entity) return 0;

    const checks = [
      entity.name && entity.name.trim() !== '',
      typeof entity.value === 'number' && !Number.isNaN(entity.value),
      typeof entity.effort === 'number' && entity.effort >= 1,
      typeof entity.risk === 'number' && entity.risk >= 0 && entity.risk <= 1,
      Array.isArray(entity.tags),
      entity.updatedAt && Date.now() - entity.updatedAt < 30 * 24 * 60 * 60 * 1000,
    ];
    const passed = checks.filter(Boolean).length;
    return passed / checks.length;
  }

  /**
   * Build a provenance object for a recommendation or action.
   */
  generateProvenance(recommendation, memory = this.memory) {
    const related = recommendation.id && memory ? memory.get(recommendation.id) : null;
    const objective = this.strategicObjectives && recommendation.objective
      ? this.strategicObjectives.get(recommendation.objective)
      : null;

    const sources = [];
    if (related) sources.push(`memory:${related.type}:${related.id}`);
    if (recommendation.agent) sources.push(`agent:${recommendation.agent}`);
    if (objective) sources.push(`objective:${objective.id}`);
    if (recommendation.expectedImpact) sources.push(`impact:${recommendation.expectedImpact}`);

    const assumptions = [];
    if (recommendation.value !== undefined) assumptions.push('value taken from entity or expected impact');
    if (recommendation.risk !== undefined) assumptions.push('risk normalized to 0-1 scale');
    if (recommendation.effort !== undefined) assumptions.push('effort measured in abstract units');
    if (objective) assumptions.push(`strategic weight from objective ${objective.id}`);

    const provenance = {
      sources,
      assumptions,
      reasoning: recommendation.reason || recommendation.explanation || 'No explicit reasoning recorded.',
      confidence: recommendation.confidence || this.computeConfidence(related || recommendation),
    };

    if (this.learningMetrics) {
      const metrics = this.learningMetrics.computeMetrics({});
      const historicalSuccessRate = metrics.recommendationSuccessRate ?? 0;
      const priorFailures = metrics.failed || 0;
      const confidenceDrift = metrics.confidenceDrift || 0;
      provenance.historicalSuccessRate = historicalSuccessRate;
      provenance.priorFailures = priorFailures;
      provenance.confidenceDrift = confidenceDrift;
      if (metrics.topAgents && metrics.topAgents.length > 0) {
        provenance.topPerformingAgent = metrics.topAgents[0].agent;
      }
      if (metrics.lowestConfidenceAreas && metrics.lowestConfidenceAreas.length > 0) {
        provenance.weakestArea = metrics.lowestConfidenceAreas[0].area;
      }
    }

    return provenance;
  }

  /**
   * Determine whether an action can be undone by its adapter.
   */
  canUndo(action, adapters = new Map()) {
    if (!action || !action.adapter) return false;
    const adapter = adapters.get(action.adapter);
    return !!(adapter && typeof adapter.undo === 'function' && adapter.canUndo && action.id);
  }

  /**
   * Produce a human-readable justification that answers the seven trust
   * questions.
   */
  formatJustification(recommendation, adapters = new Map()) {
    const provenance = this.generateProvenance(recommendation);
    const undoable = this.canUndo(recommendation, adapters);
    const risk = recommendation.risk ?? 1;
    const safety = risk < 0.5 ? 'low-risk' : risk < 0.8 ? 'medium-risk' : 'high-risk';

    const historicalSuccessRate = provenance.historicalSuccessRate !== undefined
      ? `${(provenance.historicalSuccessRate * 100).toFixed(0)}%`
      : 'no historical data';
    const priorFailures = provenance.priorFailures !== undefined ? provenance.priorFailures : 'unknown';
    const confidenceDrift = provenance.confidenceDrift !== undefined
      ? `${(provenance.confidenceDrift * 100).toFixed(2)}%`
      : 'unknown';

    const lines = [
      'Why am I recommending this?',
      provenance.reasoning,
      '',
      'Why is it safe?',
      `Risk normalized to ${risk.toFixed(2)} (${safety}); confidence ${(provenance.confidence * 100).toFixed(0)}%.`,
      '',
      'What data did I use?',
      ...(provenance.sources.length ? provenance.sources.map((s) => `- ${s}`) : ['- No verified data sources.']),
      '',
      'What assumptions did I make?',
      ...(provenance.assumptions.length ? provenance.assumptions.map((a) => `- ${a}`) : ['- None explicitly recorded.']),
      '',
      'What would happen if I executed it?',
      recommendation.expectedOutcome || recommendation.outcome || 'Outcome not modeled.',
      '',
      'What changed afterward?',
      recommendation.changes || 'No post-execution diff available yet.',
      '',
      'Can I undo it?',
      undoable ? 'Yes, the responsible adapter supports rollback.' : 'No automatic rollback is available for this action.',
      '',
      'Why do you believe this?',
      `Confidence is ${(provenance.confidence * 100).toFixed(0)}%` + (provenance.historicalSuccessRate !== undefined ? `; historically similar recommendations succeeded ${historicalSuccessRate} of the time.` : ' based on available data.'),
      '',
      'How often has this recommendation succeeded?',
      historicalSuccessRate === 'no historical data'
        ? 'No comparable recommendations have completed yet.'
        : `Comparable recommendations have a ${historicalSuccessRate} success rate (${priorFailures} failed).`,
      '',
      'What evidence supports it?',
      provenance.sources.length ? provenance.sources.map((s) => `- ${s}`).join('\n') : '- No verified data sources.',
      '',
      'What assumptions are weakest?',
      provenance.assumptions.length ? provenance.assumptions.map((a) => `- ${a}`).join('\n') : '- None explicitly recorded.',
      '',
      'Has this failed before?',
      priorFailures === 'unknown' ? 'No failure history available.' : `${priorFailures} comparable recommendations have failed historically.`,
      '',
      'What changed?',
      recommendation.changes || 'No post-execution diff available yet.',
      '',
      'What would change your recommendation?',
      provenance.weakestArea
        ? `More evidence in the weakest area (${provenance.weakestArea}) or a sustained increase in confidence (currently ${(provenance.confidence * 100).toFixed(0)}%; drift ${confidenceDrift}).`
        : `Sustained confidence increase above the recommendation threshold or stronger supporting evidence.`,
    ];
    return lines.join('\n');
  }

  /**
   * Return an explicit "I don't know" recommendation with provenance.
   */
  iDontKnow(reason) {
    return {
      action: "I don't have enough reliable information to make a recommendation.",
      confidence: 0,
      provenance: {
        sources: [],
        assumptions: [],
        reasoning: reason || 'Required data is missing or data quality is too low.',
        confidence: 0,
      },
      expectedOutcome: 'No action taken.',
      changes: 'No changes made.',
    };
  }
}

module.exports = TrustEngine;
