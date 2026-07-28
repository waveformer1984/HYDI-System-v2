'use strict';

class OperatorFeedbackEngine {
  constructor(config = {}) {
    this.tracker = config.executionOutcomeTracker || null;
    this.telemetry = config.telemetry || null;
    this.logger = config.logger || console;
    this.weights = new Map();
  }

  _key(task, model) {
    return `${task || 'any'}::${model || 'any'}`;
  }

  _get(key) {
    return this.weights.get(key) || { positive: 0, negative: 0, ignored: 0, override: 0, cancelled: 0, score: 0, samples: 0 };
  }

  _record(type, { recommendationId, task, model, note }) {
    const key = this._key(task, model);
    const w = this._get(key);
    w[type]++;
    w.samples++;
    w.score = (w.positive - w.negative - w.ignored * 0.5 - w.override * 0.3 - w.cancelled * 0.7) / Math.max(1, w.samples);
    this.weights.set(key, w);
    if (this.tracker && typeof this.tracker.record === 'function') {
      this.tracker.record({ task, selectedModel: model, finalOutcome: type, meta: { recommendationId, note } });
    }
    if (this.telemetry && typeof this.telemetry.record === 'function') {
      this.telemetry.record({ task: 'operator_feedback', selectedModel: model, selectedAgent: 'Operator', outcome: type, meta: { recommendationId, note } });
    }
    return w;
  }

  recordPositive(opts) { return this._record('positive', opts); }
  recordNegative(opts) { return this._record('negative', opts); }
  recordIgnored(opts) { return this._record('ignored', opts); }
  recordOverride(opts) { return this._record('override', opts); }
  recordCancelled(opts) { return this._record('cancelled', opts); }

  weightFor(task, model) {
    return this._get(this._key(task, model)).score;
  }

  apply(baseScore, task, model) {
    return baseScore + this.weightFor(task, model) * 10;
  }

  summary(task = null) {
    const entries = [];
    for (const [key, w] of this.weights) {
      const [t, m] = key.split('::');
      if (task && t !== task) continue;
      entries.push({ task: t, model: m, ...w });
    }
    return entries;
  }
}

module.exports = OperatorFeedbackEngine;
