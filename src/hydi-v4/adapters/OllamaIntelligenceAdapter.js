'use strict';

const V3OllamaAdapter = require('../../hydi-v3/OllamaAdapter');

/**
 * OllamaIntelligenceAdapter wraps the V3 OllamaAdapter for the V4 IntelligenceBus.
 */
class OllamaIntelligenceAdapter {
  constructor(options = {}) {
    this.name = options.name || 'ollama';
    this.priority = options.priority || 100;
    this.local = true;
    this.cost = 0;
    this.client = new V3OllamaAdapter(options.config || {});
  }

  async health() {
    const available = await this.client.isAvailable();
    return {
      available,
      lastError: this.client.lastError,
      host: this.client.config.host,
    };
  }

  async getModels() {
    return this.client.getModels();
  }

  async generate(model, prompt, options) {
    return this.client.runInference({ model, prompt, options });
  }

  async chat(model, messages, options) {
    return this.client.runInference({ model, messages, options });
  }

  estimateMemory(modelName, quantization, knownSizeBytes) {
    return this.client.estimateMemory(modelName, quantization, knownSizeBytes);
  }
}

module.exports = OllamaIntelligenceAdapter;
