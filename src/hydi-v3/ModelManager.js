'use strict';

const ModelConfiguration = require('./ModelConfiguration');
const ModelRegistry = require('./ModelRegistry');
const ModelHealth = require('./ModelHealth');
const ModelMetrics = require('./ModelMetrics');
const OllamaAdapter = require('./OllamaAdapter');
const LMStudioAdapter = require('./LMStudioAdapter');
const LlamaCppAdapter = require('./LlamaCppAdapter');

const ADAPTER_CLASSES = {
  ollama: OllamaAdapter,
  lmstudio: LMStudioAdapter,
  llamacpp: LlamaCppAdapter,
};

class ModelManager {
  constructor(config = {}) {
    this.config = new ModelConfiguration(config);
    this.registry = new ModelRegistry();
    this.health = new ModelHealth();
    this.metrics = new ModelMetrics();
    this.adapters = new Map();
    this.startupReport = null;
    this.logger = config.logger || console;
  }

  async start() {
    const discovery = this.config.get('discovery');
    const report = { providers: [], models: [] };

    const customAdapters = this.config.get('adapters') || [];
    for (const adapter of customAdapters) {
      const name = adapter.name || 'custom';
      this.adapters.set(name, adapter);
      const h = await adapter.health();
      const models = h.ok ? await adapter.listModels() : [];
      for (const m of models) {
        this.registry.register(m.id || m.name, { ...m, provider: name, baseUrl: adapter.baseUrl, capabilities: (m.capabilities && m.capabilities.length) ? m.capabilities : this._inferCapabilities(m.id || m.name || ''), healthy: h.ok });
        report.models.push({ ...m, provider: name });
      }
      report.providers.push({ provider: name, healthy: h.ok, ...h });
    }

    for (const [providerName, cfg] of Object.entries(discovery)) {
      if (!cfg.enabled) continue;
      const Adapter = ADAPTER_CLASSES[providerName];
      if (!Adapter) continue;
      const adapter = new Adapter({ baseUrl: cfg.baseUrl, timeoutMs: cfg.timeoutMs });
      this.adapters.set(providerName, adapter);
      const h = await adapter.health();
      if (h.ok) {
        const models = await adapter.listModels();
        for (const m of models) {
          const record = {
            ...m,
            provider: providerName,
            baseUrl: cfg.baseUrl,
            capabilities: (m.capabilities && m.capabilities.length) ? m.capabilities : this._inferCapabilities(m.id || m.name || ''),
            healthy: true,
          };
          this.registry.register(m.id || m.name, record);
          report.models.push(record);
        }
      }
      this.health.record(providerName, h);
      report.providers.push({ provider: providerName, healthy: h.ok, ...h });
    }
    this.startupReport = report;
    return report;
  }

  _inferCapabilities(name) {
    const n = name.toLowerCase();
    const caps = ['chat'];
    if (n.includes('vision') || n.includes('llava')) caps.push('vision');
    if (n.includes('embed') || n.includes('nomic') || n.includes('gte')) caps.push('embed');
    if (n.includes('coder') || n.includes('code')) caps.push('code');
    if (n.includes('reason') || n.includes('deepseek')) caps.push('reasoning');
    if (n.includes('summarize') || n.includes('long')) caps.push('long-context');
    return caps;
  }

  getAdapter(provider) {
    return this.adapters.get(provider) || null;
  }

  async chat(messages, options = {}) {
    const model = options.model || this.registry.first({ capability: 'chat' })?.id;
    if (!model) return { ok: false, error: 'No chat-capable local model found' };
    const record = this.registry.get(model);
    const adapter = this.adapters.get(record.provider);
    if (!adapter) return { ok: false, error: 'Adapter not found' };
    const start = Date.now();
    const result = await adapter.chat(messages, { ...options, model });
    this.metrics.record(model, 'chat', Date.now() - start, result.ok);
    this.health.record(model, { ok: result.ok, status: result.ok ? 'ok' : 'error' });
    return result;
  }

  async complete(prompt, options = {}) {
    return this.chat([{ role: 'user', content: prompt }], options);
  }

  async embed(text, options = {}) {
    const model = options.model || this.registry.first({ capability: 'embed' })?.id;
    if (!model) return { ok: false, error: 'No embedding-capable local model found' };
    const record = this.registry.get(model);
    const adapter = this.adapters.get(record.provider);
    if (!adapter) return { ok: false, error: 'Adapter not found' };
    const start = Date.now();
    const result = await adapter.embed(text, { ...options, model });
    this.metrics.record(model, 'embed', Date.now() - start, result.ok);
    return result;
  }

  async vision(imageInput, prompt, options = {}) {
    const model = options.model || this.registry.first({ capability: 'vision' })?.id;
    if (!model) return { ok: false, error: 'No vision-capable local model found' };
    const record = this.registry.get(model);
    const adapter = this.adapters.get(record.provider);
    if (!adapter) return { ok: false, error: 'Adapter not found' };
    const start = Date.now();
    const result = await adapter.vision(imageInput, prompt, { ...options, model });
    this.metrics.record(model, 'vision', Date.now() - start, result.ok);
    return result;
  }

  healthCheck() {
    return this.health.summary();
  }
}

module.exports = ModelManager;
