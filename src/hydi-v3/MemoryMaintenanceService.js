'use strict';

class MemoryMaintenanceService {
  constructor(config = {}) {
    this.semanticMemory = config.semanticMemory || null;
    this.embeddingManager = config.embeddingManager || null;
    this.logger = config.logger || console;
    this.decayRate = config.decayRate || 0.01;
    this.stalenessDays = config.stalenessDays || 90;
    this.minImportance = config.minImportance || 0.2;
  }

  async run() {
    if (!this.embeddingManager) return { removed: 0, duplicates: 0, conflicts: 0 };
    const docs = this.embeddingManager.list();
    const now = Date.now();
    let removed = 0;
    let duplicates = 0;

    const toRemove = [];
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i];
      const ageDays = (now - (d.meta?.createdAt || d.at || now)) / 86400000;
      const decay = Math.max(0, 1 - this.decayRate * ageDays);
      const importance = d.meta?.importance || 1;
      const confidence = d.meta?.confidence || 0.5;
      const effective = importance * confidence * decay;

      if (effective < this.minImportance || ageDays > this.stalenessDays) {
        toRemove.push(i);
      }
    }

    toRemove.reverse().forEach((idx) => { docs.splice(idx, 1); removed++; });
    await this.embeddingManager.replaceDocuments(docs);

    if (this.semanticMemory) {
      const conflicts = this.semanticMemory.detectContradictions();
      return { removed, duplicates, conflicts: conflicts.length, conflictDetails: conflicts };
    }

    await this.embeddingManager.persist();
    return { removed, duplicates, conflicts: 0 };
  }

  async removeDuplicates() {
    if (!this.embeddingManager) return 0;
    const docs = this.embeddingManager.list();
    let duplicates = 0;
    const keep = [];
    const seen = new Set();
    for (const d of docs) {
      const key = (d.text || '').trim().toLowerCase().slice(0, 120);
      if (seen.has(key)) {
        duplicates++;
      } else {
        seen.add(key);
        keep.push(d);
      }
    }
    await this.embeddingManager.replaceDocuments(keep);
    return duplicates;
  }
}

module.exports = MemoryMaintenanceService;
