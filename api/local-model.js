/**
 * Local Model Integration for Heidi Chat
 * Supports LM Studio, Ollama, and other local LLM APIs
 */

const axios = require('axios');

class LocalModelClient {
  constructor(config = {}) {
    this.baseURL = config.baseURL || 'http://localhost:11434'; // Ollama default
    this.model = config.model || 'llama2';
    this.provider = config.provider || 'ollama'; // ollama, lmstudio, custom
    this.timeout = config.timeout || 30000;
    
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Check if local model is available
   */
  async isAvailable() {
    try {
      if (this.provider === 'ollama') {
        const response = await this.client.get('/api/tags');
        return response.status === 200;
      } else if (this.provider === 'lmstudio') {
        const response = await this.client.get('/v1/models');
        return response.status === 200;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get available models
   */
  async getModels() {
    try {
      if (this.provider === 'ollama') {
        const response = await this.client.get('/api/tags');
        return response.data.models?.map(m => m.name) || [];
      } else if (this.provider === 'lmstudio') {
        const response = await this.client.get('/v1/models');
        return response.data.data?.map(m => m.id) || [];
      }
      return [];
    } catch (error) {
      console.error('[LocalModel] Failed to get models:', error.message);
      return [];
    }
  }

  /**
   * Generate completion
   */
  async generate(prompt, options = {}) {
    try {
      const payload = this.buildPayload(prompt, options);
      
      if (this.provider === 'ollama') {
        const response = await this.client.post('/api/generate', payload);
        return this.parseOllamaResponse(response.data);
      } else if (this.provider === 'lmstudio') {
        const response = await this.client.post('/v1/chat/completions', payload);
        return this.parseLMStudioResponse(response.data);
      }
      
      throw new Error(`Unsupported provider: ${this.provider}`);
    } catch (error) {
      console.error('[LocalModel] Generation failed:', error.message);
      throw error;
    }
  }

  /**
   * Build payload for different providers
   */
  buildPayload(prompt, options) {
    const baseOptions = {
      temperature: options.temperature || 0.7,
      max_tokens: options.max_tokens || 1000,
      stream: false
    };

    if (this.provider === 'ollama') {
      return {
        model: this.model,
        prompt: this.buildPrompt(prompt),
        ...baseOptions
      };
    } else if (this.provider === 'lmstudio') {
      return {
        model: this.model,
        messages: [
          { role: 'system', content: this.getSystemPrompt() },
          { role: 'user', content: prompt }
        ],
        ...baseOptions
      };
    }
  }

  /**
   * Parse Ollama response
   */
  parseOllamaResponse(data) {
    return {
      text: data.response,
      model: data.model,
      created_at: data.created_at,
      done: data.done,
      total_duration: data.total_duration,
      load_duration: data.load_duration,
      prompt_eval_count: data.prompt_eval_count,
      eval_count: data.eval_count
    };
  }

  /**
   * Parse LM Studio response
   */
  parseLMStudioResponse(data) {
    return {
      text: data.choices[0]?.message?.content || '',
      model: data.model,
      created: data.created,
      usage: data.usage
    };
  }

  /**
   * Build system-aware prompt
   */
  buildPrompt(userMessage) {
    return `${this.getSystemPrompt()}

User: ${userMessage}

Heidi:`;
  }

  /**
   * Get system prompt for Heidi
   */
  getSystemPrompt() {
    return `You are Heidi, the ProtoForge contextual conscience and system health advisor. You have access to the HYDI health monitoring system and can help users understand system status, analyze trends, and provide contextual advice.

Key capabilities:
- Monitor Supabase health (queue status, event flow, automation uptime)
- Analyze health trends and escalation logic
- Provide contextual advice based on system state
- Help users understand auto-heal actions
- Alert users to critical issues

Your tone should be:
- Helpful and knowledgeable
- Calm and reassuring during issues
- Clear and concise
- Slightly warm and friendly

If you don't have current health data, suggest the user check the system status or health metrics.

Current date: ${new Date().toISOString()}`;
  }

  /**
   * Health-aware response generation
   */
  async generateWithContext(message, healthContext = null) {
    let prompt = message;
    
    // Add health context if available
    if (healthContext) {
      const healthInfo = `
Current System Health:
- Status: ${healthContext.current_status || 'Unknown'}
- Trend: ${healthContext.trend_status || 'Unknown'}
- Queue: ${healthContext.jobs_queued || 0} queued, ${healthContext.jobs_failed || 0} failed
- Events: ${healthContext.events_last_hour || 0}/hour
- Auto-heals: ${healthContext.auto_heals_24h || 0} in 24h
`;
      
      prompt = `${healthInfo}\n\nUser message: ${message}`;
    }
    
    return this.generate(prompt);
  }
}

/**
 * Heidi Local Model Handler
 */
class HeidiLocalHandler {
  constructor(config = {}) {
    this.client = new LocalModelClient(config);
    this.healthCache = null;
    this.healthCacheTime = 0;
    this.healthCacheTTL = 30000; // 30 seconds
  }

  /**
   * Initialize and check availability
   */
  async initialize() {
    const available = await this.client.isAvailable();
    if (!available) {
      throw new Error('Local model service not available. Make sure LM Studio or Ollama is running.');
    }
    
    const models = await this.client.getModels();
    if (models.length === 0) {
      throw new Error('No models available in local service.');
    }
    
    console.log(`[Heidi] Local model connected. Available models: ${models.join(', ')}`);
    return models;
  }

  /**
   * Handle message with health context
   */
  async handleMessage(message) {
    const healthContext = await this.getHealthContext();
    
    try {
      const response = await this.client.generateWithContext(message, healthContext);
      
      return {
        text: response.text,
        model: this.client.model,
        provider: this.client.provider,
        healthContext: healthContext ? 'included' : 'unavailable',
        usage: response.usage
      };
    } catch (error) {
      console.error('[Heidi] Local model generation failed:', error.message);

      // Cloud fallback (works on serverless where the local model is unreachable)
      const cloud = await this.tryCloudFallback(message, healthContext);
      if (cloud) {
        return { ...cloud, healthContext: healthContext ? 'included' : 'unavailable', fallback: true };
      }

      // Last-resort canned response
      return {
        text: this.getFallbackResponse(message, healthContext),
        model: this.client.model,
        provider: this.client.provider,
        error: error.message,
        fallback: true
      };
    }
  }

  /**
   * Cloud fallback via Anthropic (preferred) or OpenAI when configured.
   * Returns null when no cloud provider is available or the call fails.
   */
  async tryCloudFallback(message, healthContext) {
    const systemPrompt = this.client.getSystemPrompt();
    const userContent = healthContext
      ? `Current System Health: ${JSON.stringify(healthContext)}\n\nUser message: ${message}`
      : message;

    try {
      if (process.env.ANTHROPIC_API_KEY) {
        const resp = await axios.post(
          'https://api.anthropic.com/v1/messages',
          {
            model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
            max_tokens: 1000,
            system: systemPrompt,
            messages: [{ role: 'user', content: userContent }],
          },
          {
            headers: {
              'x-api-key': process.env.ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
              'Content-Type': 'application/json',
            },
            timeout: 30000,
          }
        );
        const text = (resp.data.content || [])
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('');
        return { text, model: resp.data.model, provider: 'anthropic', usage: resp.data.usage };
      }

      if (process.env.OPENAI_API_KEY) {
        const resp = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userContent },
            ],
            max_tokens: 1000,
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              'Content-Type': 'application/json',
            },
            timeout: 30000,
          }
        );
        return {
          text: resp.data.choices[0]?.message?.content || '',
          model: resp.data.model,
          provider: 'openai',
          usage: resp.data.usage,
        };
      }
    } catch (err) {
      console.error('[Heidi] Cloud fallback failed:', err.message);
    }
    return null;
  }

  /**
   * Get health context from HYDI
   */
  async getHealthContext() {
    const now = Date.now();
    
    // Use cache if fresh
    if (this.healthCache && (now - this.healthCacheTime) < this.healthCacheTTL) {
      return this.healthCache;
    }
    
    try {
      const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/system_dashboard?select=*`, {
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        this.healthCache = data[0] || null;
        this.healthCacheTime = now;
        return this.healthCache;
      }
    } catch (error) {
      console.error('[Heidi] Failed to fetch health context:', error);
    }
    
    return null;
  }

  /**
   * Fallback response when local model fails
   */
  getFallbackResponse(message, healthContext) {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('health') || lowerMessage.includes('status')) {
      if (healthContext) {
        return `I'm having trouble reaching my local AI model, but I can see the system status: ${healthContext.current_status || 'Unknown'}. ${healthContext.current_status === 'CRITICAL' ? '⚠️ There are critical issues that need attention.' : '✅ Systems appear to be running normally.'}`;
      }
      return 'I\'m having trouble accessing my local AI model right now. Please check the system status using the quick actions above.';
    }
    
    return 'I\'m experiencing issues with my local AI model. Please try again in a moment or use one of the quick actions for system status.';
  }

  /**
   * Switch model
   */
  async switchModel(modelName) {
    const models = await this.client.getModels();
    if (!models.includes(modelName)) {
      throw new Error(`Model ${modelName} not available. Available: ${models.join(', ')}`);
    }
    
    this.client.model = modelName;
    console.log(`[Heidi] Switched to model: ${modelName}`);
  }
}

module.exports = { LocalModelClient, HeidiLocalHandler };
