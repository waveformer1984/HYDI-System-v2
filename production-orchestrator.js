#!/usr/bin/env node

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');
const { EventContractValidator } = require('./event-contracts');
const { ReplayEngine } = require('./replay-engine');
const { SourceOfTruth } = require('./source-of-truth');
const { IdempotencyLayer } = require('./idempotency-layer');

// Production Orchestrator - Complete Resilient System
class ProductionOrchestrator {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    // Initialize all components
    this.validator = new EventContractValidator();
    this.replayEngine = new ReplayEngine();
    this.sourceOfTruth = new SourceOfTruth();
    this.idempotency = new IdempotencyLayer();
    
    this.operationId = uuidv4();
    this.systemState = {
      orchestrator: { status: 'initializing' },
      contracts: { status: 'unknown' },
      replay: { status: 'unknown' },
      source: { status: 'unknown' },
      idempotency: { status: 'unknown' },
      preflight: { status: 'unknown' }
    };
    
    // Register default processors
    this.registerDefaultProcessors();
  }

  registerDefaultProcessors() {
    // Register processors for replay engine
    this.replayEngine.registerProcessor('error', async (event, state) => {
      console.log(`Processing error event: ${event.event_id}`);
      state.set(`error:${event.event_id}`, {
        processed: true,
        timestamp: new Date().toISOString()
      });
    });
    
    this.replayEngine.registerProcessor('system', async (event, state) => {
      console.log(`Processing system event: ${event.event_id}`);
      state.set(`system:${event.event_id}`, {
        processed: true,
        timestamp: new Date().toISOString()
      });
    });
    
    this.replayEngine.registerProcessor('orchestration_test', async (event, state) => {
      console.log(`Processing test event: ${event.event_id}`);
      state.set(`test:${event.event_id}`, {
        processed: true,
        timestamp: new Date().toISOString()
      });
    });
  }

  async execute(operation) {
    console.log(`=== PRODUCTION ORCHESTRATOR ===`);
    console.log(`Operation: ${operation}`);
    console.log(`Operation ID: ${this.operationId}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    try {
      const result = await this[operation]();
      await this.logOperationComplete(operation, 'SUCCESS', result);
      return result;
    } catch (error) {
      await this.logOperationComplete(operation, 'FAILED', null, error);
      throw error;
    }
  }

  // Complete system audit
  async audit() {
    console.log('\n=== COMPLETE SYSTEM AUDIT ===');
    
    // Step 0: Pre-flight schema check
    await this.auditPreFlight();
    
    // Step 1: Event contract validation
    await this.auditContracts();
    
    // Step 2: Source of truth enforcement
    await this.auditSourceOfTruth();
    
    // Step 3: Idempotency layer check
    await this.auditIdempotency();
    
    // Step 4: Replay engine readiness
    await this.auditReplayEngine();
    
    // Step 5: End-to-end validation
    await this.auditEndToEnd();
    
    this.printAuditReport();
  }

  async auditContracts() {
    console.log('\n--- EVENT CONTRACT AUDIT ---');
    
    try {
      // Test event creation
      const testEvent = this.validator.createEvent('audit_test', {
        message: 'Contract validation test',
        timestamp: Date.now()
      });
      
      if (testEvent.valid) {
        this.systemState.contracts = { status: 'valid', version: testEvent.version };
        console.log('Contract validation: PASSED');
        console.log(`Current version: ${testEvent.version}`);
      } else {
        this.systemState.contracts = { status: 'invalid', errors: testEvent.errors };
        console.log('Contract validation: FAILED');
        console.log(`Errors: ${testEvent.errors.join(', ')}`);
      }
      
    } catch (error) {
      this.systemState.contracts = { status: 'error', error: error.message };
      console.log(`Contract audit error: ${error.message}`);
    }
  }

  async auditSourceOfTruth() {
    console.log('\n--- SOURCE OF TRUTH AUDIT ---');
    
    try {
      const sourceStatus = await this.sourceOfTruth.enforcePrimarySource();
      
      if (sourceStatus.healthy) {
        this.systemState.source = { status: 'healthy', primary: sourceStatus.primary };
        console.log('Source of truth: HEALTHY');
        console.log(`Primary: ${sourceStatus.primary}`);
        
        if (sourceStatus.drift && Object.keys(sourceStatus.drift).length > 0) {
          const totalDrift = Object.values(sourceStatus.drift).flat().length;
          console.log(`Drift detected: ${totalDrift} issues`);
        } else {
          console.log('No drift detected');
        }
      } else {
        this.systemState.source = { status: 'unhealthy', error: sourceStatus.error };
        console.log('Source of truth: UNHEALTHY');
        console.log(`Error: ${sourceStatus.error}`);
      }
      
    } catch (error) {
      this.systemState.source = { status: 'error', error: error.message };
      console.log(`Source of truth audit error: ${error.message}`);
    }
  }

  async auditIdempotency() {
    console.log('\n--- IDEMPOTENCY LAYER AUDIT ---');
    
    try {
      // Clean up expired locks
      await this.idempotency.cleanupExpiredLocks();
      
      // Get stats
      const stats = this.idempotency.getStats();
      
      this.systemState.idempotency = { 
        status: 'healthy',
        processed_events: stats.processed_events,
        active_locks: stats.active_locks
      };
      
      console.log('Idempotency layer: HEALTHY');
      console.log(`Processed events: ${stats.processed_events}`);
      console.log(`Active locks: ${stats.active_locks}`);
      
    } catch (error) {
      this.systemState.idempotency = { status: 'error', error: error.message };
      console.log(`Idempotency audit error: ${error.message}`);
    }
  }

  async auditReplayEngine() {
    console.log('\n--- REPLAY ENGINE AUDIT ---');
    
    try {
      const stats = this.replayEngine.getReplayStats();
      
      this.systemState.replay = {
        status: stats.processors_registered > 0 ? 'ready' : 'no_processors',
        processors_registered: stats.processors_registered,
        total_replays: stats.total_replays
      };
      
      console.log('Replay engine: READY');
      console.log(`Processors registered: ${stats.processors_registered}`);
      console.log(`Total replays: ${stats.total_replays}`);
      
    } catch (error) {
      this.systemState.replay = { status: 'error', error: error.message };
      console.log(`Replay engine audit error: ${error.message}`);
    }
  }

  async auditEndToEnd() {
    console.log('\n--- END-TO-END VALIDATION ---');
    
    try {
      // Create and validate event
      const testEvent = this.validator.createEvent('e2e_test', {
        message: 'End-to-end validation',
        timestamp: Date.now()
      });
      
      if (!testEvent.valid) {
        throw new Error(`Event validation failed: ${testEvent.errors.join(', ')}`);
      }
      
      // Process event with idempotency
      const processor = async (event) => {
        console.log(`E2E processing: ${event.event_id}`);
        return { success: true, processed: true };
      };
      
      const result = await this.idempotency.processEvent(testEvent.event, processor);
      
      if (!result.success) {
        throw new Error(`Idempotency processing failed: ${result.error}`);
      }
      
      // Verify event was stored
      const stored = await this.idempotency.checkEventProcessed(testEvent.event.event_id);
      
      if (!stored) {
        throw new Error('Event was not stored in processed_events table');
      }
      
      console.log('End-to-end validation: PASSED');
      console.log(`Event ID: ${testEvent.event.event_id}`);
      console.log(`Processing time: ${result.processing_duration || 'N/A'}ms`);
      
    } catch (error) {
      console.log(`End-to-end validation failed: ${error.message}`);
    }
  }

  async auditPreFlight() {
    console.log('\n--- PRE-FLIGHT SCHEMA CHECK ---');
    
    try {
      const { PreFlightSchemaCheck } = require('./preflight-schema-check');
      const check = new PreFlightSchemaCheck();
      
      const results = await check.runPreFlightCheck();
      
      if (results.overall.passed) {
        this.systemState.preflight = { status: 'passed', results };
        console.log('Pre-flight schema check: PASSED');
      } else {
        this.systemState.preflight = { status: 'failed', results };
        console.log('Pre-flight schema check: FAILED');
        console.log('System cannot start - schema issues detected');
        
        // Don't continue with other checks if pre-flight fails
        throw new Error('Pre-flight schema check failed - system cannot start');
      }
      
    } catch (error) {
      this.systemState.preflight = { status: 'error', error: error.message };
      console.log(`Pre-flight schema check error: ${error.message}`);
      throw error;
    }
  }

  printAuditReport() {
    console.log('\n=== SYSTEM AUDIT REPORT ===');
    
    const components = [
      { name: 'Orchestrator', status: this.systemState.orchestrator.status },
      { name: 'Pre-Flight Check', status: this.systemState.preflight?.status || 'unknown' },
      { name: 'Event Contracts', status: this.systemState.contracts.status },
      { name: 'Source of Truth', status: this.systemState.source.status },
      { name: 'Idempotency Layer', status: this.systemState.idempotency.status },
      { name: 'Replay Engine', status: this.systemState.replay.status }
    ];
    
    const healthy = components.filter(c => c.status === 'healthy' || c.status === 'valid' || c.status === 'ready');
    const unhealthy = components.filter(c => c.status === 'unhealthy' || c.status === 'invalid' || c.status === 'error' || c.status === 'no_processors');
    
    console.log(`Healthy Components: ${healthy.length}/${components.length}`);
    
    if (healthy.length === components.length) {
      console.log('SYSTEM STATUS: PRODUCTION READY');
    } else {
      console.log('SYSTEM STATUS: NEEDS ATTENTION');
      
      console.log('\nUnhealthy Components:');
      unhealthy.forEach(c => {
        console.log(`- ${c.name}: ${c.status}`);
        if (c.error) console.log(`  Error: ${c.error}`);
      });
    }
    
    console.log('\n=== DETAILED STATUS ===');
    components.forEach(c => {
      console.log(`${c.name}: ${c.status}`);
    });
    
    console.log('\n=== PRODUCTION READINESS SCORE ===');
    const score = Math.round((healthy.length / components.length) * 100);
    console.log(`Score: ${score}/100`);
    
    if (score >= 90) {
      console.log('GRADE: EXCELLENT');
    } else if (score >= 80) {
      console.log('GRADE: GOOD');
    } else if (score >= 70) {
      console.log('GRADE: ACCEPTABLE');
    } else {
      console.log('GRADE: NEEDS WORK');
    }
  }

  // Production event processing
  async processEvent(source, type, payload, options = {}) {
    const startTime = Date.now();
    
    try {
      // Create validated event
      const eventResult = this.validator.createEvent(type, payload, {
        source,
        correlation_id: options.correlation_id,
        ...options
      });
      
      if (!eventResult.valid) {
        throw new Error(`Event validation failed: ${eventResult.errors.join(', ')}`);
      }
      
      // Process with idempotency
      const processor = async (event) => {
        // Store in Supabase
        const { data, error } = await this.supabase
          .from('hydi_events')
          .insert([event])
          .select();
        
        if (error) {
          throw new Error(`Database insert failed: ${error.message}`);
        }
        
        return {
          success: true,
          data: data[0],
          processing_duration: Date.now() - startTime
        };
      };
      
      const result = await this.idempotency.processEvent(eventResult.event, processor);
      
      // Add processing duration
      if (result.success && result.result) {
        result.result.processing_duration = Date.now() - startTime;
      }
      
      return result;
      
    } catch (error) {
      console.log(`Event processing failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        processing_duration: Date.now() - startTime
      };
    }
  }

  // Replay events with full idempotency
  async replayEvents(options = {}) {
    console.log('=== PRODUCTION REPLAY ===');
    
    try {
      const events = await this.replayEngine.fetchEvents(options);
      console.log(`Found ${events.length} events to replay`);
      
      const processor = async (event, state) => {
        // Use the same processing logic as normal events
        const { data, error } = await this.supabase
          .from('hydi_events')
          .insert([event])
          .select();
        
        if (error) {
          throw new Error(`Replay insert failed: ${error.message}`);
        }
        
        state.set(`replay:${event.event_id}`, {
          processed: true,
          timestamp: new Date().toISOString(),
          replay_data: data[0]
        });
        
        return {
          success: true,
          data: data[0]
        };
      };
      
      const results = await this.idempotency.replayEvents(events, processor);
      
      // Verify consistency
      const consistency = await this.replayEngine.verifyConsistency(results);
      
      console.log('\n=== REPLAY RESULTS ===');
      console.log(`Success: ${consistency.consistent}`);
      console.log(`Replayed: ${results.replayed}`);
      console.log(`Skipped: ${results.skipped}`);
      console.log(`Duplicates: ${results.duplicates}`);
      console.log(`Failed: ${results.failed}`);
      
      return {
        success: consistency.consistent,
        results,
        consistency
      };
      
    } catch (error) {
      console.log(`Replay failed: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async logOperationComplete(operation, result, data = null, error = null) {
    const logEntry = {
      operation,
      operation_id: this.operationId,
      result,
      timestamp: new Date().toISOString(),
      data,
      error: error ? error.message : null,
      system_state: this.systemState
    };
    
    console.log(`\n=== OPERATION COMPLETE ===`);
    console.log(`Operation: ${operation}`);
    console.log(`Result: ${result}`);
    console.log(`Timestamp: ${logEntry.timestamp}`);
    
    if (error) {
      console.log(`Error: ${error}`);
    }
  }

  // Get system health
  async healthCheck() {
    const health = {
      status: 'unknown',
      timestamp: new Date().toISOString(),
      operation_id: this.operationId,
      components: this.systemState,
      uptime: process.uptime(),
      memory: process.memoryUsage()
    };
    
    // Check overall health
    const components = Object.values(this.systemState);
    const healthy = components.filter(c => 
      c.status === 'healthy' || c.status === 'valid' || c.status === 'ready'
    ).length;
    
    if (healthy === components.length && components.length > 0) {
      health.status = 'healthy';
    } else {
      health.status = 'degraded';
    }
    
    return health;
  }
}

// CLI interface
if (require.main === module) {
  const orchestrator = new ProductionOrchestrator();
  
  const command = process.argv[2] || 'audit';
  
  (async () => {
    switch (command) {
      case 'audit':
        await orchestrator.audit();
        break;
        
      case 'health':
        const health = await orchestrator.healthCheck();
        console.log(JSON.stringify(health, null, 2));
        break;
        
      case 'process':
        const result = await orchestrator.processEvent('cli_test', 'test', {
          message: 'CLI test event',
          timestamp: Date.now()
        });
        console.log(JSON.stringify(result, null, 2));
        break;
        
      case 'replay':
        const replayResult = await orchestrator.replayEvents({
          limit: 10,
          dryRun: process.argv.includes('--dry-run')
        });
        console.log(JSON.stringify(replayResult, null, 2));
        break;
        
      default:
        console.log('Usage: node production-orchestrator.js [audit|health|process|replay] [--dry-run]');
    }
  })().catch(console.error);
}

module.exports = { ProductionOrchestrator };
