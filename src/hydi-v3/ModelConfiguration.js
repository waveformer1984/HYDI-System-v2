'use strict';

const DEFAULTS = {
  // Discovery
  discovery: {
    // Keys match ADAPTER_CLASSES in ModelManager.js and each adapter's own
    // `.name` property (lowercase, e.g. LMStudioAdapter.name === 'lmstudio').
    // A prior camelCase/lowercase mismatch here silently dropped lmStudio and
    // llamaCpp from discovery entirely -- ADAPTER_CLASSES[providerName]
    // resolved to undefined and the provider was skipped with no warning.
    ollama: { enabled: true, baseUrl: 'http://localhost:11434', timeoutMs: 2000 },
    lmstudio: { enabled: true, baseUrl: 'http://localhost:1234', timeoutMs: 2000 },
    llamacpp: { enabled: true, baseUrl: 'http://localhost:8080', timeoutMs: 2000 },
    vllm: { enabled: false, baseUrl: 'http://localhost:8000', timeoutMs: 2000 },
  },
  // Router defaults
  routing: {
    defaultTemperature: 0.3,
    maxTokens: 1024,
    timeoutMs: 10000,
    fallbackToDeterministic: true,
  },
  // Embedding
  embedding: {
    defaultModel: null, // auto-selected
    dimensions: 768,
    storageFile: 'embeddings.json',
  },
  // Privacy
  privacy: {
    localOnly: false,
    allowCloudFallback: false,
    logPrompts: false,
  },
};

/**
 * ModelConfiguration holds the local-AI layer settings.
 * It does not contain business logic; it only centralizes defaults and
 * user-supplied overrides so every orchestration component reads from one place.
 */
class ModelConfiguration {
  constructor(config = {}) {
    this.config = this._merge(DEFAULTS, config);
    this.config.privacy.localOnly = this.config.privacy.localOnly === true;
  }

  _merge(base, override) {
    const out = JSON.parse(JSON.stringify(base));
    for (const key of Object.keys(override || {})) {
      if (typeof override[key] === 'object' && override[key] !== null && !Array.isArray(override[key])) {
        out[key] = { ...out[key], ...override[key] };
      } else {
        out[key] = override[key];
      }
    }
    return out;
  }

  get(path) {
    return path.split('.').reduce((obj, key) => (obj ? obj[key] : undefined), this.config);
  }

  set(path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    const parent = keys.reduce((obj, key) => {
      if (!obj[key]) obj[key] = {};
      return obj[key];
    }, this.config);
    parent[last] = value;
  }

  all() {
    return JSON.parse(JSON.stringify(this.config));
  }
}

module.exports = ModelConfiguration;
