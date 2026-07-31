'use strict';

const BaseAdapter = require('./BaseAdapter');

class LMStudioAdapter extends BaseAdapter {
  constructor(config = {}) {
    super(config);
    this.name = 'lmstudio';
    this.defaultModel = config.defaultModel || 'local-model';
  }

  async health() {
    const res = await this.get('/v1/models');
    if (res.ok && Array.isArray(res.body.data)) {
      return { ok: true, status: 'ok', models: res.body.data.map((m) => m.id) };
    }
    return { ok: false, status: 'unreachable', error: res.error || 'invalid response' };
  }

  async listModels() {
    const res = await this.get('/v1/models');
    if (!res.ok) return [];
    return (res.body.data || []).map((m) => ({
      id: m.id,
      name: m.id,
      provider: 'lmstudio',
      object: m.object,
    }));
  }

  _payload(messages, options) {
    const model = options.model || this.defaultModel;
    return {
      model,
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 1024,
    };
  }

  async chat(messages, options = {}) {
    const res = await this.post('/v1/chat/completions', this._payload(messages, options));
    if (!res.ok) return { ok: false, error: res.error || res.body?.error?.message, text: null };
    return { ok: true, text: res.body.choices?.[0]?.message?.content || '' };
  }

  async complete(prompt, options = {}) {
    return this.chat([{ role: 'user', content: prompt }], options);
  }

  async embed(text, options = {}) {
    const model = options.model || this.defaultModel;
    const res = await this.post('/v1/embeddings', { model, input: text });
    if (!res.ok) return { ok: false, error: res.error || res.body?.error?.message, vector: null };
    const data = res.body.data?.[0];
    return { ok: true, vector: (data && data.embedding) || [] };
  }

  async vision(imageInput, prompt = '') { // eslint-disable-line no-unused-vars
    return { ok: false, error: 'Vision not configured for this adapter' };
  }
}

module.exports = LMStudioAdapter;
