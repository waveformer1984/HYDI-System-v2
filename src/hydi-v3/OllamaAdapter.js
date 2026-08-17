'use strict';

const { Ollama } = require('ollama');

/**
 * OllamaAdapter integrates the local Ollama runtime into the HYDI compute pool.
 *
 * It provides availability checks, model discovery, memory estimation, and
 * inference execution. It is the first concrete LocalComputeRuntime adapter.
 */
class OllamaAdapter {
  constructor(config = {}) {
    this.config = {
      host: config.host || process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
      timeoutMs: config.timeoutMs || 30000,
      ...config,
    };
    this.name = 'ollama';
    this.client = new Ollama({ host: this.config.host });
    this.lastError = null;
  }

  /**
   * Check whether the Ollama daemon is reachable and has at least one model.
   */
  async isAvailable() {
    try {
      const result = await this.withTimeout(this.client.list());
      const models = result?.models || [];
      return models.length > 0;
    } catch (err) {
      this.lastError = err.message;
      return false;
    }
  }

  /**
   * List installed models with metadata.
   */
  async getModels() {
    try {
      const result = await this.withTimeout(this.client.list());
      const models = result?.models || [];
      return models.map((m) => ({
        name: m.name || m.model,
        sizeBytes: m.size || 0,
        parameterCount: m.details?.parameter_size || this.inferParameterCount(m.name),
        family: m.details?.family,
        format: m.details?.format,
        quantization: m.details?.quantization_level,
        vramEstimateBytes: this.estimateMemory(m.name, m.details?.quantization_level, m.size),
      }));
    } catch (err) {
      this.lastError = err.message;
      return [];
    }
  }

  /**
   * Estimate VRAM bytes for a model name + quantization.
   *
   * This is a heuristic used until Ollama exposes exact per-model memory data.
   * It is intentionally conservative (adds 25% activation overhead).
   */
  estimateMemory(modelName, quantization, knownSizeBytes = 0) {
    if (knownSizeBytes > 0) {
      return Math.round(knownSizeBytes * 1.25);
    }
    const params = this.inferParameterCount(modelName);
    const q = String(quantization || '').toLowerCase();
    const bitsPerWeight = q.includes('q8') ? 8 : q.includes('q6') ? 6 : q.includes('q5') ? 5 : q.includes('q4') ? 4 : q.includes('q3') ? 3 : q.includes('q2') ? 2 : 4;
    const contextOverheadBytes = 512 * 1024 * 1024; // reserve 512MB for KV cache
    const bytes = params * bitsPerWeight / 8;
    return Math.max(1, Math.round(bytes * 1.25 + contextOverheadBytes));
  }

  /**
   * Run a single inference against Ollama.
   *
   * Supports either a raw `prompt` (generate) or a `messages` array (chat).
   * Returns the full text response unless `stream` is true, in which case
   * it yields chunks.
   */
  async runInference({ model, prompt, messages, options = {}, stream = false }) {
    if (!model) throw new Error('model is required');
    if (messages && messages.length > 0) {
      const response = await this.withTimeout(
        this.client.chat({
          model,
          messages,
          stream,
          options: this.cleanOptions(options),
        })
      );
      return stream ? response : response.message?.content || '';
    }

    const response = await this.withTimeout(
      this.client.generate({
        model,
        prompt: prompt || '',
        stream,
        options: this.cleanOptions(options),
      })
    );
    return stream ? response : response.response || '';
  }

  /**
   * Adapter health status.
   */
  async health() {
    const available = await this.isAvailable();
    return {
      name: this.name,
      available,
      lastError: this.lastError,
      host: this.config.host,
    };
  }

  /**
   * Extract a parameter count from a model name.
   */
  inferParameterCount(name) {
    const match = (name || '').match(/(\d+(?:\.\d+)?)\s*[bB]/);
    if (!match) return 3;
    return Number(match[1]);
  }

  cleanOptions(options) {
    const cleaned = { ...options };
    ['temperature', 'top_p', 'top_k', 'num_predict', 'num_ctx'].forEach((key) => {
      if (cleaned[key] !== undefined) cleaned[key] = Number(cleaned[key]);
    });
    return cleaned;
  }

  async withTimeout(promise) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Ollama request timed out')), this.config.timeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = OllamaAdapter;
