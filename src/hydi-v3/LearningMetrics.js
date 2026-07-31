'use strict';

const DecisionOutcomeStore = require('./DecisionOutcomeStore');

class LearningMetrics {
  constructor(config = {}) {
    this.store = config.decisionOutcomeStore || new DecisionOutcomeStore({
      dataPath: config.dataPath,
      logger: config.logger,
    });
    this.defaultWindowMs = config.defaultWindowMs ?? 30 * 24 * 60 * 60 * 1000;
    this.minEvidence = config.minEvidence ?? 5;
  }

  async start() {
    if (this.store._started) return this;
    await this.store.start();
    return this;
  }

  stop() {
    if (this.store.stop) this.store.stop();
    return this;
  }

  async flush() {
    return this.store.flush();
  }

  async destroy() {
    if (this.store.destroy) await this.store.destroy();
    return this;
  }

  /**
   * Compute learning metrics over a time window.
   */
  computeMetrics(options = {}) {
    const since = options.since || (Date.now() - (options.sinceMs ?? this.defaultWindowMs));
    const recs = this.store.findRecommendations({ since });
    const total = recs.length;
    const withOutcomes = recs.filter((r) => r.observedOutcome);
    const completed = withOutcomes.length;
    const successful = withOutcomes.filter((r) => r.observedOutcome.type === 'successful').length;
    const partial = withOutcomes.filter((r) => r.observedOutcome.type === 'partially successful').length;
    const failed = withOutcomes.filter((r) => r.observedOutcome.type === 'failed').length;
    const abandoned = withOutcomes.filter((r) => r.observedOutcome.type === 'abandoned').length;
    const cancelled = withOutcomes.filter((r) => r.observedOutcome.type === 'cancelled').length;
    const superseded = withOutcomes.filter((r) => r.observedOutcome.type === 'superseded').length;

    const predictionAccuracy = completed > 0 ? (successful + partial * 0.5) / completed : null;
    const recommendationSuccessRate = completed > 0 ? (successful + partial) / completed : null;
    const executionCompletionRate = recs.filter((r) => r.ownerDecision === 'approved' && r.observedOutcome).length / Math.max(1, recs.filter((r) => r.ownerDecision === 'approved').length) || null;
    const ownerApprovalRate = total > 0 ? recs.filter((r) => r.ownerDecision === 'approved').length / total : null;
    const rejectedRate = total > 0 ? recs.filter((r) => r.ownerDecision === 'rejected').length / total : null;

    const totalConfidence = total > 0 ? recs.reduce((sum, r) => sum + r.confidence, 0) : 0;
    const averageConfidence = total > 0 ? totalConfidence / total : 0;

    const history = recs.flatMap((r) => r.confidenceHistory.map((h) => ({ ...h, recommendationId: r.id })))
      .sort((a, b) => a.at - b.at);
    const confidenceDrift = this._slope(history, 'at', 'confidence');

    const decisionLatencies = recs.filter((r) => r.decisionAt && r.createdAt).map((r) => r.decisionAt - r.createdAt);
    const averageDecisionLatency = decisionLatencies.length > 0 ? decisionLatencies.reduce((a, b) => a + b, 0) / decisionLatencies.length : null;

    const now = Date.now();
    const aging = recs.filter((r) => !r.observedOutcome && r.createdAt).map((r) => now - r.createdAt);
    const averageRecommendationAge = aging.length > 0 ? aging.reduce((a, b) => a + b, 0) / aging.length : 0;

    const byAgent = {};
    for (const r of recs) {
      const agent = r.originatingAgent || 'unknown';
      if (!byAgent[agent]) byAgent[agent] = { total: 0, successful: 0, failed: 0 };
      byAgent[agent].total += 1;
      if (r.observedOutcome) {
        if (r.observedOutcome.type === 'successful') byAgent[agent].successful += 1;
        if (r.observedOutcome.type === 'failed') byAgent[agent].failed += 1;
      }
    }
    const topAgents = Object.entries(byAgent)
      .map(([agent, counts]) => ({ agent, ...counts, successRate: counts.total > 0 ? counts.successful / counts.total : 0 }))
      .sort((a, b) => b.successRate - a.successRate)
      .slice(0, 5);

    const byObjective = {};
    for (const r of recs) {
      const obj = r.strategicObjective || 'unknown';
      if (!byObjective[obj]) byObjective[obj] = { total: 0, confidence: 0, successful: 0 };
      byObjective[obj].total += 1;
      byObjective[obj].confidence += r.confidence;
      if (r.observedOutcome && r.observedOutcome.type === 'successful') byObjective[obj].successful += 1;
    }
    const lowestConfidenceAreas = Object.entries(byObjective)
      .map(([area, data]) => ({ area, averageConfidence: data.total > 0 ? data.confidence / data.total : 0, successRate: data.total > 0 ? data.successful / data.total : 0, count: data.total }))
      .sort((a, b) => a.averageConfidence - b.averageConfidence)
      .slice(0, 5);

    const recentLessons = recs.filter((r) => r.lessonsLearned)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 10)
      .map((r) => ({ id: r.id, lesson: r.lessonsLearned, at: r.updatedAt }));

    const learningVelocity = completed / Math.max(1, Math.ceil((now - since) / (24 * 60 * 60 * 1000)));

    const recommendationHistory = recs
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20)
      .map((r) => ({
        id: r.id,
        action: r.action,
        ownerDecision: r.ownerDecision,
        executionStatus: r.executionStatus,
        confidence: r.confidence,
        outcome: r.observedOutcome ? r.observedOutcome.type : null,
      }));

    return {
      since,
      total,
      completed,
      successful,
      partiallySuccessful: partial,
      failed,
      abandoned,
      cancelled,
      superseded,
      predictionAccuracy: predictionAccuracy === null ? null : Number(predictionAccuracy.toFixed(2)),
      recommendationSuccessRate: recommendationSuccessRate === null ? null : Number(recommendationSuccessRate.toFixed(2)),
      executionCompletionRate: executionCompletionRate === null ? null : Number(executionCompletionRate.toFixed(2)),
      ownerApprovalRate: ownerApprovalRate === null ? null : Number(ownerApprovalRate.toFixed(2)),
      rejectedRate: rejectedRate === null ? null : Number(rejectedRate.toFixed(2)),
      averageConfidence: Number(averageConfidence.toFixed(2)),
      confidenceDrift: Number(confidenceDrift.toFixed(4)),
      learningVelocity: Number(learningVelocity.toFixed(2)),
      averageDecisionLatency,
      averageRecommendationAge,
      topAgents,
      lowestConfidenceAreas,
      recentLessons,
      recommendationHistory,
      outcomeDistribution: { successful, partiallySuccessful: partial, failed, abandoned, cancelled, superseded },
      hasBaseline: total >= this.minEvidence,
    };
  }

  getLearningSummary(sinceMs) {
    const metrics = this.computeMetrics({ sinceMs });
    if (!metrics.hasBaseline) {
      return {
        hasBaseline: false,
        lines: ['Learning system still building historical baseline.'],
      };
    }
    const lines = [
      `Recommendations this period: ${metrics.total} (${metrics.completed} completed, ${metrics.failed} failed).`,
      `Prediction accuracy: ${(metrics.predictionAccuracy * 100).toFixed(0)}%.`,
      `Average confidence: ${(metrics.averageConfidence * 100).toFixed(0)}% (drift ${(metrics.confidenceDrift * 100).toFixed(2)}).`,
      `Most successful agent: ${metrics.topAgents[0]?.agent || 'none'}.`,
      `Lowest confidence area: ${metrics.lowestConfidenceAreas[0]?.area || 'none'}.`,
      `Recommendations awaiting outcome: ${metrics.total - metrics.completed}.`,
    ];
    return { hasBaseline: true, ...metrics, lines };
  }

  getDashboardData() {
    return this.computeMetrics({});
  }

  _slope(points, xKey, yKey) {
    if (!points || points.length < 2) return 0;
    const n = points.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;
    const startX = points[0][xKey];
    for (const p of points) {
      const x = p[xKey] - startX;
      const y = p[yKey];
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
    }
    const denom = n * sumXX - sumX * sumX;
    if (denom === 0) return 0;
    return (n * sumXY - sumX * sumY) / denom;
  }
}

module.exports = LearningMetrics;
