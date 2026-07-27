'use strict';

const OutcomeCorrelation = require('./OutcomeCorrelation');

const CLASSIFICATIONS = {
  confirmedSuccess: 'Confirmed Success',
  partialSuccess: 'Partial Success',
  neutral: 'Neutral',
  negative: 'Negative',
  inconclusive: 'Inconclusive',
  insufficient: 'Insufficient Evidence',
};

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

function evidenceQuality(evidence) {
  if (!evidence || evidence.length === 0) return 0;
  const total = evidence.reduce((s, i) => {
    const w = Number.isFinite(i.weight) ? i.weight : 0.5;
    const c = Number.isFinite(i.confidence) ? i.confidence : 0.5;
    const r = Number.isFinite(i.relevance) ? i.relevance : 0.5;
    return s + w * c * r;
  }, 0);
  return clamp(total / evidence.length, 0, 1);
}

class OutcomeEvaluator {
  constructor(config = {}) {
    this.outcomeCorrelation = config.outcomeCorrelation || new OutcomeCorrelation();
    this.qualityThreshold = config.qualityThreshold ?? 0.3;
  }

  evaluate(recommendation, evidence, kpiSnapshot = {}) {
    if (!evidence || evidence.length === 0) {
      return {
        classification: CLASSIFICATIONS.insufficient,
        outcomeType: null,
        observedValue: null,
        hasMeasuredValue: false,
        evidenceQuality: 0,
        explanation: 'No evidence has been collected for this recommendation.',
      };
    }

    const quality = evidenceQuality(evidence);
    if (quality < this.qualityThreshold) {
      return {
        classification: CLASSIFICATIONS.insufficient,
        outcomeType: null,
        observedValue: null,
        hasMeasuredValue: false,
        evidenceQuality: quality,
        explanation: `Evidence quality (${(quality * 100).toFixed(0)}%) is below the threshold for a reliable outcome.`,
      };
    }

    const correlation = this.outcomeCorrelation.correlate(recommendation, evidence, kpiSnapshot);

    if (!correlation.hasMeasuredValue && !this._hasManualConfirmation(evidence)) {
      return {
        classification: CLASSIFICATIONS.inconclusive,
        outcomeType: null,
        observedValue: null,
        hasMeasuredValue: false,
        evidenceQuality: quality,
        correlation,
        explanation: 'Evidence was collected but none of it carries a measurable value.',
      };
    }

    const manual = this._manualAnswer(evidence);
    const automatic = this._automaticClassify(recommendation, correlation);
    const classification = this._resolveClassification(manual, automatic, correlation);

    return {
      classification: CLASSIFICATIONS[classification.key],
      outcomeType: classification.outcomeType,
      observedValue: correlation.hasMeasuredValue ? correlation.observedValue : null,
      hasMeasuredValue: correlation.hasMeasuredValue,
      evidenceQuality: quality,
      correlation,
      explanation: classification.explanation,
    };
  }

  _hasManualConfirmation(evidence) {
    return evidence.some((e) => e.type === 'manual-confirmation' || e.source === 'manual');
  }

  _manualAnswer(evidence) {
    const item = evidence.find((e) => e.type === 'manual-confirmation' || e.source === 'manual');
    if (!item) return null;
    return String(item.data && item.data.answer).toLowerCase();
  }

  _automaticClassify(recommendation, correlation) {
    if (correlation.evidenceVariance > 0.8) {
      return { key: 'inconclusive', outcomeType: null, explanation: 'Evidence is contradictory or highly variable.' };
    }
    const observed = correlation.observedValue || 0;
    const expected = Number(recommendation.expectedValue) || 0;
    const ratio = expected ? observed / expected : (observed === 0 ? 0 : 1);
    if (ratio >= 0.9) {
      return { key: 'confirmedSuccess', outcomeType: 'successful', explanation: 'Observed value met or exceeded the expected outcome.' };
    }
    if (ratio >= 0.5) {
      return { key: 'partialSuccess', outcomeType: 'partially successful', explanation: 'Observed value reached a meaningful portion of the expected outcome.' };
    }
    if (ratio > 0) {
      return { key: 'neutral', outcomeType: 'neutral', explanation: 'Some activity was observed but the expected value was not realized.' };
    }
    return { key: 'negative', outcomeType: 'failed', explanation: 'Observed evidence indicates the expected outcome was not achieved.' };
  }

  _resolveClassification(manual, automatic, correlation) {
    if (!manual) return automatic;

    if (manual === 'unknown' || manual === 'skip') {
      return { key: 'inconclusive', outcomeType: null, explanation: 'Manual review was inconclusive or skipped.' };
    }

    const measured = correlation.hasMeasuredValue
      ? ` measured value ${correlation.observedValue}`
      : ' no measured value attached';

    if (manual === 'yes') {
      return { key: 'confirmedSuccess', outcomeType: 'successful', explanation: `Owner confirmed success;${measured}.` };
    }
    if (manual === 'partial' || manual === 'partially') {
      return { key: 'partialSuccess', outcomeType: 'partially successful', explanation: `Owner confirmed partial success;${measured}.` };
    }
    if (manual === 'no' || manual === 'negative') {
      return { key: 'negative', outcomeType: 'failed', explanation: `Owner confirmed the recommendation did not succeed;${measured}.` };
    }

    return { key: 'inconclusive', outcomeType: null, explanation: 'Manual review was inconclusive.' };
  }
}

module.exports = OutcomeEvaluator;
