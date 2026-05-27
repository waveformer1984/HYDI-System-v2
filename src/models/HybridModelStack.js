/**
 * HYBRID MODEL STACK - Layer 3: Hybrid Intelligence
 * Local First, External When Necessary
 * 
 * Philosophy: You do NOT want one model. That's how people burn money and lose control.
 * 
 * Local Models (Primary):
 * - Run via Ollama or LM Studio
 * - Use for: Reflection, Planning, Internal scoring, Rewrites, System monitoring
 * 
 * External Models (Selective Use):
 * - Use API only when: High-stakes output, Complex reasoning spikes, Polish needed
 */

const EventEmitter = require('events');
const axios = require('axios');
const LocalModelAdapter = require('./local-model-adapter');
const OllamaClient = require('../../heidi-core/brain/ollama-client');

class HybridModelStack extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      // Cost controls
      maxCostPerRequest: config.maxCostPerRequest || 0.50, // $0.50 max per request
      dailyBudget: config.dailyBudget || 10.0, // $10 daily budget
      externalThreshold: config.externalThreshold || 0.8, // 80% confidence needed for external
      
      // Performance controls
      localTimeout: config.localTimeout || 8000, // 8s local timeout
      externalTimeout: config.externalTimeout || 30000, // 30s external timeout
      
      // Strategy controls
      localFirst: config.localFirst !== false, // Default to local first
      enableFailover: config.enableFailover !== false, // Enable failover chains
      ...config
    };
    
    // Initialize local models
    this.localModels = new LocalModelAdapter();
    this.ollamaClient = new OllamaClient();
    
    // External model configurations
    this.externalModels = {
      openai: {
        baseURL: 'https://api.openai.com/v1',
        apiKey: process.env.OPENAI_API_KEY,
        models: {
          'gpt-4': { costPer1kTokens: 0.03, maxTokens: 4096 },
          'gpt-4-turbo': { costPer1kTokens: 0.01, maxTokens: 4096 },
          'gpt-3.5-turbo': { costPer1kTokens: 0.001, maxTokens: 4096 }
        }
      },
      
      anthropic: {
        baseURL: 'https://api.anthropic.com/v1',
        apiKey: process.env.ANTHROPIC_API_KEY,
        models: {
          'claude-3-opus': { costPer1kTokens: 0.015, maxTokens: 4096 },
          'claude-3-sonnet': { costPer1kTokens: 0.003, maxTokens: 4096 },
          'claude-3-haiku': { costPer1kTokens: 0.00025, maxTokens: 4096 }
        }
      },
      
      gemini: {
        baseURL: 'https://generativelanguage.googleapis.com/v1',
        apiKey: process.env.GEMINI_API_KEY,
        models: {
          'gemini-pro': { costPer1kTokens: 0.0005, maxTokens: 4096 },
          'gemini-pro-vision': { costPer1kTokens: 0.0025, maxTokens: 4096 }
        }
      }
    };
    
    // Model selection strategy
    this.strategy = {
      // LOCAL MODELS - Use these first, always
      local: {
        // Reasoning and analysis
        reasoning: {
          primary: 'gpt-4-local',
          fallback: ['gpt-35-turbo', 'local-llama'],
          use: 'reflection, planning, analysis, decision-making'
        },
        
        // General tasks
        general: {
          primary: 'gpt-35-turbo',
          fallback: ['local-llama'],
          use: 'standard requests, basic tasks'
        },
        
        // Fast operations
        fast: {
          primary: 'local-classifier',
          fallback: ['rule-engine'],
          use: 'classification, rule-based decisions'
        },
        
        // Code and technical
        code: {
          primary: 'code-specialist',
          fallback: ['code-parser', 'gpt-4-local'],
          use: 'code generation, debugging, technical analysis'
        },
        
        // Security and validation
        security: {
          primary: 'security-scanner',
          fallback: ['bug-finder'],
          use: 'security analysis, vulnerability detection'
        },
        
        // Database operations
        database: {
          primary: 'db-specialist',
          fallback: ['gpt-4-local'],
          use: 'SQL generation, database optimization'
        },
        
        // Analytics and prediction
        analytics: {
          primary: 'predictive-model',
          fallback: ['pricing-engine'],
          use: 'data analysis, predictions, insights'
        }
      },
      
      // EXTERNAL MODELS - Use only when necessary
      external: {
        // High-stakes output (sales copy, external messaging)
        high_stakes: {
          models: ['gpt-4', 'claude-3-opus'],
          trigger: 'revenue, sales, customer-facing content',
          reason: 'Maximum quality for revenue-generating content'
        },
        
        // Complex reasoning spikes
        complex_reasoning: {
          models: ['gpt-4-turbo', 'claude-3-sonnet'],
          trigger: 'multi-step logic, complex problem solving',
          reason: 'Advanced reasoning when local models struggle'
        },
        
        // Polish and refinement
        polish: {
          models: ['gpt-4-turbo', 'claude-3-sonnet'],
          trigger: 'final output refinement, quality enhancement',
          reason: 'Superior language quality for final deliverables'
        }
      }
    };
    
    // Cost tracking
    this.costTracker = {
      daily: 0,
      total: 0,
      lastReset: Date.now(),
      requests: []
    };
    
    // Performance tracking
    this.performance = {
      local: { success: 0, failure: 0, avgLatency: 0 },
      external: { success: 0, failure: 0, avgLatency: 0 },
      fallbacks: 0
    };
    
    // Available models list
    this.availableModels = [];

    // Timer reference — cleared by destroy()
    this._monitorInterval = null;
    
    // Initialize
    this.initialize();
  }
  
  async initialize() {
    console.log('[HYBRID STACK] Initializing Hybrid Model Stack...');
    
    // Check local model availability
    const localAvailable = await this.ollamaClient.isAvailable();
    console.log(`[HYBRID STACK] Local models available: ${localAvailable ? 'YES' : 'NO'}`);
    
    if (localAvailable) {
      const models = await this.ollamaClient.getModels();
      console.log(`[HYBRID STACK] Found ${models.length} local models:`, models.join(', '));
    }
    
    // Check external API keys
    this.checkExternalAPIs();
    
    // Build available models list
    this.buildAvailableModelsList();
    
    // Start cost monitoring
    this.startCostMonitoring();
    
    console.log('[HYBRID STACK] Hybrid Model Stack initialized');
    console.log(`[HYBRID STACK] Strategy: ${this.config.localFirst ? 'LOCAL_FIRST' : 'EXTERNAL_FIRST'}`);
  }
  
  /**
   * Build the available models list
   */
  buildAvailableModelsList() {
    this.availableModels = [];
    
    // Add local models
    for (const [category, models] of Object.entries(this.strategy.local)) {
      if (typeof models === 'object' && models.primary) {
        this.availableModels.push({
          id: models.primary,
          name: models.primary,
          type: 'local',
          category: category,
          capabilities: this.getModelCapabilities(models.primary),
          cost: 0,
          latency: 'low'
        });
        
        // Add fallback models
        if (models.fallback && Array.isArray(models.fallback)) {
          for (const fallback of models.fallback) {
            if (!this.availableModels.find(m => m.id === fallback)) {
              this.availableModels.push({
                id: fallback,
                name: fallback,
                type: 'local',
                category: category,
                capabilities: this.getModelCapabilities(fallback),
                cost: 0,
                latency: 'low'
              });
            }
          }
        }
      }
    }
    
    // Add external models if API keys are available
    if (this.externalModels.openai.apiKey) {
      this.availableModels.push({
        id: 'gpt-4',
        name: 'GPT-4',
        type: 'external',
        provider: 'openai',
        capabilities: ['reasoning', 'analysis', 'writing'],
        cost: 0.03,
        latency: 'medium'
      });
      
      this.availableModels.push({
        id: 'gpt-35-turbo',
        name: 'GPT-3.5 Turbo',
        type: 'external',
        provider: 'openai',
        capabilities: ['reasoning', 'analysis', 'writing'],
        cost: 0.002,
        latency: 'low'
      });
    }
    
    if (this.externalModels.anthropic.apiKey) {
      this.availableModels.push({
        id: 'claude-3-opus',
        name: 'Claude 3 Opus',
        type: 'external',
        provider: 'anthropic',
        capabilities: ['reasoning', 'analysis', 'writing'],
        cost: 0.015,
        latency: 'medium'
      });
    }
    
    if (this.externalModels.gemini.apiKey) {
      this.availableModels.push({
        id: 'gemini-pro',
        name: 'Gemini Pro',
        type: 'external',
        provider: 'gemini',
        capabilities: ['reasoning', 'analysis', 'writing'],
        cost: 0.001,
        latency: 'low'
      });
    }
  }
  
  getModelCapabilities(modelId) {
    // Basic capability mapping based on model name
    if (modelId.includes('gpt-4') || modelId.includes('claude')) {
      return ['reasoning', 'analysis', 'writing', 'code'];
    } else if (modelId.includes('classifier') || modelId.includes('rule')) {
      return ['classification', 'rule-based'];
    } else if (modelId.includes('code') || modelId.includes('parser')) {
      return ['code', 'analysis'];
    } else if (modelId.includes('security') || modelId.includes('bug')) {
      return ['security', 'analysis'];
    } else if (modelId.includes('database') || modelId.includes('db')) {
      return ['database', 'sql'];
    } else {
      return ['general'];
    }
  }

  /**
   * MAIN INFERENCE METHOD - Smart model selection and execution
   */
  async execute(task, options = {}) {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    
    try {
      console.log(`[HYBRID STACK] Executing task ${requestId}: ${task.type}`);
      
      // Determine execution strategy
      const strategy = this.determineStrategy(task, options);
      
      // Execute with chosen strategy
      const result = await this.executeWithStrategy(task, strategy, requestId);
      
      // Track performance
      this.trackPerformance(strategy, result, Date.now() - startTime);
      
      // Emit completion
      this.emit('inference_complete', {
        requestId,
        task,
        strategy,
        result,
        latency: Date.now() - startTime
      });
      
      return result;
      
    } catch (error) {
      console.error(`[HYBRID STACK] Task ${requestId} failed:`, error.message);
      
      this.performance[strategy.type].failure++;
      
      this.emit('inference_failed', {
        requestId,
        task,
        error: error.message,
        strategy
      });
      
      throw error;
    }
  }
  
  /**
   * DETERMINE STRATEGY - Decide between local and external
   */
  determineStrategy(task, options) {
    // Force strategy if specified
    if (options.forceStrategy) {
      return {
        type: options.forceStrategy,
        model: options.forceModel,
        reason: 'forced_by_user'
      };
    }
    
    // Check budget constraints
    if (this.costTracker.daily >= this.config.dailyBudget) {
      console.log('[HYBRID STACK] Daily budget exceeded, forcing local models');
      return {
        type: 'local',
        model: this.selectBestLocalModel(task),
        reason: 'budget_limit'
      };
    }
    
    // Check if task requires external models
    const externalRequirement = this.checkExternalRequirement(task);
    if (externalRequirement.required) {
      return {
        type: 'external',
        model: externalRequirement.model,
        provider: externalRequirement.provider,
        reason: externalRequirement.reason
      };
    }
    
    // Default to local first
    if (this.config.localFirst) {
      return {
        type: 'local',
        model: this.selectBestLocalModel(task),
        fallback: this.selectLocalFallback(task),
        reason: 'local_first_strategy'
      };
    }
    
    // Cost-based decision
    const estimatedCost = this.estimateCost(task);
    if (estimatedCost > this.config.maxCostPerRequest) {
      return {
        type: 'local',
        model: this.selectBestLocalModel(task),
        reason: 'cost_limit'
      };
    }
    
    // Default external
    return {
      type: 'external',
      model: this.selectBestExternalModel(task),
      provider: this.selectExternalProvider(task),
      reason: 'default_external'
    };
  }
  
  /**
   * EXECUTE WITH STRATEGY - Execute using the determined strategy
   */
  async executeWithStrategy(task, strategy, requestId) {
    switch (strategy.type) {
      case 'local':
        return await this.executeLocal(task, strategy, requestId);
      
      case 'external':
        return await this.executeExternal(task, strategy, requestId);
      
      case 'hybrid':
        return await this.executeHybrid(task, strategy, requestId);
      
      default:
        throw new Error(`Unknown strategy: ${strategy.type}`);
    }
  }
  
  /**
   * LOCAL EXECUTION - Use local models
   */
  async executeLocal(task, strategy, requestId) {
    try {
      console.log(`[HYBRID STACK] Executing locally with model: ${strategy.model}`);
      
      const input = this.prepareInput(task);
      
      const result = await this.localModels.execute(strategy.model, input, {
        tier: task.tier || 'pro',
        timeout: this.config.localTimeout,
        inferenceRequestId: requestId
      });
      
      return {
        ...result,
        strategy: 'local',
        model: strategy.model,
        provider: 'local',
        cost: 0, // Local models are "free" (already paid for)
        requestId
      };
      
    } catch (error) {
      // Try fallback if available
      if (strategy.fallback && this.config.enableFailover) {
        console.log(`[HYBRID STACK] Local model failed, trying fallback: ${strategy.fallback}`);
        
        try {
          const fallbackResult = await this.localModels.execute(strategy.fallback, input, {
            tier: task.tier || 'pro',
            timeout: this.config.localTimeout,
            inferenceRequestId: requestId
          });
          
          this.performance.fallbacks++;
          
          return {
            ...fallbackResult,
            strategy: 'local_fallback',
            model: strategy.fallback,
            provider: 'local',
            cost: 0,
            requestId,
            originalError: error.message
          };
          
        } catch (fallbackError) {
          console.error(`[HYBRID STACK] Fallback also failed:`, fallbackError.message);
        }
      }
      
      throw error;
    }
  }
  
  /**
   * EXTERNAL EXECUTION - Use external APIs
   */
  async executeExternal(task, strategy, requestId) {
    const provider = this.externalModels[strategy.provider];
    if (!provider) {
      throw new Error(`Unknown external provider: ${strategy.provider}`);
    }
    
    if (!provider.apiKey) {
      throw new Error(`No API key configured for ${strategy.provider}`);
    }
    
    try {
      console.log(`[HYBRID STACK] Executing externally with ${strategy.provider}:${strategy.model}`);
      
      const input = this.prepareInput(task);
      const cost = this.calculateCost(strategy.provider, strategy.model, input);
      
      // Check cost limits
      if (cost > this.config.maxCostPerRequest) {
        throw new Error(`Cost $${cost.toFixed(4)} exceeds limit $${this.config.maxCostPerRequest}`);
      }
      
      const result = await this.callExternalAPI(strategy.provider, strategy.model, input, requestId);
      
      // Track cost
      this.trackCost(cost, strategy.provider, strategy.model);
      
      return {
        ...result,
        strategy: 'external',
        model: strategy.model,
        provider: strategy.provider,
        cost,
        requestId
      };
      
    } catch (error) {
      console.error(`[HYBRID STACK] External execution failed:`, error.message);
      
      // Fallback to local if enabled
      if (this.config.enableFailover) {
        console.log('[HYBRID STACK] External failed, falling back to local');
        
        return await this.executeLocal(task, {
          model: this.selectBestLocalModel(task),
          fallback: this.selectLocalFallback(task),
          reason: 'external_failover'
        }, requestId);
      }
      
      throw error;
    }
  }
  
  /**
   * HYBRID EXECUTION - Local first, external enhancement if needed
   */
  async executeHybrid(task, strategy, requestId) {
    console.log('[HYBRID STACK] Executing hybrid strategy');
    
    // First, try local
    const localResult = await this.executeLocal(task, {
      model: this.selectBestLocalModel(task),
      fallback: this.selectLocalFallback(task),
      reason: 'hybrid_primary'
    }, requestId);
    
    // Evaluate local result quality
    const quality = this.assessQuality(localResult);
    
    if (quality.confidence >= this.config.externalThreshold) {
      console.log('[HYBRID STACK] Local result sufficient, skipping external');
      return localResult;
    }
    
    console.log('[HYBRID STACK] Local quality insufficient, enhancing with external');
    
    // Enhance with external model
    const enhancedTask = {
      ...task,
      context: {
        ...task.context,
        localResult: localResult.text,
        enhancementRequest: 'Please enhance and refine this result for higher quality'
      }
    };
    
    const externalResult = await this.executeExternal(enhancedTask, {
      model: this.selectBestExternalModel(enhancedTask),
      provider: this.selectExternalProvider(enhancedTask),
      reason: 'hybrid_enhancement'
    }, requestId);
    
    return {
      ...externalResult,
      strategy: 'hybrid_enhanced',
      localResult: localResult.text,
      localConfidence: quality.confidence,
      enhancement: true,
      requestId
    };
  }
  
  /**
   * MODEL SELECTION METHODS
   */
  selectBestLocalModel(task) {
    const taskType = this.mapTaskType(task.type);
    const strategy = this.strategy.local[taskType];
    
    return strategy ? strategy.primary : 'gpt-35-turbo';
  }
  
  selectLocalFallback(task) {
    const taskType = this.mapTaskType(task.type);
    const strategy = this.strategy.local[taskType];
    
    return strategy && strategy.fallback ? strategy.fallback[0] : 'local-llama';
  }
  
  selectBestExternalModel(task) {
    const requirement = this.checkExternalRequirement(task);
    if (requirement.required) {
      return requirement.model;
    }
    
    // Default to cost-effective external model
    return 'gpt-3.5-turbo';
  }
  
  selectExternalProvider(task) {
    // Check API key availability and cost
    if (this.externalModels.openai.apiKey) return 'openai';
    if (this.externalModels.anthropic.apiKey) return 'anthropic';
    if (this.externalModels.gemini.apiKey) return 'gemini';
    
    throw new Error('No external API keys available');
  }
  
  /**
   * EXTERNAL REQUIREMENT CHECK
   */
  checkExternalRequirement(task) {
    // High-stakes content (revenue, customer-facing)
    if (task.type === 'revenue' || task.type === 'sales' || task.type === 'marketing') {
      return {
        required: true,
        model: 'gpt-4',
        provider: 'openai',
        reason: 'high_stakes_revenue_content'
      };
    }
    
    // Complex reasoning
    if (task.complexity > 3 || task.type === 'complex_analysis') {
      return {
        required: true,
        model: 'gpt-4-turbo',
        provider: 'openai',
        reason: 'complex_reasoning_required'
      };
    }
    
    // Polish and refinement
    if (task.type === 'polish' || task.type === 'refine') {
      return {
        required: true,
        model: 'claude-3-sonnet',
        provider: 'anthropic',
        reason: 'polish_refinement_required'
      };
    }
    
    return { required: false };
  }
  
  /**
   * EXTERNAL API CALLS
   */
  async callExternalAPI(provider, model, input, requestId) {
    switch (provider) {
      case 'openai':
        return await this.callOpenAI(model, input, requestId);
      case 'anthropic':
        return await this.callAnthropic(model, input, requestId);
      case 'gemini':
        return await this.callGemini(model, input, requestId);
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }
  
  async callOpenAI(model, input, requestId) {
    const provider = this.externalModels.openai;
    
    const payload = {
      model: model,
      messages: this.formatMessages(input),
      max_tokens: provider.models[model].maxTokens,
      temperature: 0.7
    };
    
    const response = await axios.post(`${provider.baseURL}/chat/completions`, payload, {
      headers: {
        'Authorization': `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: this.config.externalTimeout
    });
    
    return {
      text: response.data.choices[0].message.content,
      model: model,
      usage: response.data.usage,
      confidence: 0.9 // OpenAI typically has high confidence
    };
  }
  
  async callAnthropic(model, input, requestId) {
    const provider = this.externalModels.anthropic;
    
    const payload = {
      model: model,
      max_tokens: provider.models[model].maxTokens,
      messages: this.formatMessages(input)
    };
    
    const response = await axios.post(`${provider.baseURL}/messages`, payload, {
      headers: {
        'x-api-key': provider.apiKey,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      timeout: this.config.externalTimeout
    });
    
    return {
      text: response.data.content[0].text,
      model: model,
      usage: response.data.usage,
      confidence: 0.9
    };
  }

  async callGemini(model, input, requestId) {
    const provider = this.externalModels.gemini;
    
    const payload = {
      contents: [{
        parts: [{
          text: this.formatGeminiInput(input)
        }]
      }]
    };
    
    const response = await axios.post(`${provider.baseURL}/models/${model}:generateContent`, payload, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: this.config.externalTimeout
    });
    
    return {
      text: response.data.candidates[0].content.parts[0].text,
      model: model,
      usage: response.data.usageMetadata,
      confidence: 0.85
    };
  }
  
  /**
   * UTILITY METHODS
   */
  mapTaskType(taskType) {
    const mapping = {
      'revenue': 'reasoning',
      'analysis': 'reasoning',
      'planning': 'reasoning',
      'classification': 'fast',
      'code': 'code',
      'security': 'security',
      'database': 'database',
      'analytics': 'analytics',
      'prediction': 'analytics'
    };
    
    return mapping[taskType] || 'general';
  }
  
  prepareInput(task) {
    return {
      task: task.type,
      instruction: task.instruction || task.input,
      context: task.context || {},
      options: task.options || {}
    };
  }
  
  formatMessages(input) {
    const messages = [];
    
    if (input.context.system) {
      messages.push({ role: 'system', content: input.context.system });
    }
    
    messages.push({ role: 'user', content: input.instruction });
    
    return messages;
  }
  
  formatGeminiInput(input) {
    let text = '';
    
    if (input.context.system) {
      text += `System: ${input.context.system}\n\n`;
    }
    
    text += `User: ${input.instruction}`;
    
    return text;
  }
  
  assessQuality(result) {
    // Simple quality assessment based on confidence and content
    const confidence = result.confidence || 0.5;
    const textLength = result.text ? result.text.length : 0;
    
    // Adjust confidence based on output quality
    let adjustedConfidence = confidence;
    
    if (textLength < 50) adjustedConfidence -= 0.2; // Too short
    if (textLength > 5000) adjustedConfidence -= 0.1; // Too long (might be rambling)
    
    return {
      confidence: Math.max(0.1, Math.min(0.99, adjustedConfidence)),
      textLength,
      sufficient: adjustedConfidence >= this.config.externalThreshold
    };
  }
  
  calculateCost(provider, model, input) {
    const providerConfig = this.externalModels[provider];
    const modelConfig = providerConfig.models[model];
    
    // Estimate tokens (rough calculation)
    const estimatedTokens = this.estimateTokens(input);
    
    return (estimatedTokens / 1000) * modelConfig.costPer1kTokens;
  }
  
  estimateTokens(input) {
    const text = typeof input === 'string' ? input : JSON.stringify(input);
    // Rough estimate: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  estimateCost(task) {
    const input = this.prepareInput(task);
    const provider = this.selectExternalProvider(task).catch(() => null);
    if (!provider) return 0;
    const model = this.selectBestExternalModel(task);
    return this.calculateCost(provider, model, input);
  }
  
  trackCost(cost, provider, model) {
    this.costTracker.daily += cost;
    this.costTracker.total += cost;
    
    this.costTracker.requests.push({
      timestamp: Date.now(),
      cost,
      provider,
      model,
      daily: this.costTracker.daily
    });
    
    // Emit cost tracking event
    this.emit('cost_tracked', {
      cost,
      provider,
      model,
      dailyTotal: this.costTracker.daily,
      remainingBudget: this.config.dailyBudget - this.costTracker.daily
    });
    
    // Check budget warning
    if (this.costTracker.daily >= this.config.dailyBudget * 0.8) {
      this.emit('budget_warning', {
        used: this.costTracker.daily,
        budget: this.config.dailyBudget,
        percentage: (this.costTracker.daily / this.config.dailyBudget) * 100
      });
    }
  }
  
  trackPerformance(strategy, result, latency) {
    const perf = this.performance[strategy.type];
    
    if (result.success !== false) {
      perf.success++;
      
      // Update average latency
      perf.avgLatency = (perf.avgLatency * (perf.success - 1) + latency) / perf.success;
    } else {
      perf.failure++;
    }
  }
  
  checkExternalAPIs() {
    const available = [];
    
    for (const [provider, config] of Object.entries(this.externalModels)) {
      if (config.apiKey) {
        available.push(provider);
        console.log(`[HYBRID STACK] ${provider.toUpperCase()} API key configured`);
      } else {
        console.log(`[HYBRID STACK] ${provider.toUpperCase()} API key NOT configured`);
      }
    }
    
    console.log(`[HYBRID STACK] External providers available: ${available.length} (${available.join(', ')})`);
  }
  
  startCostMonitoring() {
    // Store the reference so destroy() can clear it
    this._monitorInterval = setInterval(() => {
      const now = new Date();
      const lastReset = new Date(this.costTracker.lastReset);
      
      if (now.getDate() !== lastReset.getDate() || now.getMonth() !== lastReset.getMonth()) {
        console.log(`[HYBRID STACK] Resetting daily cost tracker. Yesterday: $${this.costTracker.daily.toFixed(4)}`);
        this.costTracker.daily = 0;
        this.costTracker.lastReset = Date.now();
      }
    }, 60000); // Check every minute

    // Allow Node / Jest to exit even if this interval is still scheduled
    if (this._monitorInterval.unref) this._monitorInterval.unref();
  }

  /**
   * Stop background timers. Call in afterAll / afterEach when testing.
   */
  destroy() {
    clearInterval(this._monitorInterval);
    this._monitorInterval = null;
  }
  
  /**
   * STATUS AND MONITORING
   */
  getStatus() {
    return {
      config: this.config,
      cost: {
        daily: this.costTracker.daily,
        total: this.costTracker.total,
        remaining: this.config.dailyBudget - this.costTracker.daily,
        lastReset: new Date(this.costTracker.lastReset).toISOString()
      },
      performance: { ...this.performance },
      models: {
        available: this.availableModels.length,
        external: Object.keys(this.externalModels).filter(p => this.externalModels[p].apiKey)
      }
    };
  }

  getAvailableModels() {
    return this.availableModels.map(model => ({
      id: model.id,
      name: model.name,
      type: model.type,
      capabilities: model.capabilities,
      cost: model.cost,
      latency: model.latency
    }));
  }
  
  async reset() {
    this.costTracker.daily = 0;
    this.costTracker.lastReset = Date.now();
    this.costTracker.requests = [];
    
    this.performance = {
      local: { success: 0, failure: 0, avgLatency: 0 },
      external: { success: 0, failure: 0, avgLatency: 0 },
      fallbacks: 0
    };
    
    console.log('[HYBRID STACK] Reset completed');
  }
}

module.exports = HybridModelStack;
