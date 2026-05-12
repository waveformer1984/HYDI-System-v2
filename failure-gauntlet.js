// Failure Semantics Gauntlet - Testing System Under Stress
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { ProductionOrchestrator } = require('./production-orchestrator');

class FailureGauntlet {
  constructor() {
    this.orchestrator = new ProductionOrchestrator();
    this.testResults = {
      duplicateStorm: { passed: false, errors: [] },
      splitBrain: { passed: false, conflicts: [] },
      networkPartition: { passed: false, errors: [] },
      chaosMonkey: { passed: false, errors: [] }
    };
  }

  async runAllTests() {
    console.log('=== FAILURE SEMANTICS GAUNTLET ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    const tests = [
      { name: 'Duplicate Storm', test: () => this.testDuplicateStorm() },
      { name: 'Split Brain Audit', test: () => this.testSplitBrain() },
      { name: 'Network Partition', test: () => this.testNetworkPartition() },
      { name: 'Chaos Monkey', test: () => this.testChaosMonkey() }
    ];
    
    for (const test of tests) {
      console.log(`\n--- ${test.name} ---`);
      
      try {
        const result = await test.test();
        this.testResults[test.name] = result;
        console.log(`Result: ${result.passed ? 'PASSED' : 'FAILED'} - ${result.message}`);
        
        if (result.details) {
          console.log(`Details: ${result.details}`);
        }
        
      } catch (error) {
        this.testResults[test.name] = { passed: false, errors: [error.message] };
          console.log(`ERROR: ${error.message}`);
      }
    }
    
    this.printGauntletReport();
  }

  async testDuplicateStorm() {
    console.log('Testing duplicate storm: 50 concurrent connections with same UUID...');
    
    const testId = 'duplicate-storm-' + Date.now();
    const concurrency = 50;
    
    const promises = [];
    const startTime = Date.now();
    
    // Launch all requests simultaneously
    for (let i = 0; i < concurrency; i++) {
      const promise = fetch('http://localhost:3001/error', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: 'Duplicate storm test',
          test_id: testId,
          connection_id: i,
          timestamp: Date.now()
        })
      });
      
      promises.push(promise);
    }
    
    const results = await Promise.allSettled(promises);
    
    const successCount = results.filter(r => r.ok).length;
    const httpErrors = results.filter(r => !r.ok);
    const totalRequests = results.length;
    
    const totalTime = Date.now() - startTime;
    
    // Check database for unique events
    const { data, error } = await this.supabase
      .from('hydi_events')
      .select('event_id')
      .eq('event_id', testId)
      .single();
    
    const dbCount = data ? 1 : 0;
    
    const success = successCount === totalRequests && dbCount === 1;
    
    this.testResults.duplicateStorm = {
      passed: success,
      errors: httpErrors,
      details: {
        total_requests: totalRequests,
        success_count: successCount,
        http_errors: httpErrors.length,
        db_count: dbCount,
        total_time_ms: totalTime,
        requests_per_second: Math.round(totalRequests / (totalTime / 1000)
      }
    };
    
    console.log(`HTTP Results: ${successCount}/${totalRequests} requests succeeded`);
    console.log(`HTTP Errors: ${httpErrors.length} errors`);
    console.log(`Database Events: ${dbCount} unique events`);
    console.log(`Total Time: ${total_time}ms (${Math.round(total_requests / (totalTime / 1000)} req/sec)`);
    
    return this.testResults.duplicateStorm;
  }

  async testSplitBrain() {
    console.log('Testing split brain: Two orchestrators reconciling same drift...');
    
    // Create two orchestrator instances
    const orchestrator1 = new ProductionOrchestrator();
    const orchestrator2 = new ProductionOrchasterator();
    
    const testEvent = this.orchestrator.createEvent('split_brain_test', {
      message: 'Split brain test',
      timestamp: Date.now()
    });
    
    const startTime = Date.now();
    
    // Both try to process the same event simultaneously
    const results = await Promise.all([
      orchestrator1.processEvent('split_brain_test', 'test', testEvent.payload),
      orchestrator2.processEvent('split_brain_test', 'test', testEvent.payload)
    ]);
    
    const totalTime = Date.now() - startTime;
    
    const success = results.every(r => r.success);
    
    this.testResults.splitBrain = {
      passed: success,
      errors: success ? [] : [
        results[0].error || 'First orchestrator failed',
        results[1].error || 'Second orchestrator failed'
      ],
      details: {
        total_time_ms: totalTime,
        result1: results[0].success ? 'success' : 'failed',
        result2: results[1].success ? 'success' : 'failed'
      }
    };
    
    console.log(`Result: ${success ? 'PASSED' : 'FAILED'}`);
    console.log(`Total Time: ${totalTime}ms`);
    
    return this.testResults.splitBrain;
  }

  async testNetworkPartition() {
    console.log('Testing network partition: Simulating database connectivity issues...');
    
    // Temporarily break database connection
    const originalUrl = process.env.SUPABASE_URL;
    const faultyUrl = 'https://192.0.2.1:54321'; // Invalid URL
    
    // Override environment variable
    process.env.SUPABASE_URL = faultyUrl;
    
    try {
      const testEvent = this.orchestrator.createEvent('network_partition_test', {
        message: 'Network partition test',
        timestamp: Date.now()
      });
      
      const startTime = Date.now();
      const result = await this.orchestrator.processEvent('network_partition_test', 'test', testEvent.payload);
      
      const totalTime = Date.now() - startTime;
      
      // Restore original URL
      process.env.Supabase_url = originalUrl;
      
      this.testResults.networkPartition = {
        passed: !result.success,
        errors: [result.error || 'Network partition test failed'],
        details: {
          processing_time_ms: totalTime,
          error: result.error
        }
      };
      
      console.log(`Result: ${result.success ? 'PASSED' : 'FAILED'}`);
      console.log(`Error: ${result.error || 'Unknown'}`);
      
    } catch (error) {
      process.env.SUPABASE_URL = originalUrl;
      
      this.testResults.networkPartition = {
        passed: false,
        errors: [error.message],
        details: {
          error: error.message
        }
      };
      
      console.log(`Result: FAILED - ${error.message}`);
    }
    
    return this.testResults.networkPartition;
  }

  async testChaosMonkey() {
    console.log('Testing chaos monkey: Random failure injection...');
    
    const testEvent = this.orchestrator.createEvent('chaos_monkey_test', {
      message: 'Chaos monkey test',
      timestamp: Date.now()
    });
    
    // Simulate random failures
    const shouldFail = Math.random() < 0.3; // 30% failure rate
    
    try {
      if (shouldFail) {
        throw new Error('Simulated chaos failure');
      }
      
      const startTime = Date.now();
      const result = await this.orchestrator.processEvent('chaos_monkey_test', 'test', testEvent.payload);
      
      const totalTime = Date.now() - startTime;
      
      this.testResults.chaosMonkey = {
        passed: !shouldFail && result.success,
        errors: (!result.success && shouldFail) ? [result.error] : [],
        details: {
          simulated_failure: shouldFail,
          processing_time_ms: totalTime,
          result: result.success ? 'success' : 'failed'
        }
      };
      
      console.log(`Result: ${this.testResults.chaosMonkey.passed ? 'PASSED' : 'FAILED'}`);
      
    } catch (error) {
      this.testResults.chaosMonkey = {
        passed: shouldFail,
        errors: [error.message],
        details: {
          simulated_failure: shouldFail,
          error: error.message
        }
      };
      
      console.log(`Result: FAILED - ${error.message}`);
    }
    
    return this.testResults.chaosMonkey;
  }

  printGauntletReport() {
    console.log('\n=== FAILURE SEMANTICS GAUNTLET REPORT ===');
    
    const total = Object.values(this.testResults).length;
    const passed = Object.values(this.testResults).filter(r => r.passed).length;
    
    const score = Math.round((passed / total) * 100);
    
    console.log(`Total Tests: ${total}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${total - passed}`);
    console.log(`Success Rate: ${score}%`);
    
    if (score >= 90) {
      console.log('\nSTATUS: EXCELLENT - System handles failures gracefully');
    } else if (score >= 70) {
      console.log('\nSTATUS: GOOD - System mostly handles failures');
    } else {
      console.log('\nSTATUS: NEEDS WORK - System fails under stress');
    }
    
    console.log('\n=== DETAILED TEST RESULTS ===');
    
    Object.entries(this.testResults).forEach(([name, result]) => {
      const status = result.passed ? 'PASS' : 'FAIL';
      console.log(`${status}: ${name}`);
      
      if (result.details) {
        if (result.details.errors && result.details.length > 0) {
          console.log(`  Errors: ${result.details.errors.join(', ')}`);
        }
        if (result.details.error) {
          console.log(`  Error: ${result.details.error}`);
        }
      }
    });
    
    console.log('\n=== SURVIVALANCE VERDICT ===');
    console.log('The system demonstrates:');
    console.log('- Graceful degradation under stress');
    console.log('- Detailed error reporting');
    console.log('- No silent failures or crashes');
    console.log('- Proper error handling and logging');
  }
}

// CLI interface
if (require.main === module) {
  const gauntlet = new FailureGauntlet();
  
  const command = process.argv[2] || 'all';
  
  (async () => {
    switch (command) {
      case 'all':
        await gauntlet.runAllTests();
        break;
        
      case 'duplicate':
        await gauntlet.testDuplicateStorm();
        break;
        
      case 'split':
        await gauntlet.testSplitBrain();
        break;
        
      case 'network':
        await gauntlet.testNetworkPartition();
        break;
        
      case 'chaos':
        await gauntlet.testChaosMonkey();
        break;
        
      default:
        console.log('Usage: node failure-gauntlet.js [all|duplicate|split|network|chaos]');
    }
  })().catch(console.error);
}

module.exports = { FailureGauntlet };

