'use strict';

const DecisionOutcomeStore = require('./DecisionOutcomeStore');

function generateId(prefix = 'rec') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

class RecommendationTracker {
  constructor(config = {}) {
    this.config = {
      dataPath: config.dataPath || undefined,
      logger: config.logger || console,
    };
    this.store = config.decisionOutcomeStore || new DecisionOutcomeStore({
      dataPath: this.config.dataPath,
      logger: this.config.logger,
    });
    this._started = false;
    this._destroyed = false;
  }

  async start() {
    if (this._destroyed) throw new Error('RecommendationTracker has been destroyed');
    if (this._started) return this;
    await this.store.start();
    this._started = true;
    this.config.logger.log('[RecommendationTracker] started');
    return this;
  }

  stop() {
    this.store.stop();
    this._started = false;
    this.config.logger.log('[RecommendationTracker] stopped');
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
    return {
      ok: !this._destroyed && this._started,
      ...this.store.healthCheck(),
    };
  }

  /**
   * Track a new recommendation. Returns a permanent recommendation id.
   */
  track(recommendation) {
    if (this._destroyed) throw new Error('RecommendationTracker has been destroyed');
    if (!this._started) throw new Error('RecommendationTracker has not been started');
    const inputId = recommendation.id;
    const enriched = {
      ...recommendation,
      sourceId: recommendation.sourceId || inputId || null,
      id: generateId('rec'),
    };
    return this.store.recordRecommendation(enriched);
  }

  /**
   * Record the owner's decision: approved, rejected, or delayed.
   */
  recordDecision(recommendationId, decision) {
    if (this._destroyed) throw new Error('RecommendationTracker has been destroyed');
    return this.store.recordDecision(recommendationId, decision);
  }

  /**
   * Record execution progress on a recommendation.
   */
  recordExecution(recommendationId, execution) {
    if (this._destroyed) throw new Error('RecommendationTracker has been destroyed');
    return this.store.recordExecution(recommendationId, execution);
  }

  /**
   * Record the observed outcome for a recommendation.
   */
  recordOutcome(recommendationId, outcome) {
    if (this._destroyed) throw new Error('RecommendationTracker has been destroyed');
    return this.store.recordOutcome(recommendationId, outcome);
  }

  /**
   * Update confidence and append to confidence history.
   */
  updateConfidence(recommendationId, confidence, reason) {
    if (this._destroyed) throw new Error('RecommendationTracker has been destroyed');
    return this.store.addConfidenceHistory(recommendationId, confidence, reason);
  }

  getRecommendation(recommendationId) {
    return this.store.getRecommendation(recommendationId);
  }

  getRecentRecommendations(limit = 20, since) {
    const query = {};
    if (since) query.since = since;
    return this.store.findRecommendations(query)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  getAwaitingOutcomes() {
    return this.store.getAwaitingOutcomes();
  }

  getLearningSummary(sinceMs) {
    return this.store.getLearningSummary(sinceMs);
  }
}

module.exports = RecommendationTracker;
