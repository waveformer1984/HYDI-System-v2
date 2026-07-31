'use strict';

const BaseAdapter = require('./BaseAdapter');

class OllamaAdapter extends BaseAdapter {
  constructor(config = {}) {
    super(config);
    this.name = 'ollama';
    this.defaultModel = config.defaultModel || 'llama3';
  }

  async health() {
    const res = await this.get('/api/tags');
    if (res.ok && Array.isArray(res.body.models)) {
      return { ok: true, status: 'ok', models: res.body.models.map((m) => m.name || m.model) };
    }
    return { ok: false, status: 'unreachable', error: res.error || 'invalid response' };
  }

  async listModels() {
    const res = await this.get('/api/tags');
    if (!res.ok) return [];
    return (res.body.models || []).map((m) => ({
      id: m.name || m.model,
      name: m.name || m.model,
      provider: 'ollama',
      size: m.size,
      details: m.details || {},
    }));
  }

  async chat(messages, options = {}) {
    const model = options.model || this.defaultModel;
    const res = await this.post('/api/chat', {
      model,
      messages,
      stream: false,
      options: { temperature: options.temperature ?? 0.3, num_predict: options.maxTokens ?? 1024 },
    });
    if (!res.ok) return { ok: false, error: res.error || res.body?.error, text: null };
    return { ok: true, text: res.body.message?.content || '' };
  }

  async complete(prompt, options = {}) {
    const model = options.model || this.defaultModel;
    const res = await this.post('/api/generate', {
      model,
      prompt,
      stream: false,
      options: { temperature: options.temperature ?? 0.3, num_predict: options.maxTokens ?? 1024 },
    });
    if (!res.ok) return { ok: false, error: res.error || res.body?.error, text: null };
    return { ok: true, text: res.body.response || '' };
  }

  async embed(text, options = {}) {
    const model = options.model || this.defaultModel;
    const res = await this.post('/api/embeddings', { model, prompt: text });
    if (!res.ok) return { ok: false, error: res.error || res.body?.error, vector: null };
    return { ok: true, vector: res.body.embedding || [] };
  }

  async vision(imageInput, prompt = '') { // eslint-disable-line no-unused-vars
    // Ollama vision is supported via /api/chat with image content; placeholder.
    return { ok: false, error: 'Vision not configured for this adapter' };
  }
}

module.exports = OllamaAdapter;
