'use strict';

const TIERS = Object.freeze({
  SHORT_TERM: 'SHORT_TERM',
  WORKING: 'WORKING',
  LONG_TERM: 'LONG_TERM',
  EXECUTIVE: 'EXECUTIVE',
});

function cosineSimilarity(a, b) {
  const dot = a.reduce((s, v, i) => s + v * (b[i] || 0), 0);
  const na = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const nb = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
  return (na && nb) ? dot / (na * nb) : 0;
}

class SemanticMemoryIndex {
  constructor(config = {}) {
    this.embeddingManager = config.embeddingManager || null;
    this.businessMemory = config.businessMemory || null;
    this.logger = config.logger || console;
    this.decayRate = config.decayRate || 0.01;
    this.duplicateThreshold = config.duplicateThreshold || 0.95;
    this.stalenessDays = config.stalenessDays || 90;
  }

  async remember(text, meta = {}) {
    if (!this.embeddingManager) return null;
    const tier = TIERS[meta.tier] ? meta.tier : TIERS.WORKING;
    const existing = await this._findDuplicate(text);
    if (existing) {
      existing.meta.importance = Math.min((existing.meta.importance || 1) + 0.5, 5);
      existing.meta.confidence = Math.max(existing.meta.confidence || 0.5, meta.confidence || 0.5);
      await this.embeddingManager.persist();
      return existing;
    }
    const doc = await this.embeddingManager.addDocument(text, {
      ...meta,
      tier,
      importance: meta.importance ?? 1,
      confidence: meta.confidence ?? 0.5,
      source: meta.source || 'unknown',
      verified: meta.verified === true,
      createdAt: meta.createdAt || Date.now(),
    });
    return doc;
  }

  async recall(query, opts = {}) {
    if (!this.embeddingManager) return [];
    const docs = this.embeddingManager.list();
    const qvResult = await this.embeddingManager.modelManager.embed(query);
    if (!qvResult.ok || !qvResult.vector) return [];
    const qv = qvResult.vector;
    const tierOrder = { SHORT_TERM: 4, WORKING: 3, LONG_TERM: 2, EXECUTIVE: 1 };
    return docs
      .map((d) => this._scoreMemory(d, qv, tierOrder))
      .filter((d) => d.score > 0.05)
      .map((d) => { this._recordRetrieval(d, d.score); return d; })
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.limit || 10);
  }

  _scoreMemory(d, qv, tierOrder) {
    const ageDays = (Date.now() - (d.meta?.createdAt || d.at || Date.now())) / 86400000;
    const decay = Math.max(0, 1 - this.decayRate * ageDays);
    const importance = d.meta?.importance || 1;
    const confidence = d.meta?.confidence || 0.5;
    const tierBoost = (tierOrder[d.meta?.tier] || 0) * 0.05;
    const stale = ageDays > this.stalenessDays;
    return {
      ...d,
      score: (cosineSimilarity(qv, d.vector) * importance * confidence * decay) + tierBoost,
      stale,
      ageDays,
    };
  }

  async similarProjects(name, limit = 5) {
    return this.recall(`project ${name}`, { limit });
  }

  async similarFailures(context, limit = 5) {
    return this.recall(`failure ${context}`, { limit });
  }

  detectContradictions() {
    // Simple contradiction: two memories with high similarity but opposite sentiment keywords.
    const docs = this.embeddingManager.list();
    const conflicts = [];
    for (let i = 0; i < docs.length; i++) {
      for (let j = i + 1; j < docs.length; j++) {
        const a = docs[i].text.toLowerCase();
        const b = docs[j].text.toLowerCase();
        const sim = cosineSimilarity(docs[i].vector || [], docs[j].vector || []);
        if (sim > 0.4 && this._hasOppositeSentiment(a, b)) {
          conflicts.push({ a: docs[i], b: docs[j], similarity: sim });
        }
      }
    }
    return conflicts;
  }

  _hasOppositeSentiment(a, b) {
    const positive = ['success', 'growth', 'up', 'increase', 'good', 'ready'];
    const negative = ['failure', 'risk', 'down', 'decrease', 'bad', 'blocked'];
    const aPos = positive.some((w) => a.includes(w));
    const aNeg = negative.some((w) => a.includes(w));
    const bPos = positive.some((w) => b.includes(w));
    const bNeg = negative.some((w) => b.includes(w));
    return (aPos && bNeg) || (aNeg && bPos);
  }

  async _findDuplicate(text) {
    const r = await this.embeddingManager.search(text, 1);
    return r.length && r[0].score >= this.duplicateThreshold ? r[0] : null;
  }

  async ingestBusinessMemory() {
    if (!this.businessMemory || typeof this.businessMemory.find !== 'function') return 0;
    const items = this.businessMemory.find({ limit: 1000 });
    let added = 0;
    for (const item of items) {
      const text = typeof item === 'string' ? item : JSON.stringify(item);
      const ok = await this.remember(text, { sourceId: item.id, type: item.type || 'business-memory', tier: TIERS.LONG_TERM, importance: item.importance || 1, source: 'business-memory' });
      if (ok) added++;
    }
    return added;
  }
  _qualityScore(d, now = Date.now()) {
    const ageDays = (now - (d.meta?.createdAt || d.at || now)) / 86400000;
    const ageDecay = Math.max(0, 1 - ageDays / 90);
    const confidence = d.meta?.confidence || 0.5;
    const verified = d.meta?.verified === true ? 1.2 : 1;
    const retrievalCount = d.meta?.retrievalCount || 0;
    const successfulRetrievals = d.meta?.successfulRetrievals || 0;
    const contradictions = d.meta?.contradictions || 0;
    const usage = Math.min(1, retrievalCount / 10);
    const success = retrievalCount ? successfulRetrievals / retrievalCount : 0.5;
    return Math.max(0, (confidence * verified * ageDecay * (1 + usage) * success) - (contradictions * 0.3));
  }

  _recordRetrieval(d, score) {
    if (!d || !d.meta) return;
    d.meta.retrievalCount = (d.meta.retrievalCount || 0) + 1;
    if (score > 0.5) d.meta.successfulRetrievals = (d.meta.successfulRetrievals || 0) + 1;
    d.meta.lastRetrieved = Date.now();
  }

  getMetrics() {
    const docs = this.embeddingManager ? this.embeddingManager.list() : [];
    const now = Date.now();
    let stale = 0;
    let review = 0;
    let archived = 0;
    let promoted = 0;
    let protectedCount = 0;
    let totalQuality = 0;
    const seen = new Set();
    let duplicates = 0;
    for (const d of docs) {
      const ageDays = (now - (d.meta?.createdAt || d.at || now)) / 86400000;
      if (ageDays > this.stalenessDays) stale++;
      if (d.meta?.reviewRecommended) review++;
      if (d.meta?.tier === TIERS.LONG_TERM && (d.meta?.qualityScore || 0) < 0.3) archived++;
      if (d.meta?.tier === TIERS.EXECUTIVE) promoted++;
      if (d.meta?.protected === true) protectedCount++;
      const key = (d.text || '').trim().toLowerCase().slice(0, 120);
      if (seen.has(key)) duplicates++; else seen.add(key);
      totalQuality += this._qualityScore(d, now);
    }
    const contradictions = this.detectContradictions().length;
    const avgQuality = docs.length ? totalQuality / docs.length : 0;
    return {
      docCount: docs.length,
      duplicateRate: docs.length ? duplicates / docs.length : 0,
      staleCount: stale,
      contradictionCount: contradictions,
      averageQuality: avgQuality,
      reviewRecommended: review,
      archivedCount: archived,
      promotedCount: promoted,
      protectedCount,
      retrievalAccuracy: 0,
    };
  }

  async runQualityPass() {
    const docs = this.embeddingManager ? this.embeddingManager.list() : [];
    const now = Date.now();
    const result = { promoted: 0, archived: 0, review: 0, protected: 0 };
    for (const d of docs) {
      const score = this._qualityScore(d, now);
      d.meta.qualityScore = score;
      const isProtected = d.meta?.verified === true && d.meta?.tier === TIERS.EXECUTIVE;
      if (isProtected) {
        d.meta.protected = true;
        result.protected++;
      } else if (score >= 0.8 && d.meta?.tier !== TIERS.EXECUTIVE) {
        d.meta.tier = TIERS.EXECUTIVE;
        d.meta.reviewRecommended = false;
        result.promoted++;
      } else if (score < 0.25 && d.meta?.tier !== TIERS.LONG_TERM) {
        d.meta.tier = TIERS.LONG_TERM;
        d.meta.reviewRecommended = true;
        result.archived++;
        result.review++;
      } else if (score < 0.5) {
        d.meta.reviewRecommended = true;
        result.review++;
      } else {
        d.meta.reviewRecommended = false;
      }
    }
    if (this.embeddingManager && typeof this.embeddingManager.persist === 'function') {
      await this.embeddingManager.persist();
    }
    return result;
  }

  recommendReview(limit = 10) {
    const docs = this.embeddingManager ? this.embeddingManager.list() : [];
    return docs.filter((d) => d.meta?.reviewRecommended).slice(0, limit);
  }

  protectStrategic(textFragment) {
    const docs = this.embeddingManager ? this.embeddingManager.list() : [];
    let count = 0;
    const fragment = String(textFragment || '').toLowerCase();
    for (const d of docs) {
      const text = String(d.text || '').toLowerCase();
      if (text.includes(fragment) || fragment.includes(text)) {
        d.meta.protected = true;
        d.meta.tier = TIERS.EXECUTIVE;
        count++;
      }
    }
    return count;
  }
}

SemanticMemoryIndex.TIERS = TIERS;
module.exports = SemanticMemoryIndex;
