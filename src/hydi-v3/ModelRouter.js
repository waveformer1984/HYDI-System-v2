'use strict';

const { TASK_TO_CAPABILITIES } = require('./ModelCapabilities');
const { INTENT_EXTRACTION_PROMPT, RAG_CONTEXT_PROMPT, PLANNING_PROMPT, CODE_REVIEW_PROMPT } = require('./PromptLibrary');
const CapabilityProfile = require('./CapabilityProfile');

class ModelRouter {
  constructor(modelManager, modelRuntimeManager, config = {}) {
    this.modelManager = modelManager || null;
    this.runtime = modelRuntimeManager || null;
    this.logger = config.logger || console;
    this.log = [];
  }

  _log(decision) {
    this.log.push({ at: Date.now(), ...decision });
    this.logger.log('[ModelRouter]', decision);
  }

  _profile(modelId) {
    const record = this.modelManager.registry.get(modelId) || {};
    const metrics = this.runtime ? this.runtime.getMetrics(modelId) : { calls: 0 };
    return new CapabilityProfile(record, metrics);
  }

  _selectModel(task, latencySensitive = false) {
    if (!this.modelManager) return null;
    const capabilities = TASK_TO_CAPABILITIES[task] || [TASK_TO_CAPABILITIES.conversation];
    let best = null;
    let bestScore = -Infinity;
    for (const cap of capabilities) {
      const candidates = this.modelManager.registry.find({ capability: cap, healthy: true });
      for (const c of candidates) {
        const profile = this._profile(c.id);
        const score = profile.score(task, { latencySensitive });
        if (score > bestScore) {
          bestScore = score;
          best = { model: c.id, capability: cap, score };
        }
      }
    }
    return best;
  }

  async _run(modelId, operation, fn) {
    if (this.runtime) {
      const result = await this.runtime.request(modelId, operation, fn);
      if (!result.ok) return { ok: false, error: result.error };
      return { ok: true, latency: result.latency, text: result.result.text || result.result, usedModel: modelId };
    }
    const start = Date.now();
    const r = await fn();
    return { ok: r.ok !== false, latency: Date.now() - start, text: r.text || r, usedModel: modelId };
  }

  async extractIntent(text) {
    const selection = this._selectModel('intentExtraction', true);
    if (!selection) return { usedModel: null, intent: null, error: 'No chat model available' };
    const messages = [
      { role: 'system', content: INTENT_EXTRACTION_PROMPT },
      { role: 'user', content: text },
    ];
    const start = Date.now();
    const result = await this._run(selection.model, 'intentExtraction', () => this.modelManager.chat(messages, { model: selection.model }));
    this._log({ task: 'intentExtraction', model: selection.model, latency: Date.now() - start, ok: result.ok });
    if (!result.ok || !result.text) return { usedModel: selection.model, intent: null, error: result.error };
    try {
      const parsed = JSON.parse(result.text.trim());
      return { usedModel: selection.model, intent: parsed.intent || 'unknown', args: parsed.args || { text } };
    } catch (e) {
      return { usedModel: selection.model, intent: null, error: 'Failed to parse intent JSON' };
    }
  }

  async ragAnswer(question, contextBlocks) {
    const selection = this._selectModel('conversation');
    if (!selection) return { usedModel: null, text: 'No chat model available.' };
    const context = contextBlocks.map((b, i) => `--- Block ${i + 1} ---\n${b}`).join('\n\n');
    const prompt = RAG_CONTEXT_PROMPT.replace('{{context}}', context).replace('{{question}}', question);
    const result = await this._run(selection.model, 'rag', () => this.modelManager.complete(prompt, { model: selection.model }));
    this._log({ task: 'rag', model: selection.model, latency: result.latency, ok: result.ok });
    return { usedModel: selection.model, text: result.ok ? result.text : `Local model error: ${result.error}` };
  }

  async summarize(text, type = 'document') {
    const selection = this._selectModel('summarization');
    if (!selection) return { usedModel: null, text: 'No summarization model available.' };
    const prompt = `Summarize the following ${type}. Be concise and preserve actionable items:\n\n${text}`;
    const result = await this._run(selection.model, 'summarize', () => this.modelManager.complete(prompt, { model: selection.model }));
    this._log({ task: 'summarize', model: selection.model, latency: result.latency, ok: result.ok });
    return { usedModel: selection.model, text: result.ok ? result.text : `Local model error: ${result.error}` };
  }

  async plan(request) {
    const selection = this._selectModel('planning');
    if (!selection) return { usedModel: null, text: 'No planning model available.' };
    const prompt = `${PLANNING_PROMPT}\n\nRequest: ${request}`;
    const result = await this._run(selection.model, 'plan', () => this.modelManager.complete(prompt, { model: selection.model }));
    this._log({ task: 'plan', model: selection.model, latency: result.latency, ok: result.ok });
    return { usedModel: selection.model, text: result.ok ? result.text : `Local model error: ${result.error}` };
  }

  async codeReview(codeOrFiles) {
    const selection = this._selectModel('codeReview');
    if (!selection) return { usedModel: null, text: 'No code model available.' };
    const prompt = `${CODE_REVIEW_PROMPT}\n\nInput:\n${codeOrFiles}`;
    const result = await this._run(selection.model, 'codeReview', () => this.modelManager.complete(prompt, { model: selection.model }));
    this._log({ task: 'codeReview', model: selection.model, latency: result.latency, ok: result.ok });
    return { usedModel: selection.model, text: result.ok ? result.text : `Local model error: ${result.error}` };
  }

  async embed(text) {
    const selection = this._selectModel('embedding');
    if (!selection) return { usedModel: null, ok: false, error: 'No embedding model available.' };
    const result = await this._run(selection.model, 'embed', () => this.modelManager.embed(text, { model: selection.model }));
    this._log({ task: 'embed', model: selection.model, latency: result.latency, ok: result.ok });
    if (!result.ok) return { usedModel: selection.model, ok: false, error: result.error };
    return { usedModel: selection.model, ok: true, vector: result.result.vector };
  }

  recentLog(limit = 50) {
    return this.log.slice(-limit);
  }
}

module.exports = ModelRouter;
