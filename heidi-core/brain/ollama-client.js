/**
 * HEIDI Brain - Ollama Client
 * Simple, fast, doesn't fight you
 *
 * SINGLE-LIFECYCLE POLICY (shared with lib/ModelManager.ts):
 * This client is the model path for every protoforge-core caller
 * (LocalModelAdapter health probes, HeidiOrchestrator, reflection).
 * It MUST obey the same RAM rules as the governed chat path:
 *   - smallest-installed model that fits the free-RAM budget
 *   - fail fast with MEMORY_PRESSURED instead of a doomed load
 *   - bounded residency (keep_alive '5m', not 30m/1h)
 *   - best-effort unload after a failed call
 * Without this, periodic probes re-warm a large model right after the
 * governed manager unloads it — the RAM leak returns.
 */

const axios = require('axios');
const os = require('os');

class OllamaClient {
  constructor(config = {}) {
    this.baseURL = config.baseURL || process.env.OLLAMA_URL || 'http://localhost:11434';
    this.model = config.model || process.env.OLLAMA_MODEL || process.env.LOCAL_MODEL_NAME || null;
    this._selectionCache = { at: 0, name: null };
    // This axios instance's timeout is the ACTUAL binding constraint on every
    // generate()/chat() call - it fires (as "timeout of Nms exceeded") before
    // any outer Promise.race timeout in src/models/local-model-adapter.js or
    // lib/orchestrator.ts's ORCHESTRATOR_TIMEOUT_MS ever gets a chance to.
    // Previously hard-coded to 8000ms and keyed ONLY to OLLAMA_TIMEOUT_MS, which
    // nobody was setting - so every real call to a warm llama3.2:3b (observed
    // 8-13s on this hardware) timed out by design, independent of the
    // model-name-mismatch bug fixed separately in local-model-adapter.js.
    // Now also honors LOCAL_MODEL_TIMEOUT_MS (the env var CLAUDE.md documents
    // as governing local inference timeout generally) as a fallback, with a
    // more realistic 20s default. OLLAMA_TIMEOUT_MS still wins if set, for
    // callers that want a tighter/looser bound than the documented default.
    this.timeout = config.timeout
      || parseInt(process.env.OLLAMA_TIMEOUT_MS || process.env.LOCAL_MODEL_TIMEOUT_MS || '20000', 10);

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async isAvailable() {
    try {
      const response = await this.client.get('/api/tags', { timeout: 2000 });
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }

  async getModels() {
    try {
      const response = await this.client.get('/api/tags');
      return response.data.models?.map(m => m.name) || [];
    } catch (error) {
      console.error('[HEIDI Brain] Failed to get models:', error.message);
      return [];
    }
  }

  /**
   * Resolve which model to use. Mirrors lib/ModelManager.ts: smallest
   * installed generative model whose on-disk size * 1.5 fits in
   * (free RAM - reserve). Throws MEMORY_PRESSURED when nothing fits —
   * the truthful answer on a starved box, instead of a doomed 30s load.
   */
  async resolveModel() {
    const budget = Math.max(0, os.freemem() - 768 * 1024 * 1024);
    const now = Date.now();
    // Failure backoff: after repeated inference timeouts, report
    // MEMORY_PRESSURED for a cooldown instead of churning a doomed
    // model load every probe tick (~30s spawn/thrash/unload cycle).
    if (now < (OllamaClient._backoffUntil || 0)) {
      throw new Error(`MEMORY_PRESSURED: inference cooldown after ${OllamaClient._consecFails} consecutive failures`);
    }
    if (this._selectionCache.name && now - this._selectionCache.at < 60000) {
      return this._selectionCache.name;
    }
    const res = await this.client.get('/api/tags', { timeout: 3000 });
    const models = (res.data.models || []).filter(m => m.size > 0 && !/embed/i.test(m.name));
    const fits = m => m.size * 1.5 <= budget;
    let pick = null;
    if (this.model) {
      const req = models.find(m => m.name === this.model);
      pick = (req && fits(req)) ? req : (models.filter(fits).sort((a, b) => a.size - b.size)[0] || null);
    } else {
      pick = models.filter(fits).sort((a, b) => a.size - b.size)[0] || null;
    }
    if (!pick) {
      throw new Error(`MEMORY_PRESSURED: free RAM ${(os.freemem() / 1073741824).toFixed(1)}GB below budget for any installed model`);
    }
    this._selectionCache = { at: now, name: pick.name };
    return pick.name;
  }

  /** Best-effort unload so a failed call doesn't leak residency. */
  async unload(model) {
    try {
      await this.client.post('/api/generate',
        { model, prompt: '', keep_alive: 0, stream: false },
        { timeout: 5000 });
    } catch { }
  }

  /**
   * Stream a generation token-by-token. Calls onToken(text) for each chunk,
   * resolves with the same shape as generate() once complete.
   */
  async generateStream(prompt, onToken, options = {}) {
    this._backoffActive();
    const model = options.model || await this.resolveModel();
    const response = await fetch(`${this.baseURL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: true,
        options: {
          temperature: options.temperature || 0.7,
          num_predict: options.maxTokens || 600
        }
      }),
      signal: AbortSignal.timeout(this.timeout)
    });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const d = JSON.parse(line);
          if (d.response) { full += d.response; onToken(d.response); }
          if (d.done) {
            return {
              text: full,
              model,
              tokens: { prompt: d.prompt_eval_count || 0, completion: d.eval_count || 0 }
            };
          }
        } catch { }
      }
    }
    return { text: full, model, tokens: { prompt: 0, completion: 0 } };
  }

  // Backoff gate — shared by all entry points including explicit-model
  // calls (health probes pass their own model names and would otherwise
  // bypass resolveModel entirely).
  _backoffActive() {
    if (Date.now() < (OllamaClient._backoffUntil || 0)) {
      throw new Error(`MEMORY_PRESSURED: inference cooldown after ${OllamaClient._consecFails} consecutive failures`);
    }
  }

  async generate(prompt, options = {}) {
    const startTime = Date.now();
    this._backoffActive();
    const model = options.model || await this.resolveModel();

    try {
      const payload = {
        model,
        prompt: prompt,
        stream: false,
        keep_alive: options.keepAlive || '5m',
        options: {
          temperature: options.temperature || 0.7,
          num_predict: options.maxTokens || 1000
        }
      };

      const response = await this.client.post('/api/generate', payload);
      OllamaClient._noteSuccess();

      return {
        text: response.data.response,
        model: response.data.model,
        created_at: new Date().toISOString(),
        latency_ms: Date.now() - startTime,
        tokens: {
          prompt: response.data.prompt_eval_count || 0,
          completion: response.data.eval_count || 0
        }
      };
    } catch (error) {
      console.error('[HEIDI Brain] Generation failed:', error.message);
      OllamaClient._noteFailure();
      void this.unload(model);
      throw error;
    }
  }

  static _noteFailure() {
    OllamaClient._consecFails = (OllamaClient._consecFails || 0) + 1;
    if (OllamaClient._consecFails >= 3) {
      OllamaClient._backoffUntil = Date.now() + 5 * 60 * 1000;
    }
  }
  static _noteSuccess() {
    OllamaClient._consecFails = 0;
    OllamaClient._backoffUntil = 0;
  }

  async chat(messages, options = {}) {
    const startTime = Date.now();
    this._backoffActive();
    const model = options.model || await this.resolveModel();

    try {
      const payload = {
        model,
        messages: messages,
        stream: false,
        keep_alive: options.keepAlive || '5m',
        options: {
          temperature: options.temperature || 0.7,
          num_predict: options.maxTokens || 1000
        }
      };

      const response = await this.client.post('/api/chat', payload);
      OllamaClient._noteSuccess();

      return {
        text: response.data.message?.content || '',
        model: response.data.model,
        created_at: new Date().toISOString(),
        latency_ms: Date.now() - startTime,
        tokens: {
          prompt: response.data.prompt_eval_count || 0,
          completion: response.data.eval_count || 0
        }
      };
    } catch (error) {
      console.error('[HEIDI Brain] Chat failed:', error.message);
      OllamaClient._noteFailure();
      void this.unload(model);
      throw error;
    }
  }

  /**
   * Chat with function-calling. Returns tool_calls when the model wants to
   * invoke a tool (requires a tools-capable model, e.g. llama3.2).
   * Tool rounds legitimately take longer than plain chat, so this uses its
   * own timeout instead of the client default.
   */
  async chatWithTools(messages, tools, options = {}) {
    const startTime = Date.now();
    this._backoffActive();
    const model = options.model || await this.resolveModel();
    const payload = {
      model,
      messages,
      tools,
      stream: false,
      // Residency between tool rounds still matters, but 1h turned into a
      // permanent RAM reservation on this box — 10m bounds it while still
      // covering multi-round tool use.
      keep_alive: options.keepAlive || '10m',
      options: {
        temperature: options.temperature ?? 0.2,
        num_predict: options.maxTokens || 1000
      }
    };

    const response = await this.client.post('/api/chat', payload, {
      timeout: options.timeoutMs || 120000
    });

    const msg = response.data.message || {};
    return {
      text: msg.content || '',
      tool_calls: msg.tool_calls || [],
      model: response.data.model,
      latency_ms: Date.now() - startTime,
      tokens: {
        prompt: response.data.prompt_eval_count || 0,
        completion: response.data.eval_count || 0
      }
    };
  }
}

module.exports = OllamaClient;
