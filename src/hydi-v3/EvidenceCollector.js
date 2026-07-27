'use strict';

const { EventEmitter } = require('events');

class EvidenceCollector extends EventEmitter {
  constructor(config = {}) {
    super();
    this.eventBus = config.eventBus || null;
    this.providers = config.evidenceProviders || null;
    this.evidence = [];
    this.attached = new Map(); // recommendationId -> evidenceId[]
    this._handler = this._onEvent.bind(this);
    this._started = false;
    this._destroyed = false;
  }

  start() {
    if (this._destroyed) throw new Error('EvidenceCollector has been destroyed');
    if (this._started) return this;
    if (this.eventBus) this.eventBus.subscribeAll(this._handler);
    this._started = true;
    return this;
  }

  stop() {
    if (this.eventBus && this._started) this.eventBus.unsubscribe('*', this._handler);
    this._started = false;
    return this;
  }

  async flush() {
    return this;
  }

  destroy() {
    if (this._destroyed) return this;
    this.stop();
    this.evidence = [];
    this.attached.clear();
    this.removeAllListeners();
    this._destroyed = true;
    return this;
  }

  healthCheck() {
    return {
      ok: !this._destroyed && this._started,
      evidenceCount: this.evidence.length,
      attachedCount: this.attached.size,
      hasBus: !!this.eventBus,
      hasProviders: !!this.providers,
    };
  }

  _onEvent(event) {
    if (this._destroyed) return;
    const source = event.source || 'unknown';
    const items = this.providers ? this.providers.extract(source, event) : null;
    if (!items || items.length === 0) return;
    for (const item of items) {
      this._add(item);
      this.emit('evidence-collected', item);
    }
  }

  _add(item) {
    this.evidence.push(item);
    return item;
  }

  addEvidence(recommendationId, item) {
    if (this._destroyed) throw new Error('EvidenceCollector has been destroyed');
    const evidence = {
      ...item,
      id: item.id || `ev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      attachedTo: recommendationId,
      measurementType: item.measurementType
        || (Number.isFinite(item.data && item.data.value) ? 'quantitative' : null)
        || (item.source === 'manual' ? 'qualitative' : 'activity'),
    };
    this._add(evidence);
    const list = this.attached.get(recommendationId) || [];
    list.push(evidence.id);
    this.attached.set(recommendationId, list);
    this.emit('evidence-attached', { recommendationId, evidence });
    return evidence;
  }

  getEvidence(recommendationId, recommendation = null) {
    if (recommendationId || recommendation) {
      const id = recommendation ? recommendation.id : recommendationId;
      const ids = this.attached.get(id) || [];
      const attached = this.evidence.filter((e) => ids.includes(e.id));
      const target = recommendation || { id, createdAt: 0 };
      const related = this.findForRecommendation(target);
      return [...attached, ...related].filter((e, i, a) => a.findIndex((x) => x.id === e.id) === i);
    }
    return this.evidence.slice();
  }

  findForRecommendation(recommendation, options = {}) {
    const windowMs = options.windowMs ?? 14 * 24 * 60 * 60 * 1000;
    const since = recommendation.createdAt || (Date.now() - windowMs);
    const objective = recommendation.strategicObjective;
    const tags = new Set(Array.isArray(recommendation.supportingSignals) ? recommendation.supportingSignals : []);
    if (objective) tags.add(objective);

    return this.evidence.filter((e) => {
      const inWindow = e.at >= since && e.at <= since + windowMs;
      if (!inWindow) return false;
      const itemTags = new Set(Array.isArray(e.tags) ? e.tags : []);
      const tagMatch = Array.from(tags).some((t) => itemTags.has(t));
      const objectiveMatch = objective && (e.tags && e.tags.includes(objective));
      return tagMatch || objectiveMatch;
    });
  }

  getRecommendationsAwaitingReview(recommendations) {
    return recommendations.filter((r) => {
      if (r.observedOutcome) return false;
      const evidence = this.getEvidence(r.id, r);
      return evidence.length > 0;
    });
  }
}

module.exports = EvidenceCollector;
