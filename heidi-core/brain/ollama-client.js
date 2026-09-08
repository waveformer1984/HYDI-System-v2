/**
 * HEIDI Brain - Ollama Client
 * Simple, fast, doesn't fight you
 */

const axios = require('axios');

class OllamaClient {
  constructor(config = {}) {
    this.baseURL = config.baseURL || process.env.OLLAMA_URL || 'http://localhost:11434';
    this.model = config.model || process.env.OLLAMA_MODEL || 'llama3';
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
   * Stream a generation token-by-token. Calls onToken(text) for each chunk,
   * resolves with the same shape as generate() once complete.
   */
  async generateStream(prompt, onToken, options = {}) {
    const model = options.model || this.model;
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
        } catch {}
      }
    }
    return { text: full, model, tokens: { prompt: 0, completion: 0 } };
  }

  async generate(prompt, options = {}) {
    const startTime = Date.now();
    
    try {
      const payload = {
        model: options.model || this.model,
        prompt: prompt,
        stream: false,
        keep_alive: options.keepAlive || '30m',
        options: {
          temperature: options.temperature || 0.7,
          num_predict: options.maxTokens || 1000
        }
      };

      const response = await this.client.post('/api/generate', payload);
      
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
      throw error;
    }
  }

  async chat(messages, options = {}) {
    const startTime = Date.now();
    
    try {
      const payload = {
        model: options.model || this.model,
        messages: messages,
        stream: false,
        keep_alive: options.keepAlive || '30m',
        options: {
          temperature: options.temperature || 0.7,
          num_predict: options.maxTokens || 1000
        }
      };

      const response = await this.client.post('/api/chat', payload);
      
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
    const payload = {
      model: options.model || this.model,
      messages,
      tools,
      stream: false,
      // Keep the tool model resident between rounds AND between messages. On a
      // RAM-tight box the model otherwise unloads after Ollama's 5min default
      // and the next call pays a full reload (~90s), blowing the timeout.
      keep_alive: options.keepAlive || '1h',
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
