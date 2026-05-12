// Chaos Engine - Simulate Partial DB Outage and Test System Resilience
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { ProductionOrchestrator } = require('./production-orchestrator');

class ChaosEngine {
  constructor() {
    this.orchestrator = new ProductionOrchestrator();
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    this.chaosActive = false;
    this.eventBuffer = [];
    this.maxBufferSize = 1000;
    this.testResults = {
      bufferTest: { passed: false, errors: [] },
      memoryTest: { passed: false, errors: [] },
      recoveryTest: { passed: false, errors: [] }
    };
  }

  // Simulate partial DB outage
  async simulatePartialOutage(duration = 30000) {
    console.log(`=== CHAOS: SIMULATING PARTIAL DB OUTAGE ===`);
    console.log(`Duration: ${duration}ms`);
    console.log(`Max Buffer Size: ${this.maxBufferSize}`);
    
    this.chaosActive = true;
    this.eventBuffer = [];
    
    const startTime = Date.now();
    const endTime = startTime + duration;
    
    // Override the orchestrator's database methods
    const originalInsert = this.orchestrator.supabase.from;
    
    // Mock database failure
    this.orchestrator.supabase.from = (table) => {
      return {
        insert: (data) => {
          return Promise.resolve({
            data: [],
            error: { message: '503 Service Unavailable - Partial DB Outage' }
          });
        },
        select: (columns) => {
          return Promise.resolve({
            data: [],
            error: { message: '503 Service Unavailable - Partial DB Outage' }
          });
        }
      };
    };
    
    // Generate test events during outage
    const eventInterval = setInterval(() => {
      if (Date.now() < endTime && this.chaosActive) {
        this.generateTestEvent();
      } else {
        clearInterval(eventInterval);
      }
    }, 100); // Generate event every 100ms
    
    // Monitor buffer during outage
    const monitorInterval = setInterval(() => {
      if (Date.now() < endTime && this.chaosActive) {
        this.monitorBuffer();
      } else {
        clearInterval(monitorInterval);
      }
    }, 1000); // Monitor every 1 second
    
    // Wait for outage to end
    await new Promise(resolve => setTimeout(resolve, duration));
    
    // Restore database connection
    this.orchestrator.supabase.from = originalInsert;
    this.chaosActive = false;
    
    console.log('CHAOS: Partial DB outage ended');
    
    // Drain buffer
    await this.drainBuffer();
    
    return this.testResults;
  }

  generateTestEvent() {
    const event = {
      event_id: `chaos-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'chaos_test',
      status: 'pending',
      timestamp: new Date().toISOString(),
      source: 'chaos_engine',
      retry_count: 0,
      schema_version: '1.2.0',
      correlation_id: `chaos-${Date.now()}`,
      payload: {
        message: 'Chaos test event',
        timestamp: Date.now(),
        buffer_size: this.eventBuffer.length
      }
    };
    
    // Add to buffer
    this.eventBuffer.push({
      event,
      timestamp: Date.now(),
      buffered: true
    });
    
    // Check buffer overflow
    if (this.eventBuffer.length > this.maxBufferSize) {
      console.log(`CHAOS: Buffer overflow - dropping oldest event`);
      this.eventBuffer.shift(); // Remove oldest
    }
  }

  monitorBuffer() {
    const bufferSize = this.eventBuffer.length;
    const memoryUsage = process.memoryUsage();
    
    console.log(`Buffer Status: ${bufferSize}/${this.maxBufferSize} events`);
    console.log(`Memory Usage: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`);
    
    // Test memory pressure
    if (memoryUsage.heapUsed > 500 * 1024 * 1024) { // 500MB
      console.log('CHAOS: High memory pressure detected');
      this.testResults.memoryTest.errors.push('High memory pressure');
    }
    
    // Test buffer pressure
    if (bufferSize > this.maxBufferSize * 0.8) {
      console.log('CHAOS: Buffer pressure high');
      this.testResults.bufferTest.errors.push('Buffer pressure high');
    }
  }

  async drainBuffer() {
    console.log(`CHAOS: Draining buffer (${this.eventBuffer.length} events)`);
    
    const startTime = Date.now();
    const drainedEvents = [];
    const failedEvents = [];
    
    // Drain events in order
    while (this.eventBuffer.length > 0) {
      const bufferedEvent = this.eventBuffer.shift();
      
      try {
        const result = await this.orchestrator.processEvent(
          bufferedEvent.event.source,
          bufferedEvent.event.type,
          bufferedEvent.event.payload
        );
        
        if (result.success) {
          drainedEvents.push(bufferedEvent.event.event_id);
        } else {
          failedEvents.push({
            event_id: bufferedEvent.event.event_id,
            error: result.error
          });
        }
        
      } catch (error) {
        failedEvents.push({
          event_id: bufferedEvent.event.event_id,
          error: error.message
        });
      }
      
      // Small delay to prevent overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    const drainTime = Date.now() - startTime;
    
    console.log(`CHAOS: Buffer drained in ${drainTime}ms`);
    console.log(`Drained: ${drainedEvents.length} events`);
    console.log(`Failed: ${failedEvents.length} events`);
    
    // Update test results
    this.testResults.bufferTest.passed = failedEvents.length === 0;
    this.testResults.bufferTest.drained = drainedEvents.length;
    this.testResults.bufferTest.failed = failedEvents.length;
    this.testResults.bufferTest.drainTime = drainTime;
    
    this.testResults.recoveryTest.passed = failedEvents.length < drainedEvents.length * 0.1; // Less than 10% failure rate
    this.testResults.recoveryTest.totalEvents = drainedEvents.length + failedEvents.length;
    this.testResults.recoveryTest.failureRate = (failedEvents.length / (drainedEvents.length + failedEvents.length)) * 100;
    
    return {
      drained: drainedEvents.length,
      failed: failedEvents.length,
      drainTime,
      failureRate: this.testResults.recoveryTest.failureRate
    };
  }

  // Test memory pressure
  async testMemoryPressure() {
    console.log('=== CHAOS: MEMORY PRESSURE TEST ===');
    
    const initialMemory = process.memoryUsage();
    console.log(`Initial memory: ${Math.round(initialMemory.heapUsed / 1024 / 1024)}MB`);
    
    // Fill buffer with large events
    for (let i = 0; i < this.maxBufferSize; i++) {
      const event = {
        event_id: `memory-test-${i}`,
        type: 'memory_pressure_test',
        status: 'pending',
        timestamp: new Date().toISOString(),
        source: 'chaos_engine',
        retry_count: 0,
        schema_version: '1.2.0',
        correlation_id: `memory-test-${i}`,
        payload: {
          message: 'Memory pressure test',
          timestamp: Date.now(),
          // Large payload to increase memory usage
          large_data: Array(1000).fill(`data_${i}`).join(''),
          metadata: {
            test: true,
            index: i,
            buffer_size: this.eventBuffer.length
          }
        }
      };
      
      this.eventBuffer.push({ event, timestamp: Date.now(), buffered: true });
    }
    
    const peakMemory = process.memoryUsage();
    console.log(`Peak memory: ${Math.round(peakMemory.heapUsed / 1024 / 1024)}MB`);
    console.log(`Memory increase: ${Math.round((peakMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024)}MB`);
    
    // Check if memory usage is reasonable
    const memoryIncrease = (peakMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024;
    
    this.testResults.memoryTest.passed = memoryIncrease < 100; // Less than 100MB increase
    this.testResults.memoryTest.initialMemory = Math.round(initialMemory.heapUsed / 1024 / 1024);
    this.testResults.memoryTest.peakMemory = Math.round(peakMemory.heapUsed / 1024 / 1024);
    this.testResults.memoryTest.increase = Math.round(memoryIncrease);
    
    // Clear buffer
    this.eventBuffer = [];
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
    
    const finalMemory = process.memoryUsage();
    console.log(`Final memory: ${Math.round(finalMemory.heapUsed / 1024 / 1024)}MB`);
    
    return this.testResults.memoryTest;
  }

  // Run complete chaos test suite
  async runChaosTestSuite() {
    console.log('=== CHAOS ENGINE TEST SUITE ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    const tests = [
      { name: 'Memory Pressure', test: () => this.testMemoryPressure() },
      { name: 'Partial DB Outage', test: () => this.simulatePartialOutage(30000) }
    ];
    
    for (const test of tests) {
      console.log(`\n--- ${test.name} ---`);
      
      try {
        const result = await test.test();
        console.log(`Result: ${result.passed ? 'PASSED' : 'FAILED'}`);
        
      } catch (error) {
        console.log(`ERROR: ${error.message}`);
      }
    }
    
    this.printChaosReport();
  }

  printChaosReport() {
    console.log('\n=== CHAOS ENGINE REPORT ===');
    
    const totalTests = Object.keys(this.testResults).length;
    const passedTests = Object.values(this.testResults).filter(r => r.passed).length;
    const score = Math.round((passedTests / totalTests) * 100);
    
    console.log(`Total Tests: ${totalTests}`);
    console.log(`Passed: ${passedTests}`);
    console.log(`Failed: ${totalTests - passedTests}`);
    console.log(`Chaos Score: ${score}%`);
    
    console.log('\n=== DETAILED RESULTS ===');
    
    Object.entries(this.testResults).forEach(([name, result]) => {
      const status = result.passed ? 'PASS' : 'FAIL';
      console.log(`${status}: ${name}`);
      
      if (result.errors && result.errors.length > 0) {
        result.errors.forEach(error => {
          console.log(`  - ${error}`);
        });
      }
    });
    
    console.log('\n=== CHAOS SURVIVAL VERDICT ===');
    
    if (score >= 80) {
      console.log('STATUS: EXCELLENT - System survives chaos gracefully');
    } else if (score >= 60) {
      console.log('STATUS: GOOD - System mostly handles chaos');
    } else {
      console.log('STATUS: NEEDS WORK - System fails under chaos');
    }
    
    console.log('\n=== RECOMMENDATIONS ===');
    
    if (this.testResults.bufferTest.failed > 0) {
      console.log('- Consider increasing buffer size or implementing backpressure');
    }
    
    if (this.testResults.memoryTest.increase > 50) {
      console.log('- Consider implementing memory usage monitoring and limits');
    }
    
    if (this.testResults.recoveryTest.failureRate > 5) {
      console.log('- Consider implementing retry logic with exponential backoff');
    }
  }
}

// CLI interface
if (require.main === module) {
  const chaos = new ChaosEngine();
  
  const command = process.argv[2] || 'suite';
  
  (async () => {
    switch (command) {
      case 'suite':
        await chaos.runChaosTestSuite();
        break;
        
      case 'outage':
        const duration = parseInt(process.argv[3]) || 30000;
        await chaos.simulatePartialOutage(duration);
        break;
        
      case 'memory':
        await chaos.testMemoryPressure();
        break;
        
      case 'buffer':
        await chaos.monitorBuffer();
        break;
        
      default:
        console.log('Usage: node chaos-engine.js [suite|outage|memory|buffer] [duration_ms]');
    }
  })().catch(console.error);
}

module.exports = { ChaosEngine };
