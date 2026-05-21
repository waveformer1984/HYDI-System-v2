#!/usr/bin/env node

/**
 * Enhanced Agent Worker with Local Model Integration
 *
 * Combines task execution with autonomous decision-making using local models
 * for intelligent event classification and routing.
 *
 * Features:
 * - Local model-based task classification
 * - Intelligent retry strategies based on event severity
 * - Performance-aware task scheduling
 * - Autonomous decision making for event routing
 */

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');
const { LocalModelIntegrationEngine } = require('./local-model-integration');

class EnhancedAgentWorkerWithAI {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Initialize local model integration
    this.modelEngine = new LocalModelIntegrationEngine({
      modelBackend: process.env.MODEL_BACKEND || 'decision-tree',
      enableCaching: true,
      cacheSize: 1000
    });

    this.workerId = uuidv4().substring(0, 8);
    this.isRunning = false;
    this.metricsInterval = null;
    this.pollInterval = null;

    // Performance tracking
    this.metrics = {
      events_processed: 0,
      events_failed: 0,
      events_succeeded: 0,
      total_processing_time: 0,
      model_decisions: 0,
      autonomous_actions: 0,
      startup_time: new Date().toISOString()
    };

    // Capabilities this worker can execute
    this.capabilities = {
      'error': { description: 'Error event handling', confidence: 1.0, enabled: true },
      'task': { description: 'Generic task execution', confidence: 0.95, enabled: true },
      'info': { description: 'Information processing', confidence: 0.9, enabled: true },
      'outreach': { description: 'Outreach campaigns', confidence: 0.85, enabled: true },
      'analysis': { description: 'Data analysis', confidence: 0.9, enabled: true },
      'cad': { description: 'CAD document processing', confidence: 0.8, enabled: true },
      'audio': { description: 'Audio file processing', confidence: 0.8, enabled: true },
      'default': { description: 'Default event handler', confidence: 0.7, enabled: true },
      'ai_decision': { description: 'AI-driven decision making', confidence: 0.85, enabled: true }
    };
  }

  /**
   * Initialize the worker with model integration
   */
  async initialize() {
    console.log(`\n=== ENHANCED AGENT WORKER (WITH AI) ===`);
    console.log(`Worker ID: ${this.workerId}`);
    console.log(`Startup Time: ${new Date().toISOString()}`);

    // Initialize model engine
    console.log(`\nInitializing model integration...`);
    const modelReady = await this.modelEngine.initialize();

    if (!modelReady) {
      console.warn('Model integration failed, continuing with fallback decision-tree');
    }

    // Register capabilities
    await this.registerCapabilities();

    // Start polling
    this.startPolling();

    // Start metrics reporting
    this.startMetricsReporting();

    this.isRunning = true;
    console.log(`\nWorker initialized and ready for autonomous operation`);
  }

  /**
   * Register worker capabilities with the system
   */
  async registerCapabilities() {
    console.log(`Registering ${Object.keys(this.capabilities).length} capabilities...`);

    for (const [capability, info] of Object.entries(this.capabilities)) {
      try {
        const { error } = await this.supabase
          .from('worker_capabilities')
          .insert({
            capability_name: capability,
            worker_id: this.workerId,
            description: info.description,
            confidence: info.confidence,
            enabled: info.enabled,
            registered_at: new Date().toISOString()
          })
          .select();

        if (error && !error.message.includes('duplicate')) {
          console.warn(`Failed to register capability ${capability}: ${error.message}`);
        }
      } catch (error) {
        console.warn(`Capability registration error for ${capability}: ${error.message}`);
      }
    }

    console.log(`Capabilities registered`);
  }

  /**
   * Start polling for work
   */
  startPolling() {
    const POLL_INTERVAL = parseInt(process.env.TASKS_POLL_MS || '4000');

    this.pollInterval = setInterval(async () => {
      await this.pollWorkQueue();
    }, POLL_INTERVAL);

    console.log(`Work queue polling started (every ${POLL_INTERVAL}ms)`);
  }

  /**
   * Poll work queue for pending events
   */
  async pollWorkQueue() {
    try {
      const { data: pendingEvents, error } = await this.supabase
        .from('hydi_events')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(10);

      if (error) {
        console.error(`Poll error: ${error.message}`);
        return;
      }

      if (pendingEvents && pendingEvents.length > 0) {
        console.log(`Found ${pendingEvents.length} pending events, processing with AI...`);

        for (const event of pendingEvents) {
          await this.processEventWithAI(event);
        }
      }
    } catch (error) {
      console.error(`Work queue poll exception: ${error.message}`);
    }
  }

  /**
   * Process event with AI-driven classification and decision-making
   */
  async processEventWithAI(event) {
    const startTime = Date.now();

    try {
      // Step 1: Update status to processing
      await this.updateEventStatus(event.event_id, 'processing', {
        worker_id: this.workerId,
        model_processing: true
      });

      // Step 2: Get AI classification and decision
      const classification = await this.modelEngine.classify(event);
      const decision = await this.modelEngine.generateDecision(event);

      this.metrics.model_decisions++;

      console.log(`[AI] Event ${event.event_id} - Type: ${event.type}, Decision: ${classification.decision}`);

      // Step 3: Execute based on classification
      const processingResult = await this.executeWithClassification(
        event,
        classification,
        decision
      );

      // Step 4: Update status based on result
      if (processingResult.success) {
        await this.updateEventStatus(event.event_id, 'completed', {
          worker_id: this.workerId,
          processing_time: Date.now() - startTime,
          ai_classified: true,
          confidence: classification.confidence,
          decision_id: decision.event_id
        });

        this.metrics.events_succeeded++;
      } else {
        // Intelligent retry based on classification
        const retryStrategy = classification.retry_strategy;
        const shouldRetry = this.shouldRetry(event, retryStrategy);

        if (shouldRetry) {
          await this.updateEventStatus(event.event_id, 'pending', {
            retry_count: (event.retry_count || 0) + 1,
            last_error: processingResult.error,
            ai_retry_strategy: retryStrategy,
            next_retry_at: this.calculateNextRetry(event, retryStrategy)
          });
        } else {
          await this.updateEventStatus(event.event_id, 'failed', {
            final_error: processingResult.error,
            ai_recommendation: 'Manual review required',
            attempts: (event.retry_count || 0) + 1
          });
        }
      }

      this.metrics.events_processed++;
      this.metrics.total_processing_time += Date.now() - startTime;

    } catch (error) {
      console.error(`[AI] Processing failed for ${event.event_id}: ${error.message}`);
      this.metrics.events_failed++;

      await this.updateEventStatus(event.event_id, 'failed', {
        error: error.message,
        worker_id: this.workerId
      });
    }
  }

  /**
   * Execute event with AI classification guidance
   */
  async executeWithClassification(event, classification, decision) {
    try {
      // Route to appropriate handler based on classification
      const handler = this.getEventHandler(event.type, classification);

      console.log(`[EXECUTE] ${event.event_id} - Handler: ${handler}, Priority: ${classification.priority}`);

      // Simulate async work with intelligent duration
      const estimatedDuration = classification.estimated_duration || 5000;
      const actualDuration = Math.random() * estimatedDuration * 0.8;

      await new Promise(resolve => setTimeout(resolve, actualDuration));

      // Simulate occasional failures for testing
      if (Math.random() < 0.05) { // 5% failure rate
        throw new Error('Simulated processing failure');
      }

      // Record autonomous action if decision triggered specific behavior
      if (decision.actions.length > 0) {
        this.metrics.autonomous_actions += decision.actions.length;
      }

      return {
        success: true,
        handler: handler,
        execution_time: actualDuration,
        actions_executed: decision.actions.length
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        handler: this.getEventHandler(event.type, classification)
      };
    }
  }

  /**
   * Get appropriate event handler with AI guidance
   */
  getEventHandler(eventType, classification) {
    const routing = classification.routing || {};
    return routing.handler || eventType || 'default';
  }

  /**
   * Determine if event should be retried
   */
  shouldRetry(event, retryStrategy) {
    if (!retryStrategy) return false;

    const currentRetries = event.retry_count || 0;
    return currentRetries < retryStrategy.max_retries;
  }

  /**
   * Calculate next retry time using backoff strategy
   */
  calculateNextRetry(event, retryStrategy) {
    if (!retryStrategy) return new Date().toISOString();

    const currentRetries = event.retry_count || 0;
    const backoffMs = Math.min(
      1000 * Math.pow(retryStrategy.backoff_multiplier, currentRetries),
      retryStrategy.max_backoff
    );

    const nextRetry = new Date(Date.now() + backoffMs);
    return nextRetry.toISOString();
  }

  /**
   * Update event status in database
   */
  async updateEventStatus(eventId, status, metadata = {}) {
    try {
      const { error } = await this.supabase
        .from('hydi_events')
        .update({
          status,
          updated_at: new Date().toISOString(),
          metadata: metadata
        })
        .eq('event_id', eventId);

      if (error) {
        console.error(`Status update failed for ${eventId}: ${error.message}`);
      }
    } catch (error) {
      console.error(`Status update exception for ${eventId}: ${error.message}`);
    }
  }

  /**
   * Start metrics reporting
   */
  startMetricsReporting() {
    this.metricsInterval = setInterval(() => {
      const avgProcessingTime = this.metrics.events_processed > 0
        ? (this.metrics.total_processing_time / this.metrics.events_processed).toFixed(2)
        : 0;

      console.log(`\n[METRICS] Worker ${this.workerId}:`);
      console.log(`  Processed: ${this.metrics.events_processed}`);
      console.log(`  Succeeded: ${this.metrics.events_succeeded}`);
      console.log(`  Failed: ${this.metrics.events_failed}`);
      console.log(`  Avg Time: ${avgProcessingTime}ms`);
      console.log(`  AI Decisions: ${this.metrics.model_decisions}`);
      console.log(`  Autonomous Actions: ${this.metrics.autonomous_actions}`);

      // Report model stats
      const modelStats = this.modelEngine.getStats();
      console.log(`\n[MODEL] Stats:`);
      console.log(`  Backend: ${modelStats.model_backend}`);
      console.log(`  Total Inferences: ${modelStats.total_inferences}`);
      console.log(`  Cache Hits: ${modelStats.cache_hits}`);
      console.log(`  Cache Misses: ${modelStats.cache_misses}`);
      console.log(`  Model Errors: ${modelStats.model_errors}`);
      console.log(`  Status: ${modelStats.status}`);
    }, 30000);
  }

  /**
   * Stop the worker
   */
  async stop() {
    console.log(`\nShutting down worker ${this.workerId}...`);
    this.isRunning = false;

    if (this.pollInterval) clearInterval(this.pollInterval);
    if (this.metricsInterval) clearInterval(this.metricsInterval);

    console.log(`Worker stopped`);
  }

  /**
   * Get worker status
   */
  async getStatus() {
    const modelHealth = await this.modelEngine.healthCheck();

    return {
      worker_id: this.workerId,
      status: this.isRunning ? 'active' : 'inactive',
      timestamp: new Date().toISOString(),
      metrics: this.metrics,
      model_integration: {
        backend: modelHealth.backend,
        status: modelHealth.status,
        cache_utilization: modelHealth.cache_utilization,
        inference_stats: modelHealth.inference_stats
      },
      capabilities: Object.keys(this.capabilities).length
    };
  }
}

// CLI interface
if (require.main === module) {
  const worker = new EnhancedAgentWorkerWithAI();

  (async () => {
    try {
      await worker.initialize();

      // Keep worker running
      process.on('SIGINT', async () => {
        await worker.stop();
        process.exit(0);
      });

    } catch (error) {
      console.error(`Worker initialization failed: ${error.message}`);
      process.exit(1);
    }
  })();
}

module.exports = { EnhancedAgentWorkerWithAI };
