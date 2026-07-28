'use strict';

const fs = require('fs').promises;
const path = require('path');

function dot(a, b) {
  return a.reduce((sum, v, i) => sum + v * (b[i] || 0), 0);
}
function norm(a) {
  return Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
}
function cosineSimilarity(a, b) {
  const n = norm(a) * norm(b);
  return n === 0 ? 0 : dot(a, b) / n;
}

class EmbeddingManager {
  constructor(config = {}) {
    this.modelManager = config.modelManager || null;
    this.dataPath = config.dataPath || path.resolve(__dirname, '../../data');
    this.storePath = path.join(this.dataPath, config.storeFile || 'embeddings.json');
    this.documents = [];
    this._started = false;
  }

  async start() {
    try {
      const raw = await fs.readFile(this.storePath, 'utf8');
      const data = JSON.parse(raw);
      this.documents = Array.isArray(data) ? data : [];
    } catch (e) {
      this.documents = [];
    }
    this._started = true;
    return this;
  }

  async persist() {
    await fs.mkdir(this.dataPath, { recursive: true });
    await fs.writeFile(this.storePath, JSON.stringify(this.documents, null, 2), 'utf8');
  }

  async addDocument(text, meta = {}) {
    if (!this.modelManager) return null;
    const result = await this.modelManager.embed(text);
    if (!result.ok || !result.vector || !result.vector.length) return null;
    const doc = { id: meta.id || `doc_${Date.now()}_${Math.random().toString(36).slice(2)}`, text, vector: result.vector, meta, at: Date.now() };
    this.documents.push(doc);
    await this.persist();
    return doc;
  }

  async search(queryText, limit = 5) {
    if (!this.modelManager) return [];
    const result = await this.modelManager.embed(queryText);
    if (!result.ok || !result.vector || !result.vector.length) return [];
    const q = result.vector;
    return this.documents
      .map((d) => ({ ...d, score: cosineSimilarity(q, d.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async searchSimilarToDocument(text, limit = 5) {
    return this.search(text, limit);
  }

  similarProjects(projectName) {
    return this.search(projectName, 5);
  }

  similarFailures(context) {
    return this.search(context, 5);
  }

  async ingestFromMemory(memory, limit = 100) {
    if (!memory || typeof memory.find !== 'function') return 0;
    const items = memory.find({ limit }).slice(0, limit);
    let added = 0;
    for (const item of items) {
      const text = typeof item === 'string' ? item : JSON.stringify(item);
      const existing = this.documents.some((d) => d.meta && d.meta.sourceId === item.id);
      if (existing) continue;
      const ok = await this.addDocument(text, { sourceId: item.id, type: item.type || 'memory' });
      if (ok) added++;
    }
    return added;
  }

  list() {
    return this.documents.slice();
  }
}

module.exports = EmbeddingManager;
