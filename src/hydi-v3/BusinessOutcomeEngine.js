'use strict';

const DecisionOutcomeStore = require('./DecisionOutcomeStore');
const ConfidenceCalibration = require('./ConfidenceCalibration');

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

class BusinessOutcomeEngine {
  constructor(config = {}) {
    this.store = config.decisionOutcomeStore || new DecisionOutcomeStore({
      dataPath: config.dataPath,
      logger: config.logger,
    });
    this.calibration = config.confidenceCalibration || new ConfidenceCalibration({ policy: config.policy });
    this.recommendationTracker = config.recommendationTracker || null;
    this.logger = config.logger || console;
    this.tolerance = config.tolerance ?? 0.2;
    this._started = false;
    this._destroyed = false;
  }

  async start() {
    if (this._destroyed) throw new Error('BusinessOutcomeEngine has been destroyed');
    if (this._started) return this;
    if (!this.store._started) await this.store.start();
    this._started = true;
    this.logger.log('[BusinessOutcomeEngine] started');
    return this;
  }

  stop() {
    this.store.stop();
    this._started = false;
    this.logger.log('[BusinessOutcomeEngine] stopped');
    return this;
  }

  async flush() {
    return this.store.flush();
  }

  async destroy() {
    if (this._destroyed) return this;
    this.stop();
    await this.store.destroy();
    this._destroyed = true;
    return this;
  }

  healthCheck() {
    return { ok: !this._destroyed && this._started, store: this.store.healthCheck() };
  }

  /**
   * Classify an observed outcome relative to an expected value.
   */
  classifyOutcome(expected, actual, tolerance = this.tolerance) {
    if (actual === undefined || actual === null || expected === undefined || expected === null) {
      return 'abandoned';
    }
    const exp = Number(expected);
    const act = Number(actual);
    if (!Number.isFinite(exp) || exp === 0) {
      return act > 0 ? 'successful' : 'failed';
    }
    const ratio = act / exp;
    if (ratio >= 1 - tolerance) return 'successful';
    if (ratio >= 0.5 - tolerance) return 'partially successful';
    if (ratio >= 0) return 'failed';
    return 'abandoned';
  }

  /**
   * Compute revenue, schedule, strategic, and operational impacts.
   */
  computeImpacts(recommendation, observed) {
    const expected = {
      value: recommendation.expectedValue ?? 0,
      completion: recommendation.expectedCompletion ?? recommendation.createdAt,
      strategic: recommendation.expectedStrategic ?? 1,
      operational: recommendation.expectedOperational ?? 1,
    };
    const actual = {
      value: observed.value ?? observed.actual ?? 0,
      completion: observed.completedAt || observed.observedAt || Date.now(),
      strategic: observed.strategic ?? 1,
      operational: observed.operational ?? 1,
    };
    const revenueImpact = Number(actual.value) - Number(expected.value);
    const scheduleImpact = Number(actual.completion) - Number(expected.completion);
    const strategicImpact = clamp(Number(actual.strategic) - Number(expected.strategic), -1, 1);
    const operationalImpact = clamp(Number(actual.operational) - Number(expected.operational), -1, 1);
    return { revenue: revenueImpact, schedule: scheduleImpact, strategic: strategicImpact, operational: operationalImpact };
  }

  /**
   * Record the observed outcome for a tracked recommendation.
   */
  recordOutcome(recommendationId, observed) {
    if (this._destroyed) throw new Error('BusinessOutcomeEngine has been destroyed');
    const rec = this.store.getRecommendation(recommendationId);
    if (!rec) throw new Error(`Recommendation ${recommendationId} not found`);

    const outcomeType = observed.type || this.classifyOutcome(rec.expectedValue, observed.value, observed.tolerance);
    const impacts = this.computeImpacts(rec, observed);
    const evidence = this.store.findRecommendations({
      strategicObjective: rec.strategicObjective,
    }).filter((r) => r.observedOutcome).length;
    const calibrated = this.calibration.adjust(rec.confidence, { type: outcomeType, actual: observed.value, expected: rec.expectedValue }, evidence);
    const lesson = this._generateLesson(rec, outcomeType, impacts, observed);

    const completedAt = observed.completedAt || observed.observedAt || Date.now();
    const result = this.store.recordOutcome(recommendationId, {
      type: outcomeType,
      observedAt: Date.now(),
      completedAt,
      actual: observed.value ?? null,
      expected: rec.expectedValue,
      impacts,
      adjustedConfidence: calibrated.confidence,
      confidenceDelta: calibrated.delta,
      lesson,
    });

    this.store.addConfidenceHistory(recommendationId, calibrated.confidence, `outcome:${outcomeType}`);
    if (this.recommendationTracker) {
      this.recommendationTracker.recordOutcome(recommendationId, result.observedOutcome);
    }
    return { ...result, adjustedConfidence: calibrated.confidence, confidenceDelta: calibrated.delta, lesson };
  }

  /**
   * Observe an action entry from the ExecutionGateway and link it to a
   * recommendation if a recommendationId is present.
   */
  observeAction(entry) {
    if (this._destroyed) throw new Error('BusinessOutcomeEngine has been destroyed');
    if (!entry || !entry.recommendationId) return null;
    const rec = this.store.getRecommendation(entry.recommendationId);
    if (!rec) return null;

    if (entry.status === 'completed') {
      return this.recordOutcome(entry.recommendationId, {
        value: rec.expectedValue,
        completedAt: entry.completedAt,
        type: 'successful',
      });
    }
    if (entry.status === 'failed') {
      return this.recordOutcome(entry.recommendationId, {
        value: 0,
        completedAt: entry.completedAt,
        type: 'failed',
      });
    }
    return this.store.recordExecution(entry.recommendationId, { status: entry.status, completedAt: entry.completedAt, executedBy: entry.requestingAgent });
  }

  /**
   * Observe a workflow outcome from the BusinessWorkflowEngine.
   */
  observeWorkflow(workflow, actual) {
    if (this._destroyed) throw new Error('BusinessOutcomeEngine has been destroyed');
    if (!workflow) return null;
    const recId = workflow.recommendationId || this._findRecommendationForWorkflow(workflow.id);
    if (!recId) {
      // No linked recommendation; store the workflow outcome as a new recommendation.
      const id = this.store.recordRecommendation({
        action: `Workflow: ${workflow.title || workflow.id}`,
        reason: workflow.reason || 'Workflow outcome',
        expectedValue: workflow.expectedValue ?? 0,
        strategicObjective: workflow.type || null,
        originatingAgent: workflow.assignedAgent || 'workflow',
      });
      return this.recordOutcome(id, { value: actual, completedAt: Date.now() });
    }
    return this.recordOutcome(recId, { value: actual, completedAt: Date.now() });
  }

  _findRecommendationForWorkflow(workflowId) {
    for (const rec of this.store.findRecommendations()) {
      if (rec.sourceId === workflowId || rec.workflowId === workflowId) return rec.id;
    }
    return null;
  }

  _generateLesson(recommendation, outcomeType, impacts, observed) {
    const value = observed.value ?? 0;
    const expected = recommendation.expectedValue ?? 0;
    if (outcomeType === 'successful') {
      return `${recommendation.action} met expectation (expected ${expected}, got ${value}).`;
    }
    if (outcomeType === 'partially successful') {
      return `${recommendation.action} partially met expectation (expected ${expected}, got ${value}); revenue impact ${impacts.revenue}.`;
    }
    if (outcomeType === 'failed') {
      return `${recommendation.action} failed (expected ${expected}, got ${value}). Review assumptions for ${recommendation.strategicObjective || 'this objective'}.`;
    }
    if (outcomeType === 'abandoned' || outcomeType === 'superseded') {
      return `${recommendation.action} was ${outcomeType}. No outcome measured.`;
    }
    return `Outcome recorded for ${recommendation.action}.`;
  }
}

module.exports = BusinessOutcomeEngine;
