'use strict';

const { EventEmitter } = require('events');

/**
 * StrategicMemory stores long-term planning artifacts: completed missions,
 * lessons, risks, and reusable strategies. It integrates with the existing
 * memory layer by emitting memory events.
 */
class StrategicMemory extends EventEmitter {
  constructor(config = {}) {
    super();
    this.memoryClient = config.memoryClient || null;
    this.lifecycleRegistry = config.lifecycleRegistry || null;
    this.logger = config.logger || console;
    this.store = new Map();
    this._clock = 0;
  }

  remember(kind, payload) {
    this._clock += 1;
    const record = {
      id: `sm-${Date.now()}-${this._clock}`,
      kind,
      payload,
      createdAt: Date.now(),
    };
    this.store.set(record.id, record);
    if (this.memoryClient && typeof this.memoryClient.store === 'function') {
      this.memoryClient.store({ kind: `strategic_${kind}`, content: payload });
    }
    this._audit('remembered', record);
    this.emit('remembered', record);
    return { success: true, record };
  }

  recall(kind, options = {}) {
    let results = Array.from(this.store.values());
    if (kind) results = results.filter((r) => r.kind === kind);
    if (options.tags) {
      results = results.filter((r) => options.tags.every((t) => (r.payload.tags || []).includes(t)));
    }
    if (options.limit) results = results.slice(-options.limit);
    return results;
  }

  findSimilar(tags, limit = 5) {
    const scored = this.recall(null, {})
      .map((r) => ({
        record: r,
        score: (r.payload.tags || []).filter((t) => tags.includes(t)).length,
      }))
      .filter((s) => s.score > 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.record);
  }

  _audit(action, record) {
    const entry = {
      at: Date.now(),
      action,
      memoryId: record.id,
      kind: record.kind,
    };
    if (this.lifecycleRegistry) this.lifecycleRegistry.recordProposal(entry);
    this.emit('audit', entry);
  }
}

module.exports = StrategicMemory;
