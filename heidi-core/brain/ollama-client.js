/**
 * HEIDI Brain - Ollama Client
 * Simple, fast, doesn't fight you
 */

const axios = require('axios');

class OllamaClient {
  constructor(config = {}) {
    this.baseURL = config.baseURL || process.env.OLLAMA_URL || 'http://localhost:11434';
    this.model = config.model || process.env.OLLAMA_MODEL || 'llama3';
    this.timeout = config.timeout || parseInt(process.env.OLLAMA_TIMEOUT_MS || '8000', 10); // hard timeout (override via OLLAMA_TIMEOUT_MS)
    
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
}

module.exports = OllamaClient;
