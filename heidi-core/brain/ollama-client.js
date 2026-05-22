/**
 * HEIDI Brain - Ollama Client
 * Simple, fast, doesn't fight you
 */

const axios = require('axios');

class OllamaClient {
  constructor(config = {}) {
    this.baseURL = config.baseURL || process.env.OLLAMA_URL || 'http://localhost:11434';
    this.model = config.model || process.env.OLLAMA_MODEL || 'llama3';
    this.timeout = config.timeout || parseInt(process.env.OLLAMA_TIMEOUT_MS || '60000', 10); // default 60s; override with OLLAMA_TIMEOUT_MS
    
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
