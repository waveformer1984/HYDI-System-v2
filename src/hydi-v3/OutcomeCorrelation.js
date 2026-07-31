'use strict';

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

/**
 * Weighted mean of the evidence that actually carries a number.
 *
 * Qualitative evidence — an owner confirming "yes it worked" — has no
 * `data.value`. Treating that as a measured zero was doubly wrong: on its own
 * it reported a confirmed success as having produced nothing, and alongside a
 * real measurement it dragged the average down, so confirming a success
 * *lowered* the observed value.
 *
 * Qualitative evidence classifies an outcome; it does not quantify it.
 *
 * @returns {{value: number|null, numericCount: number, values: number[]}}
 */
function sumEvidenceValue(evidence) {
  if (!evidence || evidence.length === 0) return { value: null, numericCount: 0, values: [] };

  let totalWeight = 0;
  let weighted = 0;
  const values = [];

  for (const item of evidence) {
    if (!item.data || !Number.isFinite(item.data.value)) continue;
    // Only quantitative evidence carries a measured business value. Activity
    // and qualitative evidence still count toward evidence quality, but they
    // cannot be averaged into a numeric outcome.
    if (item.measurementType === 'activity' || item.measurementType === 'qualitative') continue;
    const weight = Number.isFinite(item.weight) ? item.weight : 0.5;
    const confidence = Number.isFinite(item.confidence) ? item.confidence : 0.5;
    const w = weight * confidence;
    totalWeight += w;
    weighted += w * item.data.value;
    values.push(item.data.value);
  }

  if (values.length === 0) return { value: null, numericCount: 0, values: [] };
  if (totalWeight === 0) return { value: 0, numericCount: values.length, values };
  return { value: weighted / totalWeight, numericCount: values.length, values };
}

class OutcomeCorrelation {
  constructor() {
    this._samples = [];
  }

  correlate(recommendation, evidence, _kpiSnapshot = {}) {
    const expectedValue = Number(recommendation.expectedValue) || 0;
    const expectedCompletion = recommendation.expectedCompletion || recommendation.createdAt || Date.now();
    const expectedStrategic = Number(recommendation.expectedStrategic) || 1;
    const expectedOperational = Number(recommendation.expectedOperational) || 1;

    const measurement = sumEvidenceValue(evidence);
    const hasMeasuredValue = measurement.value !== null;
    const observedValue = hasMeasuredValue ? measurement.value : 0;
    const values = measurement.values;

    // Variance is compared against a 0-1 threshold by OutcomeEvaluator, so it
    // has to be scale-free. Raw squared deviations in currency units ran to
    // millions and made every multi-sample evaluation look contradictory.
    // This is the coefficient of variation: spread relative to magnitude.
    let variance = 0;
    if (values.length > 1) {
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      const sd = Math.sqrt(values.reduce((s, v) => s + ((v - mean) ** 2), 0) / values.length);
      variance = Math.abs(mean) > 0 ? clamp(sd / Math.abs(mean), 0, 1) : (sd > 0 ? 1 : 0);
    }

    const forecastError = expectedValue === 0 ? observedValue : observedValue - expectedValue;
    const accuracy = expectedValue === 0
      ? (observedValue === 0 ? 1 : 0)
      : clamp(1 - Math.abs(forecastError) / Math.abs(expectedValue), 0, 1);

    const valueCreated = observedValue - expectedValue;

    const avgEvidenceTime = evidence.length
      ? evidence.reduce((s, i) => s + (i.at || Date.now()), 0) / evidence.length
      : Date.now();
    const timeVariance = avgEvidenceTime - expectedCompletion;

    // Strategic impact is a 0-1 score, so it must be derived from how well the
    // forecast held — not by subtracting a 0-1 target from a monetary value,
    // which saturated to +/-1 for any real amount of money.
    const strategicImpact = hasMeasuredValue
      ? clamp((accuracy - 0.5) * 2 * expectedStrategic, -1, 1)
      : 0;
    const operationalImpact = clamp((1 - variance) - expectedOperational, -1, 1);

    return {
      expectedValue,
      hasMeasuredValue,
      numericEvidenceCount: measurement.numericCount,
      observedValue: hasMeasuredValue ? Number(observedValue.toFixed(4)) : null,
      forecastError: Number(forecastError.toFixed(4)),
      valueCreated: Number(valueCreated.toFixed(4)),
      predictionAccuracy: Number(accuracy.toFixed(4)),
      timeVariance: Number(timeVariance.toFixed(0)),
      strategicImpact: Number(strategicImpact.toFixed(4)),
      operationalImpact: Number(operationalImpact.toFixed(4)),
      evidenceVariance: Number(variance.toFixed(4)),
      summary: `Observed ${observedValue.toFixed(2)} against expected ${expectedValue} (accuracy ${(accuracy * 100).toFixed(0)}%).`,
    };
  }

  recordPrediction(recommendation, result) {
    this._samples.push({
      expected: recommendation.expectedValue ?? 0,
      observed: result.observedValue,
      accuracy: result.predictionAccuracy,
      at: Date.now(),
    });
    if (this._samples.length > 1000) this._samples = this._samples.slice(-1000);
  }

  getPredictionHistory() {
    return this._samples.slice();
  }
}

module.exports = OutcomeCorrelation;
