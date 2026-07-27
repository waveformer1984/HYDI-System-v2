'use strict';

const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');

const PERSISTENCE_VERSION = 1;

function generateId(prefix = 'rec') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function validateRecommendation(rec) {
  if (!rec || typeof rec !== 'object') throw new Error('Recommendation must be an object');
  if (typeof rec.action !== 'string' || rec.action.trim() === '') throw new Error('Recommendation must have an action string');
}

class DecisionOutcomeStore extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      dataPath: config.dataPath || path.resolve(__dirname, '../../data'),
      persistDebounceMs: config.persistDebounceMs ?? 50,
      logger: config.logger || console,
      ...config,
    };

    this.recommendations = new Map();
    this.outcomes = [];
    this._persistTimer = null;
    this._persistPending = false;
    this._started = false;
    this._destroyed = false;

    this.storePath = path.join(this.config.dataPath, 'decision-outcomes.json');
  }

  async start() {
    if (this._destroyed) throw new Error('DecisionOutcomeStore has been destroyed');
    if (this._started) return this;
    await this._ensureDataDir();
    await this._load();
    this._started = true;
    this.config.logger.log('[DecisionOutcomeStore] started');
    return this;
  }

  stop() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    this._started = false;
    this.config.logger.log('[DecisionOutcomeStore] stopped');
    return this;
  }

  async flush() {
    return this._flush();
  }

  async destroy() {
    if (this._destroyed) return this;
    this.stop();
    await this._flush();
    this.recommendations.clear();
    this.outcomes = [];
    this.removeAllListeners();
    this._destroyed = true;
    return this;
  }

  healthCheck() {
    return {
      ok: !this._destroyed && this._started,
      initialized: this._started,
      recommendations: this.recommendations.size,
      outcomes: this.outcomes.length,
      awaitingOutcomes: this.getAwaitingOutcomes().length,
    };
  }

  recordRecommendation(recommendation) {
    if (this._destroyed) throw new Error('DecisionOutcomeStore has been destroyed');
    if (!this._started) throw new Error('DecisionOutcomeStore has not been started');
    validateRecommendation(recommendation);

    const id = recommendation.id || generateId('rec');
    const now = Date.now();
    const existing = this.recommendations.get(id);
    const record = {
      id,
      action: recommendation.action,
      reason: recommendation.reason || 'No reason provided',
      originatingAgent: recommendation.originatingAgent || 'ExecutiveOperatingSystem',
      supportingSignals: Array.isArray(recommendation.supportingSignals) ? recommendation.supportingSignals : [],
      strategicObjective: recommendation.strategicObjective || null,
      confidence: Number.isFinite(recommendation.confidence) ? recommendation.confidence : 0.5,
      expectedValue: recommendation.expectedValue ?? null,
      expectedOutcome: recommendation.expectedOutcome || null,
      ownerDecision: recommendation.ownerDecision || 'pending',
      executionStatus: recommendation.executionStatus || 'pending',
      completionTime: recommendation.completionTime ?? null,
      observedOutcome: recommendation.observedOutcome || null,
      lessonsLearned: recommendation.lessonsLearned || null,
      confidenceHistory: Array.isArray(recommendation.confidenceHistory) ? recommendation.confidenceHistory : [{ at: now, confidence: recommendation.confidence || 0.5, reason: 'created' }],
      impacts: recommendation.impacts || { revenue: 0, schedule: 0, strategic: 0, operational: 0 },
      createdAt: existing?.createdAt || recommendation.createdAt || now,
      updatedAt: now,
      sourceId: recommendation.sourceId || recommendation.id || null,
    };

    this.recommendations.set(id, record);
    this._persist();
    this.emit('recommendation-recorded', record);
    return id;
  }

  recordDecision(id, decision) {
    if (this._destroyed) throw new Error('DecisionOutcomeStore has been destroyed');
    if (!this._started) throw new Error('DecisionOutcomeStore has not been started');
    const rec = this.recommendations.get(id);
    if (!rec) throw new Error(`Recommendation ${id} not found`);

    const ownerDecision = decision === 'approved' || decision === 'rejected' || decision === 'delayed' ? decision : 'pending';
    rec.ownerDecision = ownerDecision;
    rec.decisionAt = Date.now();
    if (ownerDecision === 'rejected') {
      rec.executionStatus = 'cancelled';
      rec.status = 'rejected';
    } else if (ownerDecision === 'delayed') {
      rec.status = 'delayed';
    } else if (ownerDecision === 'approved') {
      rec.status = 'approved';
    }
    rec.updatedAt = Date.now();
    this._persist();
    this.emit('decision-recorded', { id, ownerDecision });
    return rec;
  }

  recordExecution(id, execution) {
    if (this._destroyed) throw new Error('DecisionOutcomeStore has been destroyed');
    const rec = this.recommendations.get(id);
    if (!rec) throw new Error(`Recommendation ${id} not found`);
    rec.executionStatus = execution.status || rec.executionStatus;
    rec.completionTime = execution.completedAt || null;
    if (execution.executedBy) rec.executedBy = execution.executedBy;
    rec.updatedAt = Date.now();
    this._persist();
    return rec;
  }

  recordOutcome(id, outcome) {
    if (this._destroyed) throw new Error('DecisionOutcomeStore has been destroyed');
    const rec = this.recommendations.get(id);
    if (!rec) throw new Error(`Recommendation ${id} not found`);

    const now = Date.now();
    const normalized = {
      type: outcome.type || 'unknown',
      observedAt: outcome.observedAt || now,
      completedAt: outcome.completedAt || now,
      actual: outcome.actual ?? null,
      expected: outcome.expected ?? rec.expectedValue,
      impacts: outcome.impacts || { revenue: 0, schedule: 0, strategic: 0, operational: 0 },
      adjustedConfidence: outcome.adjustedConfidence ?? rec.confidence,
      confidenceDelta: outcome.confidenceDelta ?? 0,
      lesson: outcome.lesson || null,
    };

    rec.observedOutcome = normalized;
    rec.executionStatus = outcome.type === 'successful' || outcome.type === 'partially successful' ? 'completed' : (outcome.type || rec.executionStatus);
    rec.completionTime = normalized.completedAt;
    rec.lessonsLearned = normalized.lesson;
    rec.updatedAt = now;
    this.outcomes.push({ recommendationId: id, ...normalized });
    this._persist();
    this.emit('outcome-recorded', { id, outcome: normalized });
    return rec;
  }

  addConfidenceHistory(id, confidence, reason = 'calibrated') {
    if (this._destroyed) throw new Error('DecisionOutcomeStore has been destroyed');
    const rec = this.recommendations.get(id);
    if (!rec) throw new Error(`Recommendation ${id} not found`);
    if (!Number.isFinite(confidence)) throw new Error('Confidence must be a number');
    rec.confidence = confidence;
    rec.confidenceHistory.push({ at: Date.now(), confidence, reason });
    rec.updatedAt = Date.now();
    this._persist();
    this.emit('confidence-updated', { id, confidence, reason });
    return rec;
  }

  getRecommendation(id) {
    const rec = this.recommendations.get(id);
    return rec ? { ...rec } : null;
  }

  findRecommendations(query = {}) {
    let list = Array.from(this.recommendations.values()).map((r) => ({ ...r }));
    if (query.status) list = list.filter((r) => r.status === query.status);
    if (query.ownerDecision) list = list.filter((r) => r.ownerDecision === query.ownerDecision);
    if (query.executionStatus) list = list.filter((r) => r.executionStatus === query.executionStatus);
    if (query.strategicObjective) list = list.filter((r) => r.strategicObjective === query.strategicObjective);
    if (query.originatingAgent) list = list.filter((r) => r.originatingAgent === query.originatingAgent);
    if (query.since) list = list.filter((r) => r.createdAt >= query.since);
    if (query.limit) list = list.slice(0, query.limit);
    return list;
  }

  getOutcomes(query = {}) {
    let list = this.outcomes.map((o) => ({ ...o }));
    if (query.recommendationId) list = list.filter((o) => o.recommendationId === query.recommendationId);
    if (query.type) list = list.filter((o) => o.type === query.type);
    if (query.since) list = list.filter((o) => o.observedAt >= query.since);
    if (query.limit) list = list.slice(-query.limit);
    return list;
  }

  getAwaitingOutcomes() {
    return this.findRecommendations({ ownerDecision: 'approved' })
      .filter((r) => !r.observedOutcome && r.executionStatus !== 'failed');
  }

  getConfidenceHistory(id) {
    const rec = this.recommendations.get(id);
    return rec ? [...rec.confidenceHistory] : [];
  }

  getLearningSummary(sinceMs = 30 * 24 * 60 * 60 * 1000) {
    const since = Date.now() - sinceMs;
    const all = this.findRecommendations({ since });
    const completed = all.filter((r) => r.observedOutcome).length;
    const rejected = all.filter((r) => r.ownerDecision === 'rejected').length;
    const delayed = all.filter((r) => r.ownerDecision === 'delayed').length;
    const awaiting = this.getAwaitingOutcomes().filter((r) => r.createdAt >= since).length;
    return {
      since,
      total: all.length,
      completed,
      rejected,
      delayed,
      awaiting,
      outcomeCount: this.outcomes.filter((o) => o.observedAt >= since).length,
    };
  }

  async _ensureDataDir() {
    try {
      await fs.mkdir(this.config.dataPath, { recursive: true });
    } catch (e) {
      this.config.logger.error('[DecisionOutcomeStore] data dir error', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  async _load() {
    try {
      const raw = await fs.readFile(this.storePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === PERSISTENCE_VERSION && Array.isArray(parsed.recommendations)) {
        this.recommendations = new Map(parsed.recommendations.map((r) => [r.id, r]));
        this.outcomes = Array.isArray(parsed.outcomes) ? parsed.outcomes : [];
      } else {
        throw new Error('invalid snapshot');
      }
    } catch (e) {
      if (e.code === 'ENOENT') {
        this.recommendations = new Map();
        this.outcomes = [];
      } else {
        this.config.logger.error('[DecisionOutcomeStore] load error, starting fresh', { error: e instanceof Error ? e.message : String(e) });
        this.recommendations = new Map();
        this.outcomes = [];
      }
    }
  }

  _persist() {
    if (this._destroyed) return;
    this._persistPending = true;
    if (this._persistTimer) return;
    this._persistTimer = setTimeout(() => this._flush(), this.config.persistDebounceMs);
    if (this._persistTimer.unref) this._persistTimer.unref();
  }

  async _flush() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    if (!this._persistPending) return;
    this._persistPending = false;

    const snapshot = {
      version: PERSISTENCE_VERSION,
      updatedAt: Date.now(),
      recommendations: Array.from(this.recommendations.values()),
      outcomes: this.outcomes,
    };
    const temp = `${this.storePath}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(snapshot, null, 2));
      await fs.rename(temp, this.storePath);
    } catch (e) {
      this.config.logger.error('[DecisionOutcomeStore] persist error', { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

module.exports = DecisionOutcomeStore;
