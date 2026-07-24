'use strict';

const { EventEmitter } = require('events');

/**
 * IntelligenceBus routes inference requests to the best available model adapter.
 *
 * Adapters must expose: name, health(), getModels(), generate(model, prompt, options),
 * chat(model, messages, options), and optionally estimateMemory().
 */
class IntelligenceBus extends EventEmitter {
  constructor(kernel, options = {}) {
    super();
    this.kernel = kernel;
    this.config = {
      defaultCapability: options.defaultCapability || 'chat',
      ...options,
    };
    this.adapters = new Map();
    this.modelCache = new Map();
  }

  registerAdapter(adapter) {
    if (!adapter.name) throw new Error('adapter.name is required');
    if (typeof adapter.health !== 'function') throw new Error('adapter.health is required');
    this.adapters.set(adapter.name, adapter);
    this.emit('adapter_registered', { name: adapter.name });
    return adapter.name;
  }

  unregisterAdapter(name) {
    return this.adapters.delete(name);
  }

  async selectAdapter(request = {}) {
    const candidates = [];
    for (const [name, adapter] of this.adapters) {
      const health = await adapter.health().catch(() => ({ available: false }));
      if (!health.available) continue;
      const cost = request.costWeight ? (adapter.cost || 0) : 0;
      const latency = health.latencyMs || adapter.latencyMs || 1000;
      const privacy = request.privacy && adapter.local ? 1000 : 0;
      const score = health.available ? 1000 : 0;
      candidates.push({
        name,
        adapter,
        score: score - cost - latency + privacy + (adapter.priority || 0),
      });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.adapter || null;
  }

  async generate(request) {
    const adapter = await this.selectAdapter(request);
    if (!adapter) throw new Error('no intelligence adapter available');
    const model = request.model || (await this._defaultModel(adapter));
    return adapter.generate(model, request.prompt, request.options || {});
  }

  async chat(request) {
    const adapter = await this.selectAdapter(request);
    if (!adapter) throw new Error('no intelligence adapter available');
    const model = request.model || (await this._defaultModel(adapter));
    return adapter.chat(model, request.messages, request.options || {});
  }

  async route(request) {
    if (request.messages && request.messages.length > 0) return this.chat(request);
    return this.generate(request);
  }

  async _defaultModel(adapter) {
    const cached = this.modelCache.get(adapter.name);
    if (cached) return cached;
    const models = await adapter.getModels().catch(() => []);
    const model = models[0]?.name;
    if (model) this.modelCache.set(adapter.name, model);
    return model;
  }

  async getStatus() {
    const status = {};
    for (const [name, adapter] of this.adapters) {
      status[name] = await adapter.health().catch(() => ({ available: false }));
    }
    return status;
  }
}

module.exports = IntelligenceBus;
