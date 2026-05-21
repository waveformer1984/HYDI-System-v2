#!/usr/bin/env node

/**
 * Local Model Integration Engine
 *
 * Provides autonomous decision-making for the HYDI system using lightweight
 * local inference capabilities. Supports multiple model backends:
 * - Ollama (local LLM inference)
 * - TensorFlow.js (browser/Node.js ML)
 * - Simple decision trees (no external deps)
 *
 * This module bridges the gap between task execution and intelligent decision-making.
 */

const http = require('http');

class LocalModelIntegrationEngine {
  constructor(config = {}) {
    this.config = {
      modelBackend: config.modelBackend || 'decision-tree', // 'ollama', 'tensorflow', 'decision-tree'
      ollamaHost: config.ollamaHost || 'http://localhost:11434',
      timeout: config.timeout || 5000,
      enableCaching: config.enableCaching !== false,
      cacheSize: config.cacheSize || 1000,
      ...config
    };

    this.cache = new Map();
    this.modelStatus = 'uninitialized';
    this.inferenceStats = {
      total_inferences: 0,
      cache_hits: 0,
      cache_misses: 0,
      average_latency: 0,
      model_errors: 0
    };

    this.decisionRules = this.initializeDecisionRules();
  }

  /**
   * Initialize with built-in decision rules for common tasks
   * This enables autonomous decision-making without external models
   */
  initializeDecisionRules() {
    return {
      // Task classification and routing
      taskClassification: {
        'analysis': { type: 'analysis', priority: 'medium', timeout: 30000 },
        'outreach': { type: 'outreach', priority: 'low', timeout: 60000 },
        'cad': { type: 'cad', priority: 'high', timeout: 120000 },
        'audio': { type: 'audio', priority: 'medium', timeout: 45000 },
        'error': { type: 'error', priority: 'critical', timeout: 10000 },
        'task': { type: 'task', priority: 'normal', timeout: 30000 },
        'info': { type: 'info', priority: 'low', timeout: 10000 }
      },

      // Decision rules for event processing
      eventProcessing: {
        severity_mapping: {
          'critical': 1,
          'high': 2,
          'medium': 3,
          'low': 4
        },
        retry_thresholds: {
          'critical': 5,
          'high': 3,
          'medium': 2,
          'low': 1
        },
        backoff_multiplier: 2,
        max_backoff: 60000
      },

      // Resource allocation rules
      resourceAllocation: {
        cpu_intensive: ['cad', 'analysis'],
        io_intensive: ['audio', 'outreach'],
        memory_intensive: ['analysis'],
        network_intensive: ['outreach']
      },

      // Failure recovery strategies
      failureRecovery: {
        transient_errors: ['timeout', 'connection_refused'],
        permanent_errors: ['validation_failed', 'schema_mismatch'],
        recovery_actions: {
          'timeout': 'retry_with_backoff',
          'connection_refused': 'queue_and_retry',
          'validation_failed': 'log_and_skip',
          'schema_mismatch': 'alert_and_skip'
        }
      }
    };
  }

  /**
   * Initialize the model backend
   */
  async initialize() {
    console.log(`[LocalModel] Initializing ${this.config.modelBackend} backend...`);

    try {
      switch (this.config.modelBackend) {
        case 'ollama':
          await this.initializeOllama();
          break;
        case 'tensorflow':
          await this.initializeTensorFlow();
          break;
        case 'decision-tree':
          this.initializeDecisionTree();
          break;
        default:
          throw new Error(`Unknown model backend: ${this.config.modelBackend}`);
      }

      this.modelStatus = 'ready';
      console.log(`[LocalModel] Model initialized and ready`);
      return true;
    } catch (error) {
      this.modelStatus = 'failed';
      console.error(`[LocalModel] Initialization failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Initialize Ollama backend
   */
  async initializeOllama() {
    try {
      const response = await this.makeRequest('GET', '/api/tags', {});
      if (response.models && response.models.length > 0) {
        console.log(`[LocalModel] Found ${response.models.length} models in Ollama`);
        this.availableModels = response.models.map(m => m.name);
        this.activeModel = this.availableModels[0];
      } else {
        throw new Error('No models available in Ollama');
      }
    } catch (error) {
      throw new Error(`Ollama connection failed: ${error.message}`);
    }
  }

  /**
   * Initialize TensorFlow backend
   */
  async initializeTensorFlow() {
    try {
      // In a real implementation, would load TensorFlow.js
      console.log('[LocalModel] TensorFlow backend selected (simulated)');
      this.modelStatus = 'ready';
    } catch (error) {
      throw new Error(`TensorFlow initialization failed: ${error.message}`);
    }
  }

  /**
   * Initialize decision tree backend (no external deps)
   */
  initializeDecisionTree() {
    console.log('[LocalModel] Decision tree engine initialized');
    this.modelStatus = 'ready';
  }

  /**
   * Classify an event and generate decision
   */
  async classify(event) {
    const cacheKey = `classify:${JSON.stringify(event).substring(0, 100)}`;

    // Check cache first
    if (this.config.enableCaching && this.cache.has(cacheKey)) {
      this.inferenceStats.cache_hits++;
      return this.cache.get(cacheKey);
    }

    this.inferenceStats.cache_misses++;
    this.inferenceStats.total_inferences++;

    try {
      let classification;

      switch (this.config.modelBackend) {
        case 'ollama':
          classification = await this.classifyWithOllama(event);
          break;
        case 'tensorflow':
          classification = await this.classifyWithTensorFlow(event);
          break;
        case 'decision-tree':
          classification = await this.classifyWithDecisionTree(event);
          break;
      }

      // Cache the result
      if (this.config.enableCaching && this.cache.size < this.config.cacheSize) {
        this.cache.set(cacheKey, classification);
      }

      return classification;
    } catch (error) {
      this.inferenceStats.model_errors++;
      console.error(`[LocalModel] Classification failed: ${error.message}`);
      return this.getDefaultClassification(event);
    }
  }

  /**
   * Classify using Ollama (local LLM)
   */
  async classifyWithOllama(event) {
    const prompt = this.buildClassificationPrompt(event);

    try {
      const response = await this.makeRequest('POST', '/api/generate', {
        model: this.activeModel,
        prompt: prompt,
        stream: false,
        temperature: 0.3,
        top_p: 0.8
      });

      return this.parseOllamaResponse(response, event);
    } catch (error) {
      throw new Error(`Ollama classification failed: ${error.message}`);
    }
  }

  /**
   * Classify using decision tree rules
   */
  async classifyWithDecisionTree(event) {
    const rules = this.decisionRules;

    // Route based on event type
    const classification = {
      event_id: event.event_id || 'unknown',
      type: event.type,
      confidence: 0.95,
      decision: null,
      reasoning: [],
      routing: null,
      priority: 'normal',
      estimated_duration: 30000,
      resource_hints: [],
      retry_strategy: null
    };

    // Get task classification
    if (rules.taskClassification[event.type]) {
      const taskInfo = rules.taskClassification[event.type];
      classification.priority = taskInfo.priority;
      classification.estimated_duration = taskInfo.timeout;
      classification.decision = `Execute as ${taskInfo.type}`;
      classification.reasoning.push(`Matched task type: ${event.type}`);
    }

    // Determine resource hints
    if (rules.resourceAllocation.cpu_intensive.includes(event.type)) {
      classification.resource_hints.push('cpu_intensive');
    }
    if (rules.resourceAllocation.io_intensive.includes(event.type)) {
      classification.resource_hints.push('io_intensive');
    }

    // Set retry strategy based on severity
    if (event.severity) {
      const severity = event.severity.toLowerCase();
      const retries = rules.eventProcessing.retry_thresholds[severity] || 2;
      classification.retry_strategy = {
        max_retries: retries,
        backoff_multiplier: rules.eventProcessing.backoff_multiplier,
        max_backoff: rules.eventProcessing.max_backoff
      };
      classification.reasoning.push(`Severity: ${severity}, max retries: ${retries}`);
    }

    // Payload analysis
    if (event.payload) {
      const payloadSize = JSON.stringify(event.payload).length;
      if (payloadSize > 1000000) {
        classification.resource_hints.push('large_payload');
        classification.reasoning.push('Large payload detected - may require streaming');
      }
    }

    classification.routing = {
      handler: event.type,
      queue: `queue_${event.type}`,
      priority_queue: classification.priority === 'critical'
    };

    return classification;
  }

  /**
   * TensorFlow classification (stub for extensibility)
   */
  async classifyWithTensorFlow(event) {
    // Placeholder for TensorFlow implementation
    return this.classifyWithDecisionTree(event);
  }

  /**
   * Build classification prompt for LLM
   */
  buildClassificationPrompt(event) {
    return `Classify and route this event:

Event Type: ${event.type}
Severity: ${event.severity || 'normal'}
Payload: ${JSON.stringify(event.payload).substring(0, 200)}

Provide:
1. Priority (critical, high, medium, low)
2. Routing decision
3. Retry strategy
4. Resource hints

Respond in JSON format.`;
  }

  /**
   * Parse Ollama response
   */
  parseOllamaResponse(response, event) {
    try {
      const text = response.response || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          event_id: event.event_id,
          type: event.type,
          confidence: 0.85,
          decision: parsed.decision || 'execute',
          reasoning: parsed.reasoning || [],
          priority: parsed.priority || 'normal',
          estimated_duration: parsed.estimated_duration || 30000,
          resource_hints: parsed.resource_hints || [],
          retry_strategy: parsed.retry_strategy || null
        };
      }
    } catch (error) {
      console.error(`[LocalModel] Failed to parse Ollama response: ${error.message}`);
    }

    return this.getDefaultClassification(event);
  }

  /**
   * Get default classification when model fails
   */
  getDefaultClassification(event) {
    return {
      event_id: event.event_id || 'unknown',
      type: event.type,
      confidence: 0.5,
      decision: 'execute_with_caution',
      reasoning: ['Using fallback classification due to model error'],
      priority: 'normal',
      estimated_duration: 30000,
      resource_hints: [],
      retry_strategy: {
        max_retries: 2,
        backoff_multiplier: 2,
        max_backoff: 60000
      }
    };
  }

  /**
   * Generate decision for task execution
   */
  async generateDecision(event, context = {}) {
    const classification = await this.classify(event);

    const decision = {
      event_id: event.event_id,
      type: event.type,
      timestamp: new Date().toISOString(),
      classification: classification,
      actions: [],
      constraints: [],
      monitoring: []
    };

    // Generate actions based on classification
    decision.actions.push({
      action: 'route_to_handler',
      handler: classification.routing?.handler,
      queue: classification.routing?.queue,
      priority: classification.priority
    });

    // Add constraints
    if (classification.resource_hints.includes('cpu_intensive')) {
      decision.constraints.push('limit_concurrent_execution');
      decision.constraints.push('monitor_cpu_usage');
    }

    if (classification.resource_hints.includes('large_payload')) {
      decision.constraints.push('stream_large_payloads');
      decision.constraints.push('implement_compression');
    }

    // Add monitoring
    decision.monitoring.push({
      metric: 'execution_duration',
      expected: classification.estimated_duration,
      alert_threshold: classification.estimated_duration * 2
    });

    if (classification.priority === 'critical') {
      decision.monitoring.push({
        metric: 'error_rate',
        alert_threshold: 0.05
      });
    }

    return decision;
  }

  /**
   * Analyze task performance and recommend optimizations
   */
  async analyzePerformance(taskMetrics) {
    const analysis = {
      timestamp: new Date().toISOString(),
      total_tasks: taskMetrics.total || 0,
      successful: taskMetrics.successful || 0,
      failed: taskMetrics.failed || 0,
      success_rate: 0,
      average_latency: taskMetrics.average_latency || 0,
      recommendations: []
    };

    if (analysis.total_tasks > 0) {
      analysis.success_rate = analysis.successful / analysis.total_tasks;
    }

    // Generate recommendations based on metrics
    if (analysis.success_rate < 0.9) {
      analysis.recommendations.push({
        type: 'critical',
        issue: 'Low success rate',
        action: 'Review error patterns and increase retry limits'
      });
    }

    if (analysis.average_latency > 10000) {
      analysis.recommendations.push({
        type: 'warning',
        issue: 'High average latency',
        action: 'Consider horizontal scaling or optimize task processing'
      });
    }

    return analysis;
  }

  /**
   * HTTP utility for Ollama communication
   */
  makeRequest(method, path, data) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.config.ollamaHost);
      const options = {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: this.config.timeout
      };

      const req = http.request(options, (res) => {
        let responseData = '';

        res.on('data', chunk => {
          responseData += chunk;
        });

        res.on('end', () => {
          try {
            const parsed = JSON.parse(responseData);
            resolve(parsed);
          } catch (error) {
            reject(new Error(`Invalid JSON response: ${error.message}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (method === 'POST' && data) {
        req.write(JSON.stringify(data));
      }

      req.end();
    });
  }

  /**
   * Get inference statistics
   */
  getStats() {
    const totalInferences = this.inferenceStats.total_inferences;
    const avgLatency = totalInferences > 0
      ? this.inferenceStats.average_latency / totalInferences
      : 0;

    return {
      ...this.inferenceStats,
      average_latency: avgLatency.toFixed(2),
      cache_size: this.cache.size,
      model_backend: this.config.modelBackend,
      status: this.modelStatus
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.inferenceStats = {
      total_inferences: 0,
      cache_hits: 0,
      cache_misses: 0,
      average_latency: 0,
      model_errors: 0
    };
    this.cache.clear();
  }

  /**
   * Health check
   */
  async healthCheck() {
    const health = {
      status: this.modelStatus,
      timestamp: new Date().toISOString(),
      backend: this.config.modelBackend,
      cache_utilization: (this.cache.size / this.config.cacheSize * 100).toFixed(2) + '%',
      inference_stats: this.getStats()
    };

    if (this.config.modelBackend === 'ollama') {
      try {
        const response = await this.makeRequest('GET', '/api/tags', {});
        health.available_models = response.models?.length || 0;
        health.active_model = this.activeModel;
      } catch (error) {
        health.ollama_error = error.message;
      }
    }

    return health;
  }
}

// Export for use in other modules
module.exports = { LocalModelIntegrationEngine };

// CLI interface for testing
if (require.main === module) {
  (async () => {
    const engine = new LocalModelIntegrationEngine({
      modelBackend: 'decision-tree'
    });

    await engine.initialize();

    // Test classification
    const testEvent = {
      event_id: 'test-001',
      type: 'analysis',
      severity: 'high',
      payload: { data: 'test data' }
    };

    console.log('\n=== LOCAL MODEL INTEGRATION TEST ===\n');
    console.log('Input Event:');
    console.log(JSON.stringify(testEvent, null, 2));

    const classification = await engine.classify(testEvent);
    console.log('\nClassification Result:');
    console.log(JSON.stringify(classification, null, 2));

    const decision = await engine.generateDecision(testEvent);
    console.log('\nGenerated Decision:');
    console.log(JSON.stringify(decision, null, 2));

    const stats = engine.getStats();
    console.log('\nInference Statistics:');
    console.log(JSON.stringify(stats, null, 2));

    const health = await engine.healthCheck();
    console.log('\nHealth Check:');
    console.log(JSON.stringify(health, null, 2));
  })().catch(console.error);
}
