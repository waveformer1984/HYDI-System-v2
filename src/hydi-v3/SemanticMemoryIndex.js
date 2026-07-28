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
    this.decayRate = config.decayRate || 0.01; // importance per day
    this.duplicateThreshold = config.duplicateThreshold || 0.95;
  }

  async remember(text, meta = {}) {
    if (!this.embeddingManager) return null;
    const tier = TIERS[meta.tier] ? meta.tier : TIERS.WORKING;
    const importance = meta.importance ?? 1;
    const existing = await this._findDuplicate(text);
    if (existing) {
      existing.meta.importance = Math.min((existing.meta.importance || 1) + 0.5, 5);
      await this.embeddingManager.persist();
      return existing;
    }
    return this.embeddingManager.addDocument(text, { ...meta, tier, importance, createdAt: Date.now() });
  }

  async recall(query, opts = {}) {
    if (!this.embeddingManager) return [];
    const docs = this.embeddingManager.list();
    const qvResult = await this.embeddingManager.modelManager.embed(query);
    if (!qvResult.ok || !qvResult.vector) return [];
    const qv = qvResult.vector;
    const tierOrder = { SHORT_TERM: 4, WORKING: 3, LONG_TERM: 2, EXECUTIVE: 1 };
    return docs
      .map((d) => {
        const ageDays = (Date.now() - (d.meta?.createdAt || d.at || Date.now())) / 86400000;
        const decay = Math.max(0, 1 - this.decayRate * ageDays);
        const importance = d.meta?.importance || 1;
        return {
          ...d,
          score: (cosineSimilarity(qv, d.vector) * importance * decay) + (tierOrder[d.meta?.tier] || 0) * 0.05,
        };
      })
      .filter((d) => d.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.limit || 10);
  }

  async similarProjects(name, limit = 5) {
    return this.recall(`project ${name}`, { limit });
  }

  async similarFailures(context, limit = 5) {
    return this.recall(`failure ${context}`, { limit });
  }

  async workingMemories(limit = 10) {
    return this._byTier(TIERS.WORKING, limit);
  }

  async executiveMemories(limit = 10) {
    return this._byTier(TIERS.EXECUTIVE, limit);
  }

  async _byTier(tier, limit) {
    const docs = this.embeddingManager.list().filter((d) => d.meta?.tier === tier);
    return docs
      .map((d) => {
        const ageDays = (Date.now() - (d.meta?.createdAt || d.at || Date.now())) / 86400000;
        const decay = Math.max(0, 1 - this.decayRate * ageDays);
        return { ...d, score: (d.meta?.importance || 1) * decay };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
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
      const ok = await this.remember(text, { sourceId: item.id, type: item.type || 'business-memory', tier: TIERS.LONG_TERM, importance: item.importance || 1 });
      if (ok) added++;
    }
    return added;
  }
}

SemanticMemoryIndex.TIERS = TIERS;
module.exports = SemanticMemoryIndex;
