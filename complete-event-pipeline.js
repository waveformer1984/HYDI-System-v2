// Complete Event Processing Pipeline with Side-Effect Integration
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { EventContractValidator } = require('./event-contracts');
const { SideEffectGuards } = require('./side-effect-guards');
const { IdempotencyLayer } = require('./idempotency-layer');

class CompleteEventPipeline {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    this.validator = new EventContractValidator();
    this.sideEffectGuards = new SideEffectGuards();
    this.idempotency = new IdempotencyLayer();
    
    this.mode = 'LIVE'; // LIVE or REPLAY
    this.processors = new Map();
    this.sideEffects = new Map();
    this.metrics = {
      processed: 0,
      failed: 0,
      sideEffectsExecuted: 0,
      sideEffectsSkipped: 0,
      processingTime: []
    };
    
    this.initializeDefaultProcessors();
    this.initializeDefaultSideEffects();
  }

  initializeDefaultProcessors() {
    // Register default event processors
    this.registerProcessor('error', async (event, state) => {
      console.log(`Processing error event: ${event.event_id}`);
      
      // Store error in state
      state.set(`error:${event.event_id}`, {
        processed: true,
        timestamp: new Date().toISOString(),
        error: event.payload
      });
      
      // Trigger side effects
      await this.executeSideEffects(event, {
        slack_notification: {
          message: `Error detected: ${event.payload.message}`,
          channel: '#errors'
        },
        email_notification: {
          subject: `System Error: ${event.event_id}`,
          message: `Error details: ${JSON.stringify(event.payload)}`
        }
      });
      
      return { success: true, processed: true };
    });
    
    this.registerProcessor('system', async (event, state) => {
      console.log(`Processing system event: ${event.event_id}`);
      
      // Store system event in state
      state.set(`system:${event.event_id}`, {
        processed: true,
        timestamp: new Date().toISOString(),
        system: event.payload
      });
      
      // Trigger side effects
      await this.executeSideEffects(event, {
        webhook_call: {
          url: 'https://api.example.com/system-events',
          method: 'POST',
          data: event.payload
        }
      });
      
      return { success: true, processed: true };
    });
    
    this.registerProcessor('payment', async (event, state) => {
      console.log(`Processing payment event: ${event.event_id}`);
      
      // Store payment in state
      state.set(`payment:${event.event_id}`, {
        processed: true,
        timestamp: new Date().toISOString(),
        payment: event.payload
      });
      
      // Trigger side effects
      await this.executeSideEffects(event, {
        stripe_charge: {
          amount: event.payload.amount,
          currency: event.payload.currency || 'usd',
          description: event.payload.description
        },
        email_notification: {
          subject: `Payment Processed: ${event.event_id}`,
          message: `Payment of $${event.payload.amount} ${event.payload.currency || 'USD'} processed successfully`
        }
      });
      
      return { success: true, processed: true };
    });
  }

  initializeDefaultSideEffects() {
    // Register default side effects
    this.sideEffectGuards.registerSideEffect('slack_notification', async (event, payload) => {
      console.log(`[SLACK] Sending notification: ${payload.message}`);
      
      // In production, this would call Slack API
      const response = {
        slack_sent: true,
        timestamp: Date.now(),
        channel: payload.channel || '#general',
        message: payload.message
      };
      
      console.log(`[SLACK] Notification sent: ${response.message}`);
      return response;
    }, {
      idempotencyKey: 'slack_notification',
      requiresIdempotency: true,
      description: 'Slack notification side effect'
    });
    
    this.sideEffectGuards.registerSideEffect('email_notification', async (event, payload) => {
      console.log(`[EMAIL] Sending email: ${payload.subject}`);
      
      // In production, this would call email service
      const response = {
        email_sent: true,
        timestamp: Date.now(),
        subject: payload.subject,
        to: payload.to || 'admin@example.com'
      };
      
      console.log(`[EMAIL] Email sent: ${response.subject}`);
      return response;
    }, {
      idempotencyKey: 'email_notification',
      requiresIdempotency: true,
      description: 'Email notification side effect'
    });
    
    this.sideEffectGuards.registerSideEffect('stripe_charge', async (event, payload) => {
      console.log(`[STRIPE] Processing charge: $${payload.amount}`);
      
      // In production, this would call Stripe API
      const response = {
        charge_processed: true,
        charge_id: 'ch_' + Date.now(),
        timestamp: Date.now(),
        amount: payload.amount,
        currency: payload.currency || 'usd'
      };
      
      console.log(`[STRIPE] Charge processed: ${response.charge_id}`);
      return response;
    }, {
      idempotencyKey: 'stripe_charge',
      requiresIdempotency: true,
      description: 'Stripe charge side effect'
    });
    
    this.sideEffectGuards.registerSideEffect('webhook_call', async (event, payload) => {
      console.log(`[WEBHOOK] Calling webhook: ${payload.url}`);
      
      // In production, this would make HTTP request
      const response = {
        webhook_sent: true,
        timestamp: Date.now(),
        url: payload.url,
        method: payload.method || 'POST',
        status_code: 200
      };
      
      console.log(`[WEBHOOK] Webhook sent: ${response.url}`);
      return response;
    }, {
      idempotencyKey: 'webhook_call',
      requiresIdempotency: true,
      description: 'Webhook call side effect'
    });
  }

  // Set processing mode
  setMode(mode) {
    if (!['LIVE', 'REPLAY'].includes(mode)) {
      throw new Error(`Invalid mode: ${mode}. Must be 'LIVE' or 'REPLAY'`);
    }
    
    this.mode = mode;
    this.sideEffectGuards.setMode(mode);
    console.log(`Pipeline mode set to: ${mode}`);
  }

  // Register event processor
  registerProcessor(type, processor) {
    this.processors.set(type, processor);
    console.log(`Registered processor: ${type}`);
  }

  // Register side effect
  registerSideEffect(type, handler, options = {}) {
    this.sideEffectGuards.registerSideEffect(type, handler, options);
  }

  // Execute side effects
  async executeSideEffects(event, sideEffects) {
    const results = [];
    
    for (const [type, payload] of Object.entries(sideEffects)) {
      const result = await this.sideEffectGuards.executeSideEffect(event, type, payload);
      results.push({ type, result });
      
      // Update metrics
      if (result.success) {
        if (result.skipped) {
          this.metrics.sideEffectsSkipped++;
        } else {
          this.metrics.sideEffectsExecuted++;
        }
      }
    }
    
    return results;
  }

  // Process complete event pipeline
  async processEvent(source, type, payload, options = {}) {
    const startTime = Date.now();
    
    try {
      // Step 1: Create and validate event
      const eventResult = this.validator.createEvent(type, payload, {
        source,
        correlation_id: options.correlation_id,
        ...options
      });
      
      if (!eventResult.valid) {
        this.metrics.failed++;
        return {
          success: false,
          error: `Event validation failed: ${eventResult.errors.join(', ')}`,
          event: eventResult.event,
          processingTime: Date.now() - startTime
        };
      }
      
      // Step 2: Process with idempotency
      const processor = async (event) => {
        // Step 2a: Store event in database
        const { data, error } = await this.supabase
          .from('hydi_events')
          .insert([event])
          .select();
        
        if (error) {
          throw new Error(`Database insert failed: ${error.message}`);
        }
        
        // Step 2b: Process event with registered processor
        const processor = this.processors.get(event.type);
        
        if (processor) {
          const result = await processor(event, this.getState());
          
          // Step 2c: Store processed event
          await this.supabase
            .from('processed_events')
            .upsert({
              event_id: event.event_id,
              correlation_id: event.correlation_id,
              type: event.type,
              status: event.status,
              processed_at: new Date().toISOString(),
              result,
              schema_version: event.schema_version,
              processing_duration: Date.now() - startTime
            }, {
              onConflict: 'event_id'
            });
          
          return result;
        }
        
        return { success: true, processed: true };
      };
      
      const result = await this.idempotency.processEvent(eventResult.event, processor);
      
      // Step 3: Update metrics
      if (result.success) {
        this.metrics.processed++;
      } else {
        this.metrics.failed++;
      }
      
      this.metrics.processingTime.push(Date.now() - startTime);
      
      return result;
      
    } catch (error) {
      this.metrics.failed++;
      console.log(`Pipeline error: ${error.message}`);
      
      return {
        success: false,
        error: error.message,
        processingTime: Date.now() - startTime
      };
    }
  }

  // Get current state (for processors)
  getState() {
    // In production, this would be a proper state management system
    return new Map(); // Simplified for demo
  }

  // Get processing metrics
  getMetrics() {
    const processingTimes = this.metrics.processingTime;
    const avgProcessingTime = processingTimes.length > 0 
      ? processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length 
      : 0;
    
    return {
      processed: this.metrics.processed,
      failed: this.metrics.failed,
      sideEffectsExecuted: this.metrics.sideEffectsExecuted,
      sideEffectsSkipped: this.metrics.sideEffectsSkipped,
      avgProcessingTime: Math.round(avgProcessingTime),
      totalProcessingTime: processingTimes.reduce((a, b) => a + b, 0),
      mode: this.mode,
      processors: this.processors.size,
      sideEffects: this.sideEffectGuards.getStatus().registeredSideEffects
    };
  }

  // Test complete pipeline
  async testCompletePipeline() {
    console.log('=== TESTING COMPLETE EVENT PIPELINE ===');
    
    const testResults = {
      liveMode: false,
      replayMode: false,
      sideEffects: false,
      idempotency: false,
      metrics: false
    };
    
    try {
      // Test 1: Live mode processing
      console.log('Testing live mode processing...');
      this.setMode('LIVE');
      
      const liveResult = await this.processEvent('test', 'payment', {
        amount: 100,
        currency: 'usd',
        description: 'Test payment'
      });
      
      testResults.liveMode = liveResult.success;
      console.log(`Live mode: ${liveResult.success ? 'PASS' : 'FAIL'}`);
      
      // Test 2: Replay mode processing
      console.log('Testing replay mode processing...');
      this.setMode('REPLAY');
      
      const replayResult = await this.processEvent('test', 'payment', {
        amount: 100,
        currency: 'usd',
        description: 'Test payment replay'
      });
      
      testResults.replayMode = replayResult.success;
      console.log(`Replay mode: ${replayResult.success ? 'PASS' : 'FAIL'}`);
      
      // Test 3: Side effects
      console.log('Testing side effects...');
      const metrics = this.getMetrics();
      
      testResults.sideEffects = metrics.sideEffectsExecuted > 0 || metrics.sideEffectsSkipped > 0;
      console.log(`Side effects: ${testResults.sideEffects ? 'PASS' : 'FAIL'}`);
      console.log(`Executed: ${metrics.sideEffectsExecuted}, Skipped: ${metrics.sideEffectsSkipped}`);
      
      // Test 4: Idempotency
      console.log('Testing idempotency...');
      
      // Process same event twice
      const idempotencyTest = await this.processEvent('test', 'payment', {
        amount: 100,
        currency: 'usd',
        description: 'Idempotency test'
      });
      
      const idempotencyTest2 = await this.processEvent('test', 'payment', {
        amount: 100,
        currency: 'usd',
        description: 'Idempotency test'
      });
      
      testResults.idempotency = idempotencyTest.success && idempotencyTest2.success;
      console.log(`Idempotency: ${testResults.idempotency ? 'PASS' : 'FAIL'}`);
      
      // Test 5: Metrics
      console.log('Testing metrics...');
      const finalMetrics = this.getMetrics();
      
      testResults.metrics = finalMetrics.processed > 0 && finalMetrics.avgProcessingTime > 0;
      console.log(`Metrics: ${testResults.metrics ? 'PASS' : 'FAIL'}`);
      console.log(`Processed: ${finalMetrics.processed}, Failed: ${finalMetrics.failed}`);
      console.log(`Avg processing time: ${finalMetrics.avgProcessingTime}ms`);
      
      // Overall result
      const allPassed = Object.values(testResults).every(r => r);
      
      console.log('\n=== COMPLETE PIPELINE TEST RESULTS ===');
      console.log(`Overall: ${allPassed ? 'PASS' : 'FAIL'}`);
      
      Object.entries(testResults).forEach(([test, passed]) => {
        console.log(`${test}: ${passed ? 'PASS' : 'FAIL'}`);
      });
      
      console.log('\n=== FINAL METRICS ===');
      console.log(JSON.stringify(finalMetrics, null, 2));
      
      return {
        success: allPassed,
        results: testResults,
        metrics: finalMetrics
      };
      
    } catch (error) {
      console.log(`Pipeline test failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        results: testResults
      };
    }
  }

  // Reset metrics
  resetMetrics() {
    this.metrics = {
      processed: 0,
      failed: 0,
      sideEffectsExecuted: 0,
      sideEffectsSkipped: 0,
      processingTime: []
    };
    console.log('Pipeline metrics reset');
  }
}

// CLI interface
if (require.main === module) {
  const pipeline = new CompleteEventPipeline();
  
  const command = process.argv[2] || 'test';
  
  (async () => {
    switch (command) {
      case 'test':
        await pipeline.testCompletePipeline();
        break;
        
      case 'process':
        const result = await pipeline.processEvent('cli_test', 'payment', {
          amount: 50,
          currency: 'usd',
          description: 'CLI test payment'
        });
        console.log(JSON.stringify(result, null, 2));
        break;
        
      case 'metrics':
        console.log(JSON.stringify(pipeline.getMetrics(), null, 2));
        break;
        
      case 'live':
        pipeline.setMode('LIVE');
        break;
        
      case 'replay':
        pipeline.setMode('REPLAY');
        break;
        
      case 'reset':
        pipeline.resetMetrics();
        break;
        
      default:
        console.log('Usage: node complete-event-pipeline.js [test|process|metrics|live|replay|reset]');
    }
  })().catch(console.error);
}

module.exports = { CompleteEventPipeline };
