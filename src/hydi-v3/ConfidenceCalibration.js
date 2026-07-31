'use strict';

const LearningPolicies = require('./LearningPolicies');

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

class ConfidenceCalibration {
  constructor(config = {}) {
    this.policy = LearningPolicies.get(config.policy);
  }

  /**
   * Adjust a recommendation's confidence based on observed outcome and evidence.
   * Returns { confidence, delta }.
   */
  adjust(currentConfidence, outcome, evidenceCount = 0) {
    if (!Number.isFinite(currentConfidence)) currentConfidence = 0.5;
    const conf = clamp(currentConfidence, this.policy.minConfidence, this.policy.maxConfidence);

    const type = typeof outcome === 'string' ? outcome : (outcome && outcome.type) || 'unknown';
    const measurementType = (outcome && outcome.measurementType) || 'quantitative';
    const isQuantitative = measurementType === 'quantitative';

    let canLearn = isQuantitative;
    if (!isQuantitative && this.policy.qualitativeLearning) {
      canLearn = evidenceCount >= this.policy.qualitativeThreshold;
    }
    if (!canLearn) {
      return { confidence: Number(conf.toFixed(4)), delta: 0 };
    }

    const evidenceScale = Math.min(1, (evidenceCount + 1) / Math.max(1, this.policy.evidenceThreshold));
    const qualitativeScale = isQuantitative ? 1 : (this.policy.qualitativeWeight || 0);
    const factor = this.policy.confidenceAdjustmentFactor * this.policy.learningRate * evidenceScale * qualitativeScale;

    let delta = 0;
    if (type === 'successful') {
      delta = factor * (1 - conf);
    } else if (type === 'partially successful') {
      const error = this._errorRatio(outcome);
      delta = factor * (1 - conf) * 0.5 * (1 - error);
    } else if (type === 'failed') {
      delta = -factor * conf;
    } else if (type === 'abandoned' || type === 'superseded') {
      delta = -factor * conf * 0.5;
    } else if (type === 'neutral') {
      delta = 0;
    }
    // cancelled or unknown leaves delta at 0

    const next = clamp(conf + delta, this.policy.minConfidence, this.policy.maxConfidence);
    return { confidence: Number(next.toFixed(4)), delta: Number((next - conf).toFixed(4)) };
  }

  /**
   * Determine if a recommendation is eligible to be presented given its confidence
   * and the configured recommendation threshold.
   */
  isRecommendable(confidence) {
    return confidence >= this.policy.recommendationThreshold;
  }

  _errorRatio(outcome) {
    if (!outcome || outcome.actual === undefined || outcome.expected === undefined) return 0;
    const expected = Number(outcome.expected) || 1;
    if (expected === 0) return 0;
    const actual = Number(outcome.actual) || 0;
    return clamp(Math.abs(expected - actual) / Math.abs(expected), 0, 1);
  }
}

module.exports = ConfidenceCalibration;
