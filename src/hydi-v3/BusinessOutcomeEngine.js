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

    // A neutral outcome means observed activity matched expectation without
    // creating or destroying business value. Treat impacts as zero so the
    // engine does not manufacture a revenue decline from small, inconclusive
    // evidence.
    if (observed.type === 'neutral') {
      return { revenue: 0, schedule: 0, strategic: 0, operational: 0 };
    }

    const actual = {
      value: observed.value ?? observed.actual ?? 0,
      completion: observed.completedAt || observed.observedAt || Date.now(),
      strategic: observed.strategic ?? 1,
      operational: observed.operational ?? 1,
    };
    // Without an observed value there is no revenue impact to report. Treating
    // a missing measurement as zero booked a loss equal to the entire
    // expectation every time an outcome was classified qualitatively.
    const measuredValue = observed.value ?? observed.actual;
    const revenueImpact = (measuredValue === undefined || measuredValue === null)
      ? null
      : Number(measuredValue) - Number(expected.value);
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

    // The store refuses a duplicate outcome row, but calibration happens here.
    // Without this guard a repeated observation would still ratchet confidence
    // upward while recording no new evidence — manufacturing certainty from a
    // single event.
    if (rec.observedOutcome && !observed.supersede) {
      return { ...rec, adjustedConfidence: rec.confidence, confidenceDelta: 0, lesson: rec.lessonsLearned, duplicate: true };
    }

    const outcomeType = observed.type || this.classifyOutcome(rec.expectedValue, observed.value, observed.tolerance);
    const impacts = this.computeImpacts(rec, observed);
    const evidence = this.store.findRecommendations({
      strategicObjective: rec.strategicObjective,
    }).filter((r) => r.observedOutcome).length;
    const measured = observed.measured !== false;
    const measurementType = observed.measurementType || (measured ? 'quantitative' : 'qualitative');
    const calibrated = this.calibration.adjust(rec.confidence, { type: outcomeType, actual: observed.value, expected: rec.expectedValue, measurementType }, evidence);
    const lesson = measured
      ? this._generateLesson(rec, outcomeType, impacts, observed)
      : (observed.lesson || `Qualitative ${outcomeType} recorded without a measured value.`);

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
      // Carry provenance through so the store records whether this outcome was
      // actually measured or inferred from something else.
      measured: observed.measured !== false,
      provenance: observed.provenance || 'reported',
      supersede: observed.supersede,
    });

    this.store.addConfidenceHistory(recommendationId, calibrated.confidence, `outcome:${outcomeType}`);
    // RecommendationTracker.recordOutcome() delegates to this same store, so
    // calling it here wrote every outcome twice — inflating outcomeCount, the
    // learning summary, and any metric derived from store.outcomes.
    return { ...result, adjustedConfidence: calibrated.confidence, confidenceDelta: calibrated.delta, lesson };
  }

  /**
   * Observe an action entry from the ExecutionGateway and link it to a
   * recommendation if a recommendationId is present.
   */
  /**
   * Observe an execution entry from the ExecutionGateway.
   *
   * An action finishing is evidence that it *ran*, not evidence that it
   * achieved the business value the recommendation predicted. Previously a
   * completion recorded a `successful` outcome with `actual = expectedValue`,
   * so the system confirmed its own forecast without ever measuring anything
   * and raised confidence off the back of it. That is the ground-truth
   * inversion this architecture exists to avoid: enforcement — here, learning —
   * running ahead of observed truth.
   *
   * Completion therefore advances execution status only, and the
   * recommendation stays in `getAwaitingOutcomes()` until a real measured
   * value arrives via `recordOutcome()`.
   *
   * Failure is different: an action that could not run cannot deliver value,
   * so it is genuine negative evidence and is recorded as an outcome.
   */
  observeAction(entry) {
    if (this._destroyed) throw new Error('BusinessOutcomeEngine has been destroyed');
    if (!entry || !entry.recommendationId) return null;
    const rec = this.store.getRecommendation(entry.recommendationId);
    if (!rec) return null;

    if (entry.status === 'failed') {
      return this.recordOutcome(entry.recommendationId, {
        value: 0,
        completedAt: entry.completedAt,
        type: 'failed',
        measured: true,
        measurementType: 'quantitative',
        provenance: 'execution-failure',
      });
    }

    return this.store.recordExecution(entry.recommendationId, {
      status: entry.status,
      completedAt: entry.completedAt,
      executedBy: entry.requestingAgent,
    });
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
      return this.recordOutcome(id, { value: actual, completedAt: Date.now(), measurementType: 'quantitative' });
    }
    return this.recordOutcome(recId, { value: actual, completedAt: Date.now(), measurementType: 'quantitative' });
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
