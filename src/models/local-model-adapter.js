/**
 * Local Model Adapter for Ursula Service Bundle
 * Interfaces with local AI models for service execution
 */

const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');

class LocalModelAdapter extends EventEmitter {
  constructor() {
    super();
    this.models = new Map();
    this.modelProcesses = new Map();
    
    // FALLBACK CIRCUIT BREAKER: Prevent cascade failure loops
    this.fallbackConfig = {
      maxDepth: 2, // Max 2 fallbacks before giving up
      circuitBreakerThreshold: 5, // Disable model after 5 failures in 60s
      circuitBreakerWindow: 60000 // 60 second window
    };
    this.fallbackChains = new Map(); // Track fallback depth per request
    this.circuitBreakers = new Map(); // modelId -> { failures, lastFailure, disabled }
    
    // CLOUD FAILOVER: Firebase + AI Studio for hardware fatigue
    this.cloudFailover = {
      enabled: process.env.ENABLE_CLOUD_FAILOVER === 'true',
      firebaseFunctionsUrl: process.env.FIREBASE_FUNCTIONS_URL,
      geminiApiKey: process.env.GEMINI_API_KEY,
      latencyThreshold: 2000, // 2 seconds - failover if local latency exceeds
      failoverCount: 0,
      lastFailover: 0
    };
    
    const basePath = process.env.MODEL_BASE_PATH || path.resolve(__dirname, '../../models');
    const configPath = process.env.CONFIG_BASE_PATH || path.resolve(__dirname, '../../config');
    const dataPath = process.env.DATA_BASE_PATH || path.resolve(__dirname, '../../data');
    
    this.modelConfigs = {
      'gpt-4-local': {
        type: 'llama',
        path: path.join(basePath, 'llama-3-8b-instruct'),
        contextSize: 4096,
        temperature: 0.7,
        maxTokens: 2048
      },
      'gpt-35-turbo': {
        type: 'llama',
        path: path.join(basePath, 'llama-3-7b-chat'),
        contextSize: 2048,
        temperature: 0.8,
        maxTokens: 1024
      },
      'local-llama': {
        type: 'llama',
        path: path.join(basePath, 'llama-2-7b'),
        contextSize: 2048,
        temperature: 0.6,
        maxTokens: 1024
      },
      'local-classifier': {
        type: 'distilbert',
        path: path.join(basePath, 'distilbert-base-uncased'),
        labels: ['positive', 'negative', 'neutral']
      },
      'code-specialist': {
        type: 'codellama',
        path: path.join(basePath, 'codellama-7b-instruct'),
        contextSize: 4096,
        temperature: 0.2,
        maxTokens: 1024
      },
      'code-parser': {
        type: 'tree-sitter',
        languages: ['javascript', 'python', 'java', 'go', 'rust']
      },
      'bug-finder': {
        type: 'custom',
        path: path.join(basePath, 'bug-detector'),
        rules: path.join(configPath, 'bug-detection-rules.json')
      },
      'db-specialist': {
        type: 'sql',
        path: path.join(basePath, 'sql-coder'),
        dialects: ['postgresql', 'mysql', 'sqlite']
      },
      'security-scanner': {
        type: 'custom',
        path: path.join(basePath, 'security-scanner'),
        vulnerabilityDb: path.join(dataPath, 'cve-database.json')
      },
      'local-ocr': {
        type: 'tesseract',
        languages: ['eng', 'spa', 'fra', 'deu']
      },
      'predictive-model': {
        type: 'tensorflow',
        path: path.join(basePath, 'predictive-analytics'),
        features: ['sales', 'inventory', 'seasonality']
      },
      'pricing-engine': {
        type: 'custom',
        path: path.join(basePath, 'pricing-optimizer'),
        algorithms: ['elasticity', 'competitor', 'value-based']
      },
      'rule-engine': {
        type: 'drools',
        rulesPath: path.join(configPath, 'business-rules.drl')
      }
    };

    // System monitoring for Dynamic Concurrency Scaling
    this.systemMonitor = {
      maxTemp: 80, // °C
      maxCpu: 90,  // %
      currentTemp: 0,
      currentCpu: 0,
      throttlingActive: false,
      batchProcessingDelay: 100,
      maxBatchSize: 10,
      enterprisePriority: false,
      hungModelTimeout: 30000
    };
    
    this.batchQueue = [];
    this.batchTimer = null;

    this.initializeModels();
    this.startSystemMonitoring();
    this.startHungModelMonitor();
  }

  /**
   * Initialize all local models
   */
  async initializeModels() {
    console.log('Initializing local models...');
    
    for (const [modelId, config] of Object.entries(this.modelConfigs)) {
      try {
        await this.loadModel(modelId, config);
        console.log(`✓ Model loaded: ${modelId}`);
      } catch (error) {
        console.error(`✗ Failed to load model ${modelId}:`, error.message);
      }
    }
  }

  /**
   * Load a specific model
   */
  async loadModel(modelId, config) {
    switch (config.type) {
      case 'llama':
      case 'codellama':
        await this.loadLlamaModel(modelId, config);
        break;
      case 'distilbert':
        await this.loadClassifierModel(modelId, config);
        break;
      case 'tree-sitter':
        await this.loadCodeParser(modelId, config);
        break;
      case 'custom':
        await this.loadCustomModel(modelId, config);
        break;
      case 'tensorflow':
        await this.loadTensorFlowModel(modelId, config);
        break;
      case 'tesseract':
        await this.loadOCRModel(modelId, config);
        break;
      case 'drools':
        await this.loadRuleEngine(modelId, config);
        break;
      case 'sql':
        await this.loadSQLModel(modelId, config);
        break;
      default:
        throw new Error(`Unknown model type: ${config.type}`);
    }
  }

  /**
   * Load Llama-based model
   */
  async loadLlamaModel(modelId, config) {
    // Check if model file exists
    const modelPath = path.resolve(config.path);
    try {
      await fs.access(modelPath);
    } catch {
      // Download model if not exists
      await this.downloadModel(modelId, modelPath);
    }

    this.models.set(modelId, {
      type: config.type,
      path: modelPath,
      config: {
        contextSize: config.contextSize,
        temperature: config.temperature,
        maxTokens: config.maxTokens
      },
      loaded: true
    });
  }

  /**
   * Load classification model
   */
  async loadClassifierModel(modelId, config) {
    // Mock implementation - would use TensorFlow.js or similar
    this.models.set(modelId, {
      type: config.type,
      path: config.path,
      labels: config.labels,
      loaded: true
    });
  }

  /**
   * Load code parser
   */
  async loadCodeParser(modelId, config) {
    this.models.set(modelId, {
      type: config.type,
      languages: config.languages,
      loaded: true
    });
  }

  /**
   * Load custom model
   */
  async loadCustomModel(modelId, config) {
    this.models.set(modelId, {
      type: config.type,
      path: config.path,
      config: config,
      loaded: true
    });
  }

  /**
   * Load TensorFlow model
   */
  async loadTensorFlowModel(modelId, config) {
    this.models.set(modelId, {
      type: config.type,
      path: config.path,
      features: config.features,
      loaded: true
    });
  }

  /**
   * Load OCR model
   */
  async loadOCRModel(modelId, config) {
    this.models.set(modelId, {
      type: config.type,
      languages: config.languages,
      loaded: true
    });
  }

  /**
   * Load rule engine
   */
  async loadRuleEngine(modelId, config) {
    // Load rules file
    const rulesContent = await fs.readFile(config.rulesPath, 'utf8');
    
    this.models.set(modelId, {
      type: config.type,
      rules: rulesContent,
      loaded: true
    });
  }

  /**
   * Load SQL model
   */
  async loadSQLModel(modelId, config) {
    this.models.set(modelId, {
      type: config.type,
      path: config.path,
      dialects: config.dialects,
      loaded: true
    });
  }

  /**
   * Execute inference with a local model
   * HARD KILL: Promise.race with 8s timeout
   * SOFT SIGNAL: Latency tracking without auto-fallback
   * IID DECODING: Ensure inference request IDs are properly decoded and tracked
   */
  async execute(modelId, input, options = {}) {
    const model = this.models.get(modelId);
    if (!model || !model.loaded) {
      throw new Error(`Model ${modelId} not loaded`);
    }

    // Decode and validate Inference Request ID (IID) if provided
    const inferenceRequestId = this.decodeInferenceRequestId(options.inferenceRequestId);
    
    // Get tier from options or default to pro
    const tier = options.tier || 'pro';
    
    // HARD KILL TIMEOUT: 8 seconds max execution time
    const EXECUTION_TIMEOUT = options.timeout || 8000;
    
    const startTime = Date.now();
    
    try {
      // Race between execution and timeout
      const result = await Promise.race([
        tier === 'enterprise' 
          ? this.executePriority(modelId, input, { ...options, inferenceRequestId })
          : this.executeBatched(modelId, input, { ...options, inferenceRequestId }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('MODEL_TIMEOUT')), EXECUTION_TIMEOUT)
        )
      ]);
      
      const latency = Date.now() - startTime;
      
      // SOFT LATENCY SIGNAL: Track but DO NOT auto-fallback
      this.trackLatency(modelId, latency);
      
      // Attach decoded IID to result for tracking
      if (inferenceRequestId) {
        result.inferenceRequestId = inferenceRequestId;
        result.executionMetadata = {
          ...result.executionMetadata,
          iidDecoded: true,
          iidTimestamp: new Date().toISOString()
        };
      }
      
      return result;
      
    } catch (error) {
      const latency = Date.now() - startTime;
      
      if (error.message === 'MODEL_TIMEOUT') {
        // Log timeout for telemetry with IID if available
        this.emit('model_timeout', {
          modelId,
          timeout: EXECUTION_TIMEOUT,
          tier,
          inferenceRequestId,
          timestamp: new Date()
        });
        throw new Error(`Model ${modelId} timed out after ${EXECUTION_TIMEOUT}ms${inferenceRequestId ? ` (IID: ${inferenceRequestId})` : ''}`);
      }
      
      // Track error latency too
      this.trackLatency(modelId, latency, true);
      throw error;
    }
  }

  /**
   * Decode Inference Request ID (IID) from various formats
   * Ensures proper decoding regardless of input format
   */
  decodeInferenceRequestId(iid) {
    if (!iid) return null;
    
    try {
      // If already a string, validate and clean
      if (typeof iid === 'string') {
        // Remove any URL encoding
        const decoded = decodeURIComponent(iid);
        
        // Validate UUID format if it looks like one
        if (this.isValidUUID(decoded)) {
          return decoded;
        }
        
        // Handle base64 encoded IIDs
        if (this.isBase64(decoded)) {
          const buffer = Buffer.from(decoded, 'base64');
          const decodedBase64 = buffer.toString('utf8');
          if (this.isValidUUID(decodedBase64)) {
            return decodedBase64;
          }
        }
        
        // Return cleaned string if valid
        return decoded;
      }
      
      // Handle object format IIDs
      if (typeof iid === 'object' && iid !== null) {
        // Extract ID from common object structures
        if (iid.id) return this.decodeInferenceRequestId(iid.id);
        if (iid.inferenceId) return this.decodeInferenceRequestId(iid.inferenceId);
        if (iid.requestId) return this.decodeInferenceRequestId(iid.requestId);
        if (iid.iid) return this.decodeInferenceRequestId(iid.iid);
        
        // Stringify object and try to decode
        return this.decodeInferenceRequestId(JSON.stringify(iid));
      }
      
      // Handle numeric IIDs (convert to string)
      if (typeof iid === 'number') {
        return iid.toString();
      }
      
      // Fallback: convert to string and clean
      return decodeURIComponent(String(iid));
      
    } catch (error) {
      console.warn(`[IID] Failed to decode inference request ID: ${iid}`, error.message);
      // Return original as fallback
      return typeof iid === 'string' ? iid : String(iid);
    }
  }

  /**
   * Validate UUID format
   */
  isValidUUID(uuid) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  /**
   * Check if string is base64 encoded
   */
  isBase64(str) {
    try {
      return btoa(atob(str)) === str;
    } catch (err) {
      return false;
    }
  }
  
  /**
   * Track latency with anomaly detection (NO AUTO-FALLBACK)
   */
  trackLatency(modelId, latency, isError = false) {
    const threshold = 3000; // 3s threshold
    
    // Log for anomaly detection
    const status = latency > threshold ? 'DEGRADED' : 'HEALTHY';
    
    if (status === 'DEGRADED') {
      // Increment degradation counter - BUT DO NOT FALLBACK
      this.degradationCounters = this.degradationCounters || {};
      this.degradationCounters[modelId] = (this.degradationCounters[modelId] || 0) + 1;
      
      console.log(`[LATENCY] model: ${modelId}, latency_ms: ${latency}, threshold: ${threshold}, status: DEGRADED, counter: ${this.degradationCounters[modelId]}`);
      
      // Emit for monitoring but DON'T auto-fallback
      this.emit('model_latency_degraded', {
        modelId,
        latency,
        threshold,
        degradationCount: this.degradationCounters[modelId],
        isError
      });
    } else {
      // Reset counter on healthy response
      if (this.degradationCounters?.[modelId]) {
        this.degradationCounters[modelId] = Math.max(0, this.degradationCounters[modelId] - 1);
      }
    }
    
    // Always emit for telemetry
    this.emit('latency_logged', { modelId, latency, status, isError });
  }

  /**
   * Execute with real-time priority for Enterprise
   */
  async executePriority(modelId, input, options) {
    const model = this.models.get(modelId);
    const startTime = Date.now();
    
    try {
      // Enterprise gets immediate execution
      const result = await this.executeDirect(modelId, input, options);
      
      const processingTime = Date.now() - startTime;
      
      this.emit('inference_complete', {
        modelId,
        input,
        result,
        processingTime,
        tier: 'enterprise',
        priority: 'real-time',
        inferenceRequestId: options.inferenceRequestId
      });

      return result;
    } catch (error) {
      this.emit('inference_error', {
        modelId,
        input,
        error: error.message,
        processingTime: Date.now() - startTime,
        tier: 'enterprise',
        inferenceRequestId: options.inferenceRequestId
      });
      throw error;
    }
  }

  /**
   * Execute with batched processing for Starter/Pro
   */
  async executeBatched(modelId, input, options) {
    const tier = options.tier || 'pro';
    
    // Add to batch queue
    return new Promise((resolve, reject) => {
      this.batchQueue = this.batchQueue || [];
      this.batchQueue.push({
        modelId,
        input,
        options,
        tier,
        resolve,
        reject,
        timestamp: Date.now(),
        inferenceRequestId: options.inferenceRequestId
      });
      
      // Process batch if we have enough items or timeout
      if (this.batchQueue.length >= 10 || !this.batchTimer) {
        this.processBatch();
      }
    });
  }

  /**
   * Process batched requests
   */
  async processBatch() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    
    if (!this.batchQueue || this.batchQueue.length === 0) return;
    
    const batch = this.batchQueue.splice(0, 10); // Process up to 10 at once
    
    // Group by model for efficiency
    const modelGroups = {};
    batch.forEach(request => {
      if (!modelGroups[request.modelId]) {
        modelGroups[request.modelId] = [];
      }
      modelGroups[request.modelId].push(request);
    });
    
    // Process each model group
    for (const [modelId, requests] of Object.entries(modelGroups)) {
      await this.processModelBatch(modelId, requests);
    }
    
    // Set timer for next batch if items remain
    if (this.batchQueue.length > 0 && !this.batchTimer) {
      this.batchTimer = setTimeout(() => this.processBatch(), 100);
    }
  }

  /**
   * Process batch for a specific model
   */
  async processModelBatch(modelId, requests) {
    for (const request of requests) {
      try {
        const result = await this.executeDirect(modelId, request.input, request.options);
        
        this.emit('inference_complete', {
          modelId: request.modelId,
          input: request.input,
          result,
          processingTime: Date.now() - request.timestamp,
          tier: request.tier,
          priority: 'batched',
          inferenceRequestId: request.inferenceRequestId
        });
        
        request.resolve(result);
      } catch (error) {
        this.emit('inference_error', {
          modelId: request.modelId,
          input: request.input,
          error: error.message,
          processingTime: Date.now() - request.timestamp,
          tier: request.tier,
          inferenceRequestId: request.inferenceRequestId
        });
        
        request.reject(error);
      }
    }
  }

  /**
   * Direct model execution
   */
  async executeDirect(modelId, input, options) {
    const model = this.models.get(modelId);
    const startTime = Date.now();
    
    switch (model.type) {
      case 'llama':
      case 'codellama':
        return await this.executeLlama(modelId, input, options);
      case 'distilbert':
        return await this.executeClassification(modelId, input);
      case 'tree-sitter':
        return await this.executeCodeParsing(modelId, input);
      case 'custom':
        return await this.executeCustom(modelId, input, options);
      case 'tensorflow':
        return await this.executeTensorFlow(modelId, input);
      case 'tesseract':
        return await this.executeOCR(modelId, input);
      case 'drools':
        return await this.executeRules(modelId, input);
      case 'sql':
        return await this.executeSQL(modelId, input);
      default:
        throw new Error(`Unknown model type: ${model.type}`);
    }
  }

  /**
   * Execute Llama inference
   */
  async executeLlama(modelId, input, options) {
    const model = this.models.get(modelId);
    
    // Prepare prompt
    const prompt = this.preparePrompt(input, options);
    
    // Execute with llama.cpp or similar
    const result = await this.runLlamaInference(model.path, {
      prompt,
      temperature: options.temperature || model.config.temperature,
      maxTokens: options.maxTokens || model.config.maxTokens,
      contextSize: model.config.contextSize
    });

    return {
      text: result.output,
      tokens: result.tokens,
      confidence: result.confidence || 0.95
    };
  }

  /**
   * Execute classification
   */
  async executeClassification(modelId, input) {
    const model = this.models.get(modelId);
    
    // Mock classification - would use actual model
    const scores = model.labels.map(label => ({
      label,
      score: Math.random()
    }));
    
    const prediction = scores.reduce((a, b) => a.score > b.score ? a : b);
    
    return {
      prediction: prediction.label,
      confidence: prediction.score,
      scores
    };
  }

  /**
   * Execute code parsing
   */
  async executeCodeParsing(modelId, input) {
    const model = this.models.get(modelId);
    
    // Parse code structure
    const ast = this.parseCode(input.code, input.language);
    
    return {
      ast,
      functions: this.extractFunctions(ast),
      classes: this.extractClasses(ast),
      imports: this.extractImports(ast),
      complexity: this.calculateComplexity(ast)
    };
  }

  /**
   * Execute custom model
   */
  async executeCustom(modelId, input, options) {
    const model = this.models.get(modelId);
    
    // Execute custom model process
    return await this.runCustomModel(model.path, input, model.config);
  }

  /**
   * Execute TensorFlow model
   */
  async executeTensorFlow(modelId, input) {
    const model = this.models.get(modelId);
    
    // Prepare features
    const features = this.extractFeatures(input, model.features);
    
    // Run inference
    const prediction = await this.runTensorFlowInference(model.path, features);
    
    return {
      prediction,
      confidence: prediction.confidence || 0.8
    };
  }

  /**
   * Execute OCR
   */
  async executeOCR(modelId, input) {
    const model = this.models.get(modelId);
    
    // Run Tesseract or similar
    const text = await this.runOCR(input.imageUrl, model.languages);
    
    return {
      text,
      confidence: text.confidence || 0.9,
      words: text.words
    };
  }

  /**
   * Execute rule engine
   */
  async executeRules(modelId, input) {
    const model = this.models.get(modelId);
    
    // Evaluate rules
    const results = this.evaluateRules(model.rules, input);
    
    return {
      matched: results.matched,
      actions: results.actions,
      facts: results.facts
    };
  }

  /**
   * Prepare prompt for Llama models
   */
  preparePrompt(input, options) {
    if (typeof input === 'string') {
      return input;
    }
    
    // Build structured prompt
    let prompt = '';
    
    if (input.system) {
      prompt += `System: ${input.system}\n`;
    }
    
    if (input.task) {
      prompt += `Task: ${input.task}\n`;
    }
    
    if (input.context) {
      prompt += `Context: ${JSON.stringify(input.context)}\n`;
    }
    
    if (input.instruction) {
      prompt += `Instruction: ${input.instruction}\n`;
    }
    
    prompt += '\nResponse:';
    
    return prompt;
  }

  /**
   * Run Llama inference process
   */
  async runLlamaInference(modelPath, params) {
    return new Promise((resolve, reject) => {
      const args = [
        '-m', modelPath,
        '-p', params.prompt,
        '--temp', params.temperature.toString(),
        '-n', params.maxTokens.toString(),
        '-c', params.contextSize.toString()
      ];
      
      const process = spawn('./bin/main', args);
      let output = '';
      
      process.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve({
            output: output.trim(),
            tokens: output.split(' ').length,
            confidence: 0.95
          });
        } else {
          reject(new Error(`Llama process exited with code ${code}`));
        }
      });
      
      process.on('error', reject);
    });
  }

  /**
   * Parse code into AST
   */
  parseCode(code, language) {
    // Mock AST generation
    return {
      type: 'Program',
      body: [],
      language
    };
  }

  /**
   * Extract functions from AST
   */
  extractFunctions(ast) {
    // Mock function extraction
    return [];
  }

  /**
   * Extract classes from AST
   */
  extractClasses(ast) {
    // Mock class extraction
    return [];
  }

  /**
   * Extract imports from AST
   */
  extractImports(ast) {
    // Mock import extraction
    return [];
  }

  /**
   * Calculate code complexity
   */
  calculateComplexity(ast) {
    // Mock complexity calculation
    return Math.floor(Math.random() * 50) + 1;
  }

  /**
   * Run custom model process
   */
  async runCustomModel(modelPath, input, config) {
    return new Promise((resolve, reject) => {
      const process = spawn('python', [modelPath, JSON.stringify(input)]);
      let output = '';
      
      process.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          try {
            resolve(JSON.parse(output));
          } catch (e) {
            reject(new Error('Invalid JSON output from custom model'));
          }
        } else {
          reject(new Error(`Custom model process exited with code ${code}`));
        }
      });
      
      process.on('error', reject);
    });
  }

  /**
   * Extract features for TensorFlow
   */
  extractFeatures(input, featureNames) {
    return featureNames.map(name => input[name] || 0);
  }

  /**
   * Run TensorFlow inference
   */
  async runTensorFlowInference(modelPath, features) {
    // Mock TensorFlow inference
    return {
      prediction: Math.random(),
      confidence: 0.85
    };
  }

  /**
   * Run OCR
   */
  async runOCR(imageUrl, languages) {
    // Mock OCR result
    return {
      text: 'Extracted text from image',
      confidence: 0.92,
      words: []
    };
  }

  /**
   * Evaluate rules
   */
  evaluateRules(rules, input) {
    // Mock rule evaluation
    return {
      matched: ['rule1', 'rule2'],
      actions: ['action1', 'action2'],
      facts: { fact1: true, fact2: false }
    };
  }

  /**
   * Execute SQL model
   */
  async executeSQL(modelId, input) {
    const model = this.models.get(modelId);
    
    // Generate SQL based on input
    const sql = this.generateSQL(input.query, input.schema, model.dialects[0]);
    
    return {
      sql,
      dialect: model.dialects[0],
      confidence: 0.85,
      optimized: true
    };
  }

  /**
   * Generate SQL query
   */
  generateSQL(query, schema, dialect) {
    // Mock SQL generation
    return `SELECT * FROM table WHERE condition = '${query}'`;
  }

  /**
   * Download model if not exists
   */
  async downloadModel(modelId, modelPath) {
    console.log(`Downloading model ${modelId}...`);
    // Implementation would download from model repository
  }

  /**
   * Get model status
   */
  getModelStatus() {
    const status = {};
    
    for (const [modelId, model] of this.models) {
      status[modelId] = {
        type: model.type,
        loaded: model.loaded,
        path: model.path
      };
    }
    
    return status;
  }

  /**
   * Unload model to free memory
   */
  async unloadModel(modelId) {
    const model = this.models.get(modelId);
    if (model && model.process) {
      model.process.kill();
      this.models.delete(modelId);
      console.log(`Model unloaded: ${modelId}`);
    }
  }

  /**
   * Check if model is disabled by circuit breaker
   */
  isCircuitBreakerOpen(modelId) {
    const cb = this.circuitBreakers.get(modelId);
    if (!cb) return false;
    
    const now = Date.now();
    
    // Reset if window has passed
    if (now - cb.lastFailure > this.fallbackConfig.circuitBreakerWindow) {
      cb.failures = 0;
      cb.disabled = false;
      return false;
    }
    
    return cb.disabled;
  }
  
  /**
   * Record failure for circuit breaker
   */
  recordFailure(modelId) {
    const now = Date.now();
    let cb = this.circuitBreakers.get(modelId);
    
    if (!cb) {
      cb = { failures: 0, lastFailure: now, disabled: false };
    }
    
    // Reset if outside window
    if (now - cb.lastFailure > this.fallbackConfig.circuitBreakerWindow) {
      cb.failures = 0;
    }
    
    cb.failures++;
    cb.lastFailure = now;
    
    // Trip circuit breaker if threshold reached
    if (cb.failures >= this.fallbackConfig.circuitBreakerThreshold) {
      cb.disabled = true;
      console.log(`[CIRCUIT BREAKER] Model ${modelId} disabled after ${cb.failures} failures`);
      this.emit('circuit_breaker_tripped', { modelId, failures: cb.failures });
    }
    
    this.circuitBreakers.set(modelId, cb);
  }
  
  /**
   * Get fallback depth for request chain
   */
  getFallbackDepth(requestId) {
    return this.fallbackChains.get(requestId) || 0;
  }
  
  /**
   * Increment fallback depth
   */
  incrementFallbackDepth(requestId) {
    const current = this.getFallbackDepth(requestId);
    this.fallbackChains.set(requestId, current + 1);
    return current + 1;
  }
  
  /**
   * Check if we can still fallback
   */
  canFallback(requestId) {
    return this.getFallbackDepth(requestId) < this.fallbackConfig.maxDepth;
  }
  
  /**
   * Clear fallback chain tracking
   */
  clearFallbackChain(requestId) {
    this.fallbackChains.delete(requestId);
  }

  /**
   * CLOUD FAILOVER: Execute via Firebase Cloud Functions when local hardware is overloaded
   */
  async executeFirebaseFailover(modelId, input, options) {
    if (!this.cloudFailover.enabled || !this.cloudFailover.firebaseFunctionsUrl) {
      throw new Error('Firebase failover not configured');
    }
    
    const startTime = Date.now();
    
    try {
      console.log(`[CLOUD] ☁️ Failover to Firebase Functions for ${modelId}`);
      
      const response = await fetch(`${this.cloudFailover.firebaseFunctionsUrl}/modelInference`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId, input, options }),
        timeout: 30000 // 30 second timeout for cloud
      });
      
      if (!response.ok) {
        throw new Error(`Firebase Functions returned ${response.status}`);
      }
      
      const result = await response.json();
      
      const latency = Date.now() - startTime;
      this.cloudFailover.failoverCount++;
      this.cloudFailover.lastFailover = Date.now();
      
      console.log(`[CLOUD] ✅ Firebase response in ${latency}ms`);
      
      this.emit('cloud_failover_success', {
        modelId,
        latency,
        timestamp: new Date()
      });
      
      return result;
    } catch (error) {
      console.error(`[CLOUD] ❌ Firebase failover failed:`, error.message);
      this.emit('cloud_failover_error', { modelId, error: error.message });
      throw error;
    }
  }

  /**
   * AI STUDIO SAFETY VALVE: Final tier fallback to Gemini when all local models fail
   */
  async executeGeminiSafetyValve(input, options) {
    if (!this.cloudFailover.geminiApiKey) {
      throw new Error('Gemini API key not configured');
    }
    
    const startTime = Date.now();
    
    try {
      console.log(`[AI STUDIO] 🤖 Safety valve - calling Gemini API`);
      
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.cloudFailover.geminiApiKey
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: input.prompt || input }]
          }],
          generationConfig: {
            temperature: options.temperature || 0.7,
            maxOutputTokens: options.maxTokens || 2048
          }
        }),
        timeout: 15000 // 15 second timeout
      });
      
      if (!response.ok) {
        throw new Error(`Gemini API returned ${response.status}`);
      }
      
      const data = await response.json();
      const latency = Date.now() - startTime;
      
      console.log(`[AI STUDIO] ✅ Gemini response in ${latency}ms`);
      
      this.emit('gemini_safety_valve_used', {
        latency,
        timestamp: new Date()
      });
      
      return {
        text: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
        model: 'gemini-pro',
        latency,
        source: 'ai_studio_safety_valve'
      };
    } catch (error) {
      console.error(`[AI STUDIO] ❌ Gemini safety valve failed:`, error.message);
      throw error;
    }
  }

  /**
   * Check if we should failover to cloud based on latency
   */
  shouldFailoverToCloud(latencyMs) {
    if (!this.cloudFailover.enabled) return false;
    
    // Failover if local latency exceeds threshold
    if (latencyMs > this.cloudFailover.latencyThreshold) {
      console.log(`[FAILOVER] Local latency ${latencyMs}ms exceeds threshold ${this.cloudFailover.latencyThreshold}ms`);
      return true;
    }
    
    // Failover if all local models are circuit-broken
    const allModelsBroken = Array.from(this.models.keys()).every(modelId => 
      this.isCircuitBreakerOpen(modelId)
    );
    
    if (allModelsBroken) {
      console.log(`[FAILOVER] All local models circuit-broken, using cloud`);
      return true;
    }
    
    return false;
  }

  /**
   * Start system monitoring for Dynamic Concurrency Scaling
   */
  startSystemMonitoring() {
    console.log('[SYSTEM] Starting Dynamic Concurrency Scaling monitor...');
    
    setInterval(async () => {
      try {
        const temp = await this.getCpuTemperature();
        const cpu = await this.getCpuUsage();
        
        this.systemMonitor.currentTemp = temp;
        this.systemMonitor.currentCpu = cpu;
        
        // LOCKED: Dynamic throttling - temp >= 80°C or CPU >= 90%
        if (temp >= 80 || cpu >= 90) {
          if (!this.systemMonitor.throttlingActive) {
            console.log(`[SYSTEM] 🔥 THROTTLING ACTIVATED - Temp: ${temp}°C, CPU: ${cpu}%`);
            this.systemMonitor.throttlingActive = true;
            this.throttleStarterRequests();
          }
        } else if ((temp < 70 && cpu < 75) && this.systemMonitor.throttlingActive) {
          console.log(`[SYSTEM] 🧊 THROTTLING DEACTIVATED - Temp: ${temp}°C, CPU: ${cpu}%`);
          this.systemMonitor.throttlingActive = false;
          this.restoreNormalProcessing();
        }
      } catch (error) {
        console.error('[SYSTEM] Monitoring error:', error.message);
      }
    }, 5000); // Check every 5 seconds
  }

  /**
   * Throttle Starter tier batch processing to 50% speed
   */
  throttleStarterRequests() {
    this.systemMonitor.batchProcessingDelay = 200; // Double delay
    this.systemMonitor.maxBatchSize = 5; // Reduce from 10 to 5
    this.systemMonitor.enterprisePriority = true;
    
    this.emit('throttling_activated', {
      reason: 'high_load',
      temp: this.systemMonitor.currentTemp,
      cpu: this.systemMonitor.currentCpu,
      timestamp: new Date()
    });
    
    console.log('[SYSTEM] Starter tier throttled: 50% speed, Enterprise priority enabled');
  }

  /**
   * Restore normal processing speeds
   */
  restoreNormalProcessing() {
    this.systemMonitor.batchProcessingDelay = 100;
    this.systemMonitor.maxBatchSize = 10;
    this.systemMonitor.enterprisePriority = false;
    
    this.emit('throttling_deactivated', {
      temp: this.systemMonitor.currentTemp,
      cpu: this.systemMonitor.currentCpu,
      timestamp: new Date()
    });
    
    console.log('[SYSTEM] Normal processing restored');
  }

  /**
   * Get CPU temperature
   */
  async getCpuTemperature() {
    try {
      // Windows implementation
      if (process.platform === 'win32') {
        const { execSync } = require('child_process');
        // Use WMIC for Windows
        const output = execSync('wmic /namespace:\\\\\root\\wmi PATH MSAcpi_ThermalZoneTemperature get CurrentTemperature 2>nul', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        const temps = output.split('\n')
          .filter(line => line.trim() && !isNaN(parseInt(line.trim())))
          .map(line => (parseInt(line.trim()) - 2732) / 10); // Kelvin*10 to Celsius
        return temps.length > 0 ? temps.reduce((a, b) => a + b, 0) / temps.length : 0;
      }
      
      // Linux implementation
      const { execSync } = require('child_process');
      const output = execSync('sensors 2>/dev/null | grep -E "Core|Package|Tctl" | awk \'{print $2}\' | cut -c2-5 | head -1', { encoding: 'utf8' });
      const temp = parseFloat(output.trim());
      return isNaN(temp) ? 0 : temp;
    } catch {
      return 0;
    }
  }

  /**
   * Get CPU usage
   */
  async getCpuUsage() {
    try {
      const os = require('os');
      const cpus = os.cpus();
      let totalIdle = 0;
      let totalTick = 0;
      
      cpus.forEach(cpu => {
        for (const type in cpu.times) {
          totalTick += cpu.times[type];
        }
        totalIdle += cpu.times.idle;
      });
      
      const totalUsed = totalTick - totalIdle;
      return (totalUsed / totalTick) * 100;
    } catch {
      return 0;
    }
  }

  /**
   * Start hung model monitor
   */
  startHungModelMonitor() {
    console.log('[SYSTEM] Starting hung model monitor...');
    
    setInterval(() => {
      this.modelProcesses.forEach((process, modelId) => {
        if (process.lastActivity && (Date.now() - process.lastActivity) > this.systemMonitor.hungModelTimeout) {
          console.log(`[RECOVERY] Model ${modelId} hung detected, initiating recovery...`);
          this.handleHungModel(modelId);
        }
      });
    }, 10000); // Check every 10 seconds
  }

  /**
   * Handle hung model recovery
   */
  async handleHungModel(modelId) {
    console.log(`[RECOVERY] Initiating recovery for hung model: ${modelId}`);
    
    // Kill the hung model process
    if (this.modelProcesses.has(modelId)) {
      const process = this.modelProcesses.get(modelId);
      try {
        process.kill('SIGKILL');
      } catch (e) {
        console.log(`[RECOVERY] Process already terminated: ${modelId}`);
      }
      this.modelProcesses.delete(modelId);
    }
    
    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Reload the model
    try {
      const config = this.modelConfigs[modelId];
      if (config) {
        await this.loadModel(modelId, config);
        console.log(`[RECOVERY] ✅ Model ${modelId} recovered successfully`);
        
        this.emit('model_recovered', {
          modelId,
          timestamp: new Date(),
          recoveryType: 'hung_process'
        });
        
        return true;
      }
    } catch (error) {
      console.error(`[RECOVERY] ❌ Failed to recover model ${modelId}:`, error.message);
      
      this.emit('model_recovery_failed', {
        modelId,
        error: error.message,
        timestamp: new Date()
      });
      
      return false;
    }
  }

  /**
   * Shutdown all models
   */
  async shutdown() {
    console.log('Shutting down local models...');
    
    for (const [modelId, model] of this.models) {
      if (model.process) {
        model.process.kill();
      }
    }
    
    this.models.clear();
    console.log('All models shut down');
  }
}

module.exports = LocalModelAdapter;
