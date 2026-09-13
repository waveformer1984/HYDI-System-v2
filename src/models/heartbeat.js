/**
 * Ursula Local Model Heartbeat Script
 * Monitors local model health and triggers recovery if models hang or stop responding
 * Designed to close the "Silent Failure" gap in Ursula's local model execution
 */

const LocalModelAdapter = require('./local-model-adapter');
const { supabase } = require('../database');
const EventEmitter = require('events');

class UrsulaModelHeartbeat extends EventEmitter {
  constructor() {
    super();
    this.adapter = null;
    this.heartbeatInterval = null;
    this.isChecking = false;
    this.failedModels = new Map();
    this.lastCheckTime = null;
    this._starting = false;
    this._destroyed = false;
    this._startupTimeout = null;
    this._startupResolve = null;
    this._startupReject = null;
    
    // Configuration
    this.config = {
      checkInterval: 30000, // 30 seconds
      maxConsecutiveFailures: 3,
      timeoutThreshold: 45000, // 45 seconds
      modelsToMonitor: [ // Key models that should always be responsive
        'gpt-4-local',
        'gpt-35-turbo',
        'local-llama',
        'local-classifier',
        'document-summarizer', // Using the service name that maps to local-llama
        'sentiment-analyzer'   // Using the service name that maps to local-classifier
      ]
    };

    // Service-name aliases -> the real LocalModelAdapter model id that backs them.
    // 'document-summarizer' and 'sentiment-analyzer' above are monitored under their
    // service names, but LocalModelAdapter only ever registers/loads the real model ids
    // ('local-llama', 'local-classifier', ...) -- it never learned these aliases. Every
    // health check and recovery attempt must resolve through this map before touching
    // the adapter, or every call fails with "not loaded" / "No configuration found".
    this.serviceModelMap = {
      'document-summarizer': 'local-llama',
      'sentiment-analyzer': 'local-classifier',
      'seo-article-generator': 'gpt-4-local',
      'social-post-creator': 'gpt-35-turbo',
      'code-reviewer': 'code-specialist',
      'api-doc-generator': 'code-parser',
      'test-generator': 'code-specialist',
      'bug-detector': 'bug-finder',
      'database-optimizer': 'db-specialist',
      'security-auditor': 'security-scanner',
      'invoice-processor': 'local-ocr',
      'survey-analyzer': 'gpt-35-turbo',
      'lead-qualifier': 'gpt-4-local',
      'appointment-scheduler': 'rule-engine',
      'follow-up-automator': 'gpt-35-turbo',
      'ticket-triage': 'local-classifier',
      'inventory-optimizer': 'predictive-model',
      'price-optimizer': 'pricing-engine',
      'email-automator': 'gpt-35-turbo',
      'report-generator': 'gpt-4-local'
    };
  }

  /**
   * Resolve a monitored model id (which may be a service-name alias like
   * 'document-summarizer') to the real LocalModelAdapter model id that backs it.
   * Returns the input unchanged if it isn't an alias.
   * @param {string} modelId
   * @returns {string}
   */
  resolveModelId(modelId) {
    return this.serviceModelMap[modelId] || modelId;
  }

  /**
   * Start the heartbeat monitoring
   */
  async start() {
    if (this.heartbeatInterval || this._starting) {
      console.log('[HEARTBEAT] Already running or starting');
      return;
    }
    this._starting = true;
    this._destroyed = false;

    try {
      console.log('[HEARTBEAT] Initializing Local Model Adapter...');
      this.adapter = new LocalModelAdapter();
      
      // Wait a bit for models to initialize
      await new Promise((resolve, reject) => {
        this._startupResolve = resolve;
        this._startupReject = reject;
        this._startupTimeout = setTimeout(() => {
          this._startupTimeout = null;
          this._startupResolve = null;
          this._startupReject = null;
          resolve();
        }, 5000);
      });
      
      // stop() may have been called while we were waiting
      if (!this._starting) {
        return;
      }
      
      console.log('[HEARTBEAT] Starting heartbeat monitoring...');
      this.heartbeatInterval = setInterval(() => {
        this.checkModelHealth();
      }, this.config.checkInterval);
      
      // Do an immediate check
      await this.checkModelHealth();
      
      this.emit('heartbeat_started');
      console.log('[HEARTBEAT] ✅ Heartbeat monitoring started');
    } catch (error) {
      console.error('[HEARTBEAT] ❌ Failed to start heartbeat:', error.message);
      this.emit('heartbeat_error', { error: error.message });
    } finally {
      this._starting = false;
      this._startupTimeout = null;
      this._startupResolve = null;
      this._startupReject = null;
    }
  }

  /**
   * Stop the heartbeat monitoring
   */
  async stop() {
    this._destroyed = true;
    if (this._startupTimeout) {
      clearTimeout(this._startupTimeout);
      if (this._startupResolve) {
        this._startupResolve();
        this._startupResolve = null;
        this._startupReject = null;
      }
      this._startupTimeout = null;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.adapter) {
      await this.adapter.destroy();
      this.adapter = null;
    }
    this.isChecking = false;
    this.failedModels.clear();
    this._starting = false;
    console.log('[HEARTBEAT] Heartbeat monitoring stopped');
    this.emit('heartbeat_stopped');
  }

  /**
   * Check the health of all monitored models
   */
  async checkModelHealth() {
    if (this.isChecking || !this.adapter || this._destroyed) return;
    
    this.isChecking = true;
    this.lastCheckTime = new Date();
    
    try {
      console.log(`[HEARTBEAT] 🔍 Checking model health at ${this.lastCheckTime.toISOString()}`);
      if (this._destroyed) return;
      
      const results = await this.checkAllModels();
      if (this._destroyed) return;
      const failedModels = results.filter(r => !r.healthy);
      
      // Update failed models tracking
      failedModels.forEach(result => {
        const modelKey = result.modelId;
        if (!this.failedModels.has(modelKey)) {
          this.failedModels.set(modelKey, 1);
        } else {
          const count = this.failedModels.get(modelKey) + 1;
          this.failedModels.set(modelKey, count);
        }
      });
      
      // Remove models that are now healthy from failed tracking
      results
        .filter(r => r.healthy)
        .forEach(result => this.failedModels.delete(result.modelId));
      
      // Handle models that have failed too many times
      const criticallyFailed = [];
      this.failedModels.forEach((count, modelId) => {
        if (count >= this.config.maxConsecutiveFailures) {
          criticallyFailed.push(modelId);
        }
      });
      
      if (criticallyFailed.length > 0) {
        if (this._destroyed) return;
        console.log(`[HEARTBEAT] ⚠️  ${criticallyFailed.length} models have failed ${this.config.maxConsecutiveFailures}+ consecutive checks`);
        await this.recoverFailedModels(criticallyFailed);
      }
      if (this._destroyed) return;
      
      // Log summary
      const healthyCount = results.filter(r => r.healthy).length;
      const totalCount = results.length;
      console.log(`[HEARTBEAT] 📊 Health Check: ${healthyCount}/${totalCount} models healthy`);
      
      // Emit heartbeat event for monitoring systems
      this.emit('heartbeat_check', {
        timestamp: this.lastCheckTime,
        healthyCount,
        totalCount,
        failedModels: failedModels.map(f => f.modelId),
        criticallyFailed: criticallyFailed
      });
      
      if (this._destroyed) return;
      // Store metrics in database for dashboard
      await this.storeHeartbeatMetrics({
        healthyCount,
        totalCount,
        failedModels: failedModels.map(f => f.modelId),
        criticallyFailed
      });
      
    } catch (error) {
      console.error('[HEARTBEAT] ❌ Error during health check:', error.message);
      this.emit('heartbeat_error', { error: error.message });
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Check health of a specific model
   * @param {string} modelId - The model ID to check
   * @returns {Promise<Object>} Health check result
   */
  async checkSingleModelHealth(modelId) {
    const startTime = Date.now();
    let timeoutId;

    try {
      // Try to execute a simple inference to test responsiveness. modelId may be a
      // service-name alias (e.g. 'document-summarizer') -- LocalModelAdapter only knows
      // the real backing model id, so resolve before calling into it. The result below
      // still reports the original `modelId` so failedModels/heartbeat_check stay keyed
      // consistently by whatever name is in config.modelsToMonitor.
      const realModelId = this.resolveModelId(modelId);
      const testInput = this.getTestInputForModel(modelId);
      if (this._destroyed) throw new Error('Heartbeat stopped');

      // Execute with a short timeout
      const resultPromise = this.adapter.execute(realModelId, testInput, {
        tier: 'starter', // Use lowest tier for health check
        timeout: 5000 // 5 second timeout for health check
      });

      // Set up timeout
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Model health check timeout')), this.config.timeoutThreshold);
      });

      // Race between execution and timeout
      await Promise.race([resultPromise, timeoutPromise]);
      
      const responseTime = Date.now() - startTime;
      
      return {
        modelId,
        healthy: true,
        responseTime,
        timestamp: new Date(),
        details: {
          responseTimeMs: responseTime,
          testSuccessful: true
        }
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      return {
        modelId,
        healthy: false,
        responseTime,
        timestamp: new Date(),
        error: error.message,
        details: {
          responseTimeMs: responseTime,
          testSuccessful: false,
          errorType: error.name || 'UnknownError'
        }
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * Get appropriate test input for a model type
   * @param {string} modelId - The model ID
   * @returns {*} Test input for the model
   */
  getTestInputForModel(modelId) {
    // Map model IDs to appropriate test inputs
    const testInputs = {
      'gpt-4-local': { task: 'Say "OK" in response to this health check' },
      'gpt-35-turbo': { task: 'Respond with "HEALTHY"' },
      'local-llama': { document: 'This is a test document for health check.', summaryLength: 'short' },
      'local-classifier': { text: 'This is a test sentence for sentiment analysis.' },
      'code-specialist': { code: 'console.log("Hello World");', language: 'javascript' },
      'code-parser': { codebase: 'function test() { return true; }', format: 'json' },
      'bug-finder': { code: 'function test() { return true; }', language: 'javascript' },
      'db-specialist': { schema: { tables: [] }, queries: ['SELECT 1'], metrics: {} },
      'security-scanner': { application: 'test-app', scope: ['network'] },
      'local-ocr': { imageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==' },
      'predictive-model': { sales: [100, 120, 130], inventory: [50, 40, 30], seasonality: [1.1, 1.2, 1.3] },
      'pricing-engine': { product: 'test-product', costs: 10, market: { demand: 'medium', competition: 'low' } },
      'rule-engine': { facts: { age: 25, income: 50000 }, rules: [] }
    };
    
    // If we have a specific test input, use it
    if (testInputs[modelId]) {
      return testInputs[modelId];
    }
    
    // Otherwise, try to map from service names or use a generic input
    const baseModel = this.resolveModelId(modelId);
    if (baseModel !== modelId) {
      return this.getTestInputForModel(baseModel) || { task: 'Health check ping' };
    }
    return { task: 'Health check ping' };
  }

  /**
   * Check health of all monitored models
   * @returns {Promise<Array>} Array of health check results
   */
  async checkAllModels() {
    // All entries in modelsToMonitor that are of type 'llama'/'codellama' in
    // LocalModelAdapter resolve, via runLlamaInference()'s single ollamaModel
    // default, to the SAME real Ollama model (see local-model-adapter.js and
    // CLAUDE.md's LOCAL_MODEL_NAME/OLLAMA_MODEL precedence) - there is
    // currently no per-model override that makes them actually distinct.
    // Checking each alias separately was firing N redundant real inference
    // calls into the single-concurrency Ollama server (OLLAMA_NUM_PARALLEL=1)
    // every 30s for zero additional signal, and was directly implicated in a
    // live /api/chat request queuing behind heartbeat traffic and taking
    // ~15 minutes to return. Dedupe: check each distinct real model once,
    // apply that result to every alias backed by it.
    const aliasesByRealModel = new Map();
    for (const modelId of this.config.modelsToMonitor) {
      const realModelId = this.resolveModelId(modelId);
      if (!aliasesByRealModel.has(realModelId)) aliasesByRealModel.set(realModelId, []);
      aliasesByRealModel.get(realModelId).push(modelId);
    }

    const realModelIds = Array.from(aliasesByRealModel.keys());
    const realResults = await Promise.all(
      realModelIds.map(realModelId => this.checkSingleModelHealth(realModelId))
    );

    const results = [];
    realModelIds.forEach((realModelId, i) => {
      const base = realResults[i];
      for (const alias of aliasesByRealModel.get(realModelId)) {
        results.push({ ...base, modelId: alias });
      }
    });
    return results;
  }

  /**
   * Recover failed models by attempting to reload them
   * @param {Array<string>} modelIds - Array of model IDs to recover
   */
  async recoverFailedModels(modelIds) {
    if (this._destroyed) return;
    console.log(`[HEARTBEAT] 🔧 Attempting to recover ${modelIds.length} failed models...`);
    
    for (const modelId of modelIds) {
      if (this._destroyed) return;
      try {
        console.log(`[HEARTBEAT] 🔄 Recovering model: ${modelId}`);

        // modelId may be a service-name alias (e.g. 'document-summarizer'); the adapter
        // only ever registers the real backing model id ('local-llama'), so every lookup
        // below has to go through that resolution or it always misses.
        const realModelId = this.resolveModelId(modelId);

        // Try to unload and reload the model
        if (this.adapter.models.has(realModelId)) {
          await this.adapter.unloadModel(realModelId);
          if (this._destroyed) return;

          // Small delay to ensure cleanup
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (this._destroyed) return;
        // Reload the model
        const modelConfig = this.adapter.modelConfigs[realModelId];
        if (modelConfig) {
          await this.adapter.loadModel(realModelId, modelConfig);
          console.log(`[HEARTBEAT] ✅ Model ${modelId} recovered successfully`);
          
          // Reset failure count
          this.failedModels.delete(modelId);
          
          this.emit('model_recovered_via_heartbeat', {
            modelId,
            timestamp: new Date(),
            recoveryMethod: 'reload'
          });
        } else {
          console.error(`[HEARTBEAT] ❌ No configuration found for model: ${modelId}`);
        }
      } catch (error) {
        console.error(`[HEARTBEAT] ❌ Failed to recover model ${modelId}:`, error.message);
        
        this.emit('model_recovery_failed_via_heartbeat', {
          modelId,
          error: error.message,
          timestamp: new Date()
        });
      }
    }
  }

  /**
   * Store heartbeat metrics in database for dashboard monitoring
   * @param {Object} metrics - The metrics to store
   */
  async storeHeartbeatMetrics(metrics) {
    if (this._destroyed) return;
    try {
      await supabase
        .from('ursula_model_heartbeat')
        .insert({
          id: Math.random().toString(36).substring(2, 15),
          timestamp: new Date(),
          healthy_count: metrics.healthyCount,
          total_count: metrics.totalCount,
          failed_models: metrics.failedModels,
          critically_failed: metrics.criticallyFailed,
          status: metrics.criticallyFailed.length > 0 ? 'degraded' : 'healthy'
        });
    } catch (error) {
      // Don't let database failures stop the heartbeat
      console.warn('[HEARTBEAT] ⚠️  Failed to store metrics:', error.message);
    }
  }

  /**
   * Get current heartbeat status
   * @returns {Object} Current status information
   */
  getStatus() {
    return {
      running: !!this.heartbeatInterval,
      lastCheckTime: this.lastCheckTime,
      isChecking: this.isChecking,
      failedModels: Array.from(this.failedModels.entries()),
      config: this.config
    };
  }
}

// Create and export a singleton instance
const ursulaModelHeartbeat = new UrsulaModelHeartbeat();
module.exports = ursulaModelHeartbeat;

// If this script is run directly, start the heartbeat
if (require.main === module) {
  const startHeartbeat = async () => {
    try {
      await ursulaModelHeartbeat.start();
      
      // Graceful shutdown
      process.on('SIGINT', async () => {
        console.log('\n[HEARTBEAT] 🛑 Received shutdown signal');
        ursulaModelHeartbeat.stop();
        process.exit(0);
      });
      
      process.on('SIGTERM', async () => {
        console.log('\n[HEARTBEAT] 🛑 Received termination signal');
        ursulaModelHeartbeat.stop();
        process.exit(0);
      });
    } catch (error) {
      console.error('[HEARTBEAT] ❌ Fatal error starting heartbeat:', error.message);
      process.exit(1);
    }
  };
  
  startHeartbeat();
}