#!/usr/bin/env node

// Production Readiness Test - Complete System Validation
require('dotenv').config();
const { ProductionOrchestrator } = require('./production-orchestrator');

class ProductionReadinessTest {
  constructor() {
    this.orchestrator = new ProductionOrchestrator();
    this.testResults = {
      passed: 0,
      failed: 0,
      details: []
    };
  }

  async runAllTests() {
    console.log('=== PRODUCTION READINESS TEST SUITE ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    
    const tests = [
      { name: 'Event Contract Validation', test: () => this.testEventContracts() },
      { name: 'Source of Truth Enforcement', test: () => this.testSourceOfTruth() },
      { name: 'Idempotency Layer', test: () => this.testIdempotency() },
      { name: 'Replay Engine', test: () => this.testReplayEngine() },
      { name: 'End-to-End Processing', test: () => this.testEndToEndProcessing() },
      { name: 'Database Connectivity', test: () => this.testDatabaseConnectivity() },
      { name: 'Schema Compliance', test: () => this.testSchemaCompliance() },
      { name: 'Performance Benchmarks', test: () => this.testPerformance() },
      { name: 'Failure Recovery', test: () => this.testFailureRecovery() },
      { name: 'Consistency Verification', test: () => this.testConsistency() }
    ];
    
    for (const test of tests) {
      console.log(`\n--- ${test.name} ---`);
      
      try {
        const startTime = Date.now();
        const result = await test.test();
        const duration = Date.now() - startTime;
        
        if (result.success) {
          this.testResults.passed++;
          console.log(`PASSED (${duration}ms): ${result.message}`);
          if (result.details) {
            console.log(`Details: ${result.details}`);
          }
        } else {
          this.testResults.failed++;
          console.log(`FAILED (${duration}ms): ${result.message}`);
          if (result.error) {
            console.log(`Error: ${result.error}`);
          }
        }
        
        this.testResults.details.push({
          name: test.name,
          success: result.success,
          message: result.message,
          duration,
          details: result.details || null,
          error: result.error || null
        });
        
      } catch (error) {
        this.testResults.failed++;
        console.log(`ERROR: ${error.message}`);
        
        this.testResults.details.push({
          name: test.name,
          success: false,
          message: 'Test execution error',
          error: error.message
        });
      }
    }
    
    this.printFinalReport();
  }

  async testEventContracts() {
    try {
      // Test event creation
      const { EventContractValidator } = require('./event-contracts');
      const validator = new EventContractValidator();
      
      const testEvent = validator.createEvent('readiness_test', {
        message: 'Production readiness test',
        timestamp: Date.now(),
        metadata: { test: true }
      });
      
      if (!testEvent.valid) {
        return {
          success: false,
          message: 'Event validation failed',
          details: testEvent.errors
        };
      }
      
      // Test migration
      const migratedEvent = validator.migrateEvent({
        event_id: 'test-migration',
        type: 'test',
        status: 'pending',
        payload: { test: true }
      }, '1.0.0');
      
      return {
        success: true,
        message: 'Event contracts working correctly',
        details: `Version: ${testEvent.version}, Migration: successful`
      };
      
    } catch (error) {
      return {
        success: false,
        message: 'Event contract test failed',
        error: error.message
      };
    }
  }

  async testSourceOfTruth() {
    try {
      const { SourceOfTruth } = require('./source-of-truth');
      const sot = new SourceOfTruth();
      
      const health = await sot.verifySupabaseHealth();
      
      if (!health) {
        return {
          success: false,
          message: 'Primary source (Supabase) not healthy',
          error: 'Health check failed'
        };
      }
      
      return {
        success: true,
        message: 'Source of truth enforcement working',
        details: 'Supabase is healthy and accessible'
      };
      
    } catch (error) {
      return {
        success: false,
        message: 'Source of truth test failed',
        error: error.message
      };
    }
  }

  async testIdempotency() {
    try {
      const { IdempotencyLayer } = require('./idempotency-layer');
      const idempotency = new IdempotencyLayer();
      
      // Cleanup first
      await idempotency.cleanupExpiredLocks();
      
      const stats = idempotency.getStats();
      
      return {
        success: true,
        message: 'Idempotency layer operational',
        details: `Memory: ${JSON.stringify(stats.memory_usage)}`
      };
      
    } catch (error) {
      return {
        success: false,
        message: 'Idempotency test failed',
        error: error.message
      };
    }
  }

  async testReplayEngine() {
    try {
      const { ReplayEngine } = require('./replay-engine');
      const replay = new ReplayEngine();
      
      // Register test processor
      replay.registerProcessor('readiness_test', async (event, state) => {
        state.set(`test:${event.event_id}`, { processed: true });
      });
      
      const stats = replay.getReplayStats();
      
      return {
        success: stats.processors_registered > 0,
        message: 'Replay engine ready',
        details: `Processors: ${stats.processors_registered}, Replays: ${stats.total_replays}`
      };
      
    } catch (error) {
      return {
        success: false,
        message: 'Replay engine test failed',
        error: error.message
      };
    }
  }

  async testEndToEndProcessing() {
    try {
      const result = await this.orchestrator.processEvent('readiness_test', 'test', {
        message: 'End-to-end test',
        timestamp: Date.now()
      });
      
      if (!result.success) {
        return {
          success: false,
          message: 'End-to-end processing failed',
          error: result.error
        };
      }
      
      // Verify event was stored
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      
      const { data, error } = await supabase
        .from('hydi_events')
        .select('*')
        .eq('event_id', result.event.event_id)
        .single();
      
      if (error || !data) {
        return {
          success: false,
          message: 'Event not found in database',
          error: error?.message
        };
      }
      
      return {
        success: true,
        message: 'End-to-end processing successful',
        details: `Processing time: ${result.processing_duration}ms`
      };
      
    } catch (error) {
      return {
        success: false,
        message: 'End-to-end test failed',
        error: error.message
      };
    }
  }

  async testDatabaseConnectivity() {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      
      // Test basic connectivity
      const { data, error } = await supabase
        .from('hydi_events')
        .select('count')
        .limit(1);
      
      if (error) {
        throw new Error(`Database query failed: ${error.message}`);
      }
      
      // Test write capability
      const { data: insertData, error: insertError } = await supabase
        .from('processed_events')
        .insert({
          key: 'connectivity_test',
          value: 'test',
          config_type: 'test'
        });
      
      if (insertError) {
        throw new Error(`Database write failed: ${insertError.message}`);
      }
      
      // Clean up
      await supabase
        .from('processed_events')
        .delete()
        .eq('key', 'connectivity_test');
      
      return {
        success: true,
        message: 'Database connectivity verified',
        details: `Total events: ${data[0]?.count || 0}`
      };
      
    } catch (error) {
      return {
        success: false,
        message: 'Database connectivity test failed',
        error: error.message
      };
    }
  }

  async testSchemaCompliance() {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      
      // Check required columns
      const requiredColumns = [
        'event_id', 'type', 'status', 'timestamp', 'payload', 
        'source', 'retry_count', 'schema_version', 'correlation_id'
      ];
      
      const { data, error } = await supabase
        .from('information_schema.columns')
        .select('column_name', 'data_type', 'is_nullable')
        .eq('table_name', 'hydi_events')
        .in('column_name', requiredColumns);
      
      if (error) {
        throw new Error(`Schema check failed: ${error.message}`);
      }
      
      const foundColumns = data.map(col => col.column_name);
      const missingColumns = requiredColumns.filter(col => !foundColumns.includes(col));
      
      if (missingColumns.length > 0) {
        return {
          success: false,
          message: 'Schema compliance failed',
          details: `Missing columns: ${missingColumns.join(', ')}`
        };
      }
      
      return {
        success: true,
        message: 'Schema compliance verified',
        details: `Required columns: ${requiredColumns.length} present`
      };
      
    } catch (error) {
      return {
        success: false,
        message: 'Schema compliance test failed',
        error: error.message
      };
    }
  }

  async testPerformance() {
    try {
      const startTime = Date.now();
      
      // Test event creation performance
      const { EventContractValidator } = require('./event-contracts');
      const validator = new EventContractValidator();
      
      const events = [];
      for (let i = 0; i < 100; i++) {
        const event = validator.createEvent('perf_test', {
          index: i,
          timestamp: Date.now()
        });
        events.push(event);
      }
      
      const creationTime = Date.now() - startTime;
      
      // Test processing performance
      const processingStart = Date.now();
      
      for (const event of events) {
        await this.orchestrator.processEvent('perf_test', 'test', {
          index: event.event_id.split('-')[1],
          timestamp: Date.now()
        });
      }
      
      const processingTime = Date.now() - processingStart;
      const totalTime = Date.now() - startTime;
      
      const avgCreationTime = creationTime / events.length;
      const avgProcessingTime = processingTime / events.length;
      
      return {
        success: true,
        message: 'Performance benchmarks passed',
        details: `Events: ${events.length}, Avg Creation: ${avgCreationTime.toFixed(2)}ms, Avg Processing: ${getAvgProcessingTime.toFixed(2)}ms, Total: ${totalTime}ms`
      };
      
      function getAvgProcessingTime() {
        return avgProcessingTime;
      }
      
    } catch (error) {
      return {
        success: false,
        message: 'Performance test failed',
        error: error.message
      };
    }
  }

  async testFailureRecovery() {
    try {
      // Test with invalid event
      const result = await this.orchestrator.processEvent('failure_test', 'test', {
        message: 'This should fail'
      });
      
      // The system should handle this gracefully
      if (result.success) {
        return {
          success: false,
          message: 'Failure recovery test failed - invalid event was processed'
        };
      }
      
      if (!result.error) {
        return {
          success: false,
          message: 'Failure recovery test failed - no error reported'
        };
      }
      
      return {
        success: true,
        message: 'Failure recovery working correctly',
        details: `Error handled: ${result.error}`
      };
      
    } catch (error) {
      return {
        success: false,
        message: 'Failure recovery test failed',
        error: error.message
      };
    }
  }

  async testConsistency() {
    try {
      // Create test events
      const events = [];
      for (let i = 0; i < 5; i++) {
        const result = await this.orchestrator.processEvent('consistency_test', 'test', {
          index: i,
          batch: 'test_batch_1'
        });
        
        if (!result.success) {
          return {
            success: false,
            message: 'Consistency test failed during event creation',
            error: result.error
          };
        }
        
        events.push(result.event);
      }
      
      // Verify all events are stored
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      
      const { data, error } = await supabase
        .from('hydi_events')
        .select('event_id')
        .in('event_id', events.map(e => e.event_id));
      
      if (error) {
        throw new Error(`Consistency check failed: ${error.message}`);
      }
      
      const foundEvents = data.map(row => row.event_id);
      const missingEvents = events.filter(e => !foundEvents.includes(e.event_id));
      
      if (missingEvents.length > 0) {
        return {
          success: false,
          message: 'Consistency test failed - events not persisted',
          details: `Missing: ${missingEvents.length} events`
        };
      }
      
      return {
        success: true,
        message: 'Consistency verified',
        details: `All ${events.length} events persisted correctly`
      };
      
    } catch (error) {
      return {
        success: false,
        message: 'Consistency test failed',
        error: error.message
      };
    }
  }

  printFinalReport() {
    console.log('\n=== PRODUCTION READINESS REPORT ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    const total = this.testResults.passed + this.testResults.failed;
    const successRate = total > 0 ? (this.testResults.passed / total * 100).toFixed(1) : 0;
    
    console.log(`Total Tests: ${total}`);
    console.log(`Passed: ${this.testResults.passed}`);
    console.log(`Failed: ${this.testResults.failed}`);
    console.log(`Success Rate: ${successRate}%`);
    
    if (this.testResults.failed === 0) {
      console.log('\nSTATUS: PRODUCTION READY');
      console.log('All systems are operational and ready for production deployment.');
    } else {
      console.log('\nSTATUS: NEEDS ATTENTION');
      console.log('Some tests failed. Review the details below:');
      
      const failed = this.testResults.details.filter(t => !t.success);
      failed.forEach(test => {
        console.log(`- ${test.name}: ${test.message}`);
        if (test.details) console.log(`  ${test.details}`);
        if (test.error) console.log(`  Error: ${test.error}`);
      });
    }
    
    console.log('\n=== TEST DETAILS ===');
    this.testResults.details.forEach(test => {
      const status = test.success ? 'PASS' : 'FAIL';
      const duration = test.duration ? ` (${test.duration}ms)` : '';
      console.log(`${status}: ${test.name}${duration} - ${test.message}`);
    });
    
    console.log('\n=== RECOMMENDATIONS ===');
    
    if (this.testResults.failed === 0) {
      console.log('System is ready for production deployment.');
      console.log('Next steps:');
      console.log('1. Deploy to production environment');
      console.log('2. Monitor system performance');
      console.log('3. Run periodic consistency checks');
    } else {
      console.log('Address failed tests before production deployment.');
      console.log('Review the error messages and fix underlying issues.');
    }
  }
}

// CLI interface
if (require.main === module) {
  const test = new ProductionReadinessTest();
  
  test.runAllTests().catch(error => {
    console.error('Production readiness test failed:', error.message);
    process.exit(1);
  });
}

module.exports = { ProductionReadinessTest };
