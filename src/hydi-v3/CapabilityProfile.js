'use strict';

const { CAPABILITIES } = require('./ModelCapabilities');

/**
 * CapabilityProfile describes a model's practical abilities for routing.
 * It is computed from the registry record and runtime metrics.
 */
class CapabilityProfile {
  constructor(record = {}, metrics = {}) {
    this.id = record.id || 'unknown';
    this.provider = record.provider || 'unknown';
    this.capabilities = new Set(record.capabilities || []);
    this.contextSize = record.contextSize || record.context_window || 4096;
    this.speedRating = record.speedRating || 1;
    this.hardware = record.hardware || 'cpu';
    this.reliability = this._reliability(metrics);
    this.avgLatency = metrics.lastLatency || 0;
    this.busy = record.busy || false;
  }

  _reliability(metrics) {
    if (!metrics.calls) return 0.5;
    return 1 - (metrics.errors / metrics.calls);
  }

  supports(cap) {
    return this.capabilities.has(cap);
  }

  score(task, opts = {}) {
    let s = this.reliability * 100;
    if (this.supports(CAPABILITIES.CHAT) && task === 'conversation') s += 100;
    if (this.supports(CAPABILITIES.REASONING) && (task === 'planning' || task === 'rag')) s += 30;
    if (this.supports(CAPABILITIES.CODE) && task === 'codeReview') s += 40;
    if (this.supports(CAPABILITIES.LONG_CONTEXT) && task === 'summarization') s += 20;
    if (this.supports(CAPABILITIES.EMBED) && task === 'embedding') s += 100;
    if (this.supports(CAPABILITIES.VISION) && task === 'vision') s += 100;
    if (opts.latencySensitive && this.avgLatency) s -= this.avgLatency / 100;
    if (this.busy) s -= 50;
    return s;
  }
}

module.exports = CapabilityProfile;
