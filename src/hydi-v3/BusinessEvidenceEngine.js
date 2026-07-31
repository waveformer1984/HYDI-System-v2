'use strict';

const { EventEmitter } = require('events');
const BusinessKPIRegistry = require('./BusinessKPIRegistry');
const { EvidenceProviders } = require('./EvidenceProviders');
const EvidenceCollector = require('./EvidenceCollector');
const OutcomeCorrelation = require('./OutcomeCorrelation');
const OutcomeEvaluator = require('./OutcomeEvaluator');

class BusinessEvidenceEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    this.logger = config.logger || console;
    this.kpiRegistry = config.kpiRegistry || new BusinessKPIRegistry();
    this.providers = config.evidenceProviders || new EvidenceProviders().registerDefaults();
    this.collector = config.evidenceCollector || new EvidenceCollector({ eventBus: config.eventBus, evidenceProviders: this.providers });
    this.outcomeCorrelation = config.outcomeCorrelation || new OutcomeCorrelation();
    this.outcomeEvaluator = config.outcomeEvaluator || new OutcomeEvaluator({ outcomeCorrelation: this.outcomeCorrelation });
    this.recommendationTracker = config.recommendationTracker || null;
    this.businessOutcomeEngine = config.businessOutcomeEngine || null;
    this.staleMs = config.staleMs ?? 14 * 24 * 60 * 60 * 1000;

    this._autoEvaluate = config.autoEvaluate !== false;
    this._evidenceHandler = this._onEvidence.bind(this);
    this._started = false;
    this._destroyed = false;
  }

  async start() {
    if (this._destroyed) throw new Error('BusinessEvidenceEngine has been destroyed');
    if (this._started) return this;
    this.collector.start();
    if (this._autoEvaluate) this.collector.on('evidence-attached', this._evidenceHandler);
    this._started = true;
    this.logger.log('[BusinessEvidenceEngine] started');
    return this;
  }

  stop() {
    if (this.collector) this.collector.stop();
    if (this.collector && this._evidenceHandler) this.collector.off('evidence-attached', this._evidenceHandler);
    this._started = false;
    this.logger.log('[BusinessEvidenceEngine] stopped');
    return this;
  }

  async flush() {
    if (this.collector && this.collector.flush) await this.collector.flush();
    return this;
  }

  async destroy() {
    if (this._destroyed) return this;
    this.stop();
    if (this.collector && this.collector.destroy) this.collector.destroy();
    this.removeAllListeners();
    this._destroyed = true;
    return this;
  }

  healthCheck() {
    return {
      ok: !this._destroyed && this._started,
      collector: this.collector ? this.collector.healthCheck() : { ok: false },
      kpiCount: this.kpiRegistry ? this.kpiRegistry.list().length : 0,
      providerCount: this.providers ? this.providers.list().length : 0,
    };
  }

  _onEvidence({ recommendationId }) {
    if (!recommendationId || !this.recommendationTracker) return;
    const rec = this.recommendationTracker.getRecommendation(recommendationId);
    if (!rec || rec.observedOutcome) return;
    const collected = this.collector.getEvidence(recommendationId);
    const quality = this._quality(collected);
    if (quality >= 0.7 && collected.length >= 3) {
      try {
        this.evaluateRecommendation(recommendationId);
      } catch (e) {
        this.logger.error('[BusinessEvidenceEngine] auto-evaluation failed', { error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  _quality(evidence) {
    if (!evidence || evidence.length === 0) return 0;
    const total = evidence.reduce((s, i) => {
      const w = Number.isFinite(i.weight) ? i.weight : 0.5;
      const c = Number.isFinite(i.confidence) ? i.confidence : 0.5;
      const r = Number.isFinite(i.relevance) ? i.relevance : 0.5;
      return s + w * c * r;
    }, 0);
    return total / evidence.length;
  }

  addEvidence(recommendationId, evidence) {
    if (this._destroyed) throw new Error('BusinessEvidenceEngine has been destroyed');
    if (!this.recommendationTracker) throw new Error('RecommendationTracker not connected');
    const rec = this.recommendationTracker.getRecommendation(recommendationId);
    if (!rec) throw new Error(`Recommendation ${recommendationId} not found`);
    if (!evidence || typeof evidence !== 'object') throw new Error('Evidence must be an object');
    if (!evidence.source || !evidence.type) throw new Error('Evidence must include source and type');
    if (evidence.data !== undefined && evidence.data !== null && typeof evidence.data !== 'object') throw new Error('Evidence data must be an object');
    if (evidence.data && 'value' in evidence.data && evidence.data.value !== undefined && evidence.data.value !== null && !Number.isFinite(evidence.data.value)) throw new Error('Evidence data.value must be a finite number');
    if (Number.isFinite(evidence.at) && evidence.at > Date.now() + 1000) throw new Error('Evidence timestamp cannot be in the future');
    return this.collector.addEvidence(recommendationId, evidence);
  }

  requestManualReview(recommendationId) {
    if (this._destroyed) throw new Error('BusinessEvidenceEngine has been destroyed');
    const rec = this.recommendationTracker ? this.recommendationTracker.getRecommendation(recommendationId) : null;
    if (!rec) throw new Error(`Recommendation ${recommendationId} not found`);
    return {
      recommendationId,
      action: rec.action,
      expectedOutcome: rec.expectedOutcome || `expected value ${rec.expectedValue || 'not set'}`,
      question: `Did "${rec.action}" achieve the expected outcome?`,
      options: ['Yes', 'Partially', 'No', 'Unknown', 'Skip'],
    };
  }

  submitManualReview(recommendationId, answer) {
    if (this._destroyed) throw new Error('BusinessEvidenceEngine has been destroyed');
    this.addEvidence(recommendationId, {
      source: 'manual',
      type: 'manual-confirmation',
      at: Date.now(),
      provenance: 'owner-review',
      relevance: 1.0,
      weight: 1.0,
      confidence: 0.95,
      measurementType: 'qualitative',
      currency: null,
      unit: null,
      precision: null,
      data: { answer: String(answer).toLowerCase() },
      tags: ['manual'],
    });
    return this.evaluateRecommendation(recommendationId);
  }

  evaluateRecommendation(recommendationId) {
    if (this._destroyed) throw new Error('BusinessEvidenceEngine has been destroyed');
    if (!this.recommendationTracker) throw new Error('RecommendationTracker not connected');
    const rec = this.recommendationTracker.getRecommendation(recommendationId);
    if (!rec) throw new Error(`Recommendation ${recommendationId} not found`);

    const evidence = this.collector.getEvidence(recommendationId, rec);
    const kpiSnapshot = this.kpiRegistry ? this.kpiRegistry.evaluateAll() : {};
    const result = this.outcomeEvaluator.evaluate(rec, evidence, kpiSnapshot);

    this.outcomeCorrelation.recordPrediction(rec, result);

    if (result.outcomeType && this.businessOutcomeEngine) {
      // `measured` must reflect whether a number was actually observed. An
      // owner confirming "yes it worked" is a real classification but not a
      // measurement — asserting measured:true for it recorded `actual: 0`
      // against the expected value, so a confirmed success also booked a
      // revenue impact of minus the entire expectation.
      const measured = result.hasMeasuredValue === true;
      this.businessOutcomeEngine.recordOutcome(recommendationId, {
        value: measured ? result.observedValue : null,
        type: result.outcomeType,
        completedAt: Date.now(),
        observedAt: Date.now(),
        measured,
        provenance: `evidence-evaluation:${evidence.map((e) => e.source).join(',')}`,
        lesson: result.explanation,
      });
    }

    // Ensure the outcome is persisted even if BusinessOutcomeEngine is not wired.
    if (result.outcomeType && this.recommendationTracker) {
      this.recommendationTracker.recordOutcome(recommendationId, {
        type: result.outcomeType,
        actual: result.hasMeasuredValue ? result.observedValue : null,
        measured: result.hasMeasuredValue === true,
        lesson: result.explanation,
        observedAt: Date.now(),
        completedAt: Date.now(),
      });
    }

    this.emit('outcome-evaluated', { recommendationId, result });
    return result;
  }

  getEvidenceSummary(recommendationId) {
    if (recommendationId) {
      return {
        recommendationId,
        evidence: this.collector.getEvidence(recommendationId),
      };
    }
    return {
      total: this.collector.evidence.length,
      bySource: this.collector.evidence.reduce((acc, e) => {
        acc[e.source] = (acc[e.source] || 0) + 1;
        return acc;
      }, {}),
    };
  }

  getRecommendationsAwaitingReview() {
    if (!this.recommendationTracker) return [];
    const all = this.recommendationTracker.store ? this.recommendationTracker.store.findRecommendations({}) : [];
    return this.collector.getRecommendationsAwaitingReview(all);
  }

  getRecommendationsLackingEvidence(windowMs = 14 * 24 * 60 * 60 * 1000) {
    if (!this.recommendationTracker) return [];
    const all = this.recommendationTracker.store ? this.recommendationTracker.store.findRecommendations({}) : [];
    const now = Date.now();
    return all.filter((r) => {
      if (r.observedOutcome) return false;
      if (now - r.createdAt > windowMs) return false;
      const evidence = this.collector.getEvidence(r.id, r);
      return evidence.length === 0;
    });
  }

  getHighestConfidenceRecommendations(limit = 5) {
    if (!this.recommendationTracker) return [];
    const all = this.recommendationTracker.store ? this.recommendationTracker.store.findRecommendations({}) : [];
    return all
      .filter((r) => !r.observedOutcome)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  getRecentlyConfirmedOutcomes(limit = 5) {
    if (!this.recommendationTracker) return [];
    const all = this.recommendationTracker.store ? this.recommendationTracker.store.findRecommendations({}) : [];
    return all
      .filter((r) => r.observedOutcome)
      .sort((a, b) => (b.observedOutcome ? b.observedOutcome.observedAt : 0) - (a.observedOutcome ? a.observedOutcome.observedAt : 0))
      .slice(0, limit)
      .map((r) => ({ id: r.id, action: r.action, outcome: r.observedOutcome.type, at: r.observedOutcome.observedAt }));
  }

  getPredictionAccuracy() {
    const samples = this.outcomeCorrelation.getPredictionHistory();
    if (samples.length === 0) return null;
    const sum = samples.reduce((s, x) => s + x.accuracy, 0);
    return Number((sum / samples.length).toFixed(4));
  }

  getBusinessKPIs(context = {}) {
    return this.kpiRegistry ? this.kpiRegistry.evaluateAll(context) : {};
  }

  getDashboardData() {
    return {
      learningVelocity: this.getRecentlyConfirmedOutcomes().length,
      evidenceQuality: this.getEvidenceSummary().total,
      predictionAccuracy: this.getPredictionAccuracy(),
      outcomeQueue: this.getRecommendationsAwaitingReview().length,
      evidenceAwaiting: this.getRecommendationsAwaitingReview().length,
      manualReviews: this.getRecommendationsAwaitingReview().length,
      topKPIs: this.getBusinessKPIs(),
      businessHealth: this._health(),
    };
  }

  getSummary() {
    const awaiting = this.getRecommendationsAwaitingReview().length;
    const lacking = this.getRecommendationsLackingEvidence().length;
    const confirmed = this.getRecentlyConfirmedOutcomes(5);
    const accuracy = this.getPredictionAccuracy();
    const kpis = this.getBusinessKPIs();
    const top = this.getHighestConfidenceRecommendations(3);

    const lines = [
      `Evidence awaiting review: ${awaiting}`,
      `Recommendations lacking evidence: ${lacking}`,
      `Recently confirmed outcomes: ${confirmed.length}`,
      `Prediction accuracy: ${accuracy === null ? 'building baseline' : `${(accuracy * 100).toFixed(0)}%`}`,
      `Highest-confidence recommendations: ${top.map((r) => r.action).join(', ') || 'none'}`,
      `Business KPIs: ${Object.values(kpis).filter((k) => k.value !== null).length} available`,
    ];

    if (confirmed.length > 0) {
      lines.push('Recent confirmations:');
      for (const c of confirmed) {
        lines.push(`- ${c.action}: ${c.outcome}`);
      }
    }

    return { awaiting, lacking, confirmed, accuracy, top, kpis, lines };
  }

  getAwaitingEvidence() {
    if (!this.recommendationTracker) return [];
    const store = this.recommendationTracker.store;
    if (!store) return [];
    return store.getAwaitingOutcomes ? store.getAwaitingOutcomes() : [];
  }

  getCompletedLearning() {
    if (!this.recommendationTracker) return [];
    const all = this.recommendationTracker.store ? this.recommendationTracker.store.findRecommendations({}) : [];
    return all.filter((r) => r.observedOutcome);
  }

  getStaleRecommendations() {
    if (!this.recommendationTracker) return [];
    const now = Date.now();
    const all = this.recommendationTracker.store ? this.recommendationTracker.store.findRecommendations({}) : [];
    return all.filter((r) => {
      if (r.observedOutcome) return false;
      if (r.ownerDecision !== 'approved') return false;
      return now - (r.decisionAt || r.createdAt) > this.staleMs;
    });
  }

  abandonStale(reason = 'abandoned due to age') {
    const stale = this.getStaleRecommendations();
    const abandoned = [];
    for (const rec of stale) {
      if (this.recommendationTracker) {
        this.recommendationTracker.recordOutcome(rec.id, {
          type: 'abandoned',
          measured: false,
          lesson: reason,
          observedAt: Date.now(),
          completedAt: Date.now(),
        });
        abandoned.push(rec.id);
      }
    }
    return abandoned;
  }

  getTopImprovingRecommendations(limit = 5) {
    if (!this.recommendationTracker) return [];
    const all = this.recommendationTracker.store ? this.recommendationTracker.store.findRecommendations({}) : [];
    return all
      .filter((r) => r.confidenceHistory && r.confidenceHistory.length > 1)
      .map((r) => {
        const first = r.confidenceHistory[0].confidence;
        const last = r.confidenceHistory[r.confidenceHistory.length - 1].confidence;
        return { id: r.id, action: r.action, change: last - first, current: last };
      })
      .filter((r) => r.change > 0)
      .sort((a, b) => b.change - a.change)
      .slice(0, limit);
  }

  getRecommendationsLosingConfidence(limit = 5) {
    if (!this.recommendationTracker) return [];
    const all = this.recommendationTracker.store ? this.recommendationTracker.store.findRecommendations({}) : [];
    return all
      .filter((r) => r.confidenceHistory && r.confidenceHistory.length > 1)
      .map((r) => {
        const first = r.confidenceHistory[0].confidence;
        const last = r.confidenceHistory[r.confidenceHistory.length - 1].confidence;
        return { id: r.id, action: r.action, change: last - first, current: last };
      })
      .filter((r) => r.change < 0)
      .sort((a, b) => a.change - b.change)
      .slice(0, limit);
  }

  getMeasuredLearningDashboard() {
    const allEvidence = this.collector ? this.collector.getEvidence() : [];
    const quantitative = allEvidence.filter((e) => e.measurementType === 'quantitative');
    const financialEvidence = quantitative.filter((e) => e.source === 'financial' || e.tags.includes('revenue'));
    const revenue = financialEvidence.reduce((sum, e) => sum + (e.data && Number.isFinite(e.data.value) ? e.data.value : 0), 0);
    const lastRevenueAt = financialEvidence.length
      ? financialEvidence.reduce((max, e) => Math.max(max, e.at || 0), 0)
      : null;
    const averageRevenueConfidence = financialEvidence.length
      ? Number((financialEvidence.reduce((sum, e) => sum + (Number.isFinite(e.confidence) ? e.confidence : 0.5), 0) / financialEvidence.length).toFixed(3))
      : null;

    const completed = this.getCompletedLearning();
    const measuredOutcomes = completed.filter((r) => r.observedOutcome && r.observedOutcome.measurementType === 'quantitative');
    const measuredValue = measuredOutcomes.reduce((sum, r) => sum + (r.observedOutcome.actual || 0), 0);
    const expectedValue = measuredOutcomes.reduce((sum, r) => sum + (r.expectedValue || 0), 0);
    const measuredROI = expectedValue > 0 ? Number(((measuredValue - expectedValue) / expectedValue).toFixed(4)) : null;

    const confidenceTrend = this._confidenceTrend(completed);

    return {
      revenue,
      lastRevenueAt,
      averageRevenueConfidence,
      financialEvidenceCount: financialEvidence.length,
      measuredROI,
      estimatedROI: null, // not inferred; reserved for future forecasted projections
      confidenceTrend,
      pendingEvidence: this.getAwaitingEvidence().length,
      recentMeasurements: quantitative.slice(-5),
      evidenceSources: allEvidence.reduce((acc, e) => {
        acc[e.source] = (acc[e.source] || 0) + 1;
        return acc;
      }, {}),
      calibrationHistory: completed
        .filter((r) => r.confidenceHistory && r.confidenceHistory.length > 1)
        .flatMap((r) => r.confidenceHistory.map((h) => ({ recommendationId: r.id, ...h })))
        .sort((a, b) => b.at - a.at)
        .slice(0, 20),
    };
  }

  _confidenceTrend(completed) {
    const points = completed
      .filter((r) => r.confidenceHistory && r.confidenceHistory.length > 1)
      .map((r) => {
        const first = r.confidenceHistory[0].confidence;
        const last = r.confidenceHistory[r.confidenceHistory.length - 1].confidence;
        return last - first;
      });
    if (points.length === 0) return 0;
    return Number((points.reduce((a, b) => a + b, 0) / points.length).toFixed(4));
  }

  _health() {
    const kpis = this.kpiRegistry ? this.kpiRegistry.evaluateAll() : {};
    const values = Object.values(kpis).filter((k) => k.value !== null);
    if (values.length === 0) return 'unknown';
    const met = values.filter((k) => k.status === 'target-met').length;
    return met / values.length >= 0.7 ? 'healthy' : met / values.length >= 0.4 ? 'watch' : 'at-risk';
  }
}

module.exports = BusinessEvidenceEngine;
