// Complete Production Readiness Test Suite
require('dotenv').config();

class CompleteReadinessSuite {
  constructor() {
    this.testResults = {
      preflight: { passed: false, errors: [] },
      pipeline: { passed: false, errors: [] },
      orchestrator: { passed: false, errors: [] },
      deployment: { passed: false, errors: [] },
      performance: { passed: false, errors: [] },
      chaos: { passed: false, errors: [] },
      integration: { passed: false, errors: [] }
    };
    
    this.overall = { passed: false, errors: [], score: 0 };
  }

  async runCompleteSuite() {
    console.log('=== COMPLETE PRODUCTION READINESS SUITE ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'production'}`);
    
    const tests = [
      { name: 'Pre-Flight Schema Check', test: () => this.testPreFlight() },
      { name: 'Complete Event Pipeline', test: () => this.testPipeline() },
      { name: 'Production Orchestrator', test: () => this.testOrchestrator() },
      { name: 'Deployment Automation', test: () => this.testDeployment() },
      { name: 'Performance Benchmarks', test: () => this.testPerformance() },
      { name: 'Chaos Engineering', test: () => this.testChaos() },
      { name: 'Integration Tests', test: () => this.testIntegration() }
    ];
    
    for (const test of tests) {
      console.log(`\n--- ${test.name} ---`);
      
      try {
        const startTime = Date.now();
        const result = await test.test();
        const duration = Date.now() - startTime;
        
        this.testResults[test.name] = {
          success: result.success,
          errors: result.errors || [],
          duration,
          details: result.details || null
        };
        
        const status = result.success ? 'PASS' : 'FAIL';
        console.log(`${status} (${duration}ms): ${test.name}`);
        
        if (result.details) {
          console.log(`Details: ${result.details}`);
        }
        
      } catch (error) {
        const duration = Date.now() - startTime;
        
        this.testResults[test.name] = {
          success: false,
          errors: [error.message],
          duration
        };
        
        console.log(`ERROR (${duration}ms): ${test.name} - ${error.message}`);
      }
    }
    
    this.calculateOverallScore();
    this.printCompleteReport();
    
    return this.overall;
  }

  async testPreFlight() {
    try {
      const { EnhancedPreFlightCheck } = require('./enhanced-preflight-check');
      const check = new EnhancedPreFlightCheck();
      
      const results = await check.runEnhancedCheck();
      
      return {
        success: results.overall.passed,
        errors: results.overall.errors || [],
        details: `${Object.values(results).filter(r => r.name && r.passed).length}/4 methods passed`
      };
      
    } catch (error) {
      return {
        success: false,
        errors: [error.message],
        details: 'Pre-flight check failed'
      };
    }
  }

  async testPipeline() {
    try {
      const { CompleteEventPipeline } = require('./complete-event-pipeline');
      const pipeline = new CompleteEventPipeline();
      
      const result = await pipeline.testCompletePipeline();
      
      return {
        success: result.success,
        errors: result.errors || [],
        details: result.details || 'Pipeline test completed'
      };
      
    } catch (error) {
      return {
        success: false,
        errors: [error.message],
        details: 'Pipeline test failed'
      };
    }
  }

  async testOrchestrator() {
    try {
      const { ProductionOrchestrator } = require('./production-orchestrator');
      const orchestrator = new ProductionOrchestrator();
      
      // Test orchestrator audit
      const health = await orchestrator.healthCheck();
      
      if (health.status !== 'healthy') {
        throw new Error(`Orchestrator not healthy: ${JSON.stringify(health.components)}`);
      }
      
      return {
        success: true,
        errors: [],
        details: 'Orchestrator is healthy and ready'
      };
      
    } catch (error) {
      return {
        success: false,
        errors: [error.message],
        details: 'Orchestrator test failed'
      };
    }
  }

  async testDeployment() {
    try {
      const { ProductionDeployment } = require('./production-deployment');
      const deployment = new ProductionDeployment();
      
      const result = await deployment.quickCheck();
      
      return {
        success: result.failed === 0,
        errors: result.details || [],
        details: `Quick check: ${result.passed}/${result.passed + result.failed} checks passed`
      };
      
    } catch (error) {
      return {
        success: false,
        errors: [error.message],
        details: 'Deployment test failed'
      };
    }
  }

  async testPerformance() {
    try {
      const { PerformanceBenchmarks } = require('./performance-benchmarks');
      const benchmarks = new PerformanceBenchmarks();
      
      // Test event creation
      const creationResult = await benchmarks.benchmarkEventCreation();
      
      if (!creationResult.success) {
        throw new Error(`Event creation benchmark failed: ${creationResult.error}`);
      }
      
      // Test warm throughput
      const throughputResult = await benchmarks.benchmarkWarmThroughput();
      
      if (!throughputResult.success) {
        throw new Error(`Throughput benchmark failed: ${throughputResult.error}`);
      }
      
      // Check if performance is acceptable
      const avgTime = parseFloat(throughputResult.details.avg_time_ms);
      const threshold = 100; // 100ms threshold
      
      if (avgTime > threshold) {
        throw new Error(`Performance threshold exceeded: ${avgTime}ms > ${threshold}ms`);
      }
      
      return {
        success: true,
        errors: [],
        details: `Performance acceptable - avg time: ${avgTime}ms (threshold: ${threshold}ms)`,
        metrics: {
          creation: creationResult.details,
          throughput: throughputResult.details
        }
      };
      
    } catch (error) {
      return {
        success: false,
        errors: [error.message],
        details: 'Performance test failed'
      };
    }
  }

  async testChaos() {
    try {
      const { ChaosEngine } = require('./chaos-engine');
      const chaos = new ChaosEngine();
      
      // Test memory pressure
      const memoryResult = await chaos.testMemoryPressure();
      
      if (!memoryResult.passed) {
        throw new Error(`Memory pressure test failed: ${memoryResult.errors.join(', ')}`);
      }
      
      // Test partial outage (short duration for readiness test)
      const outageResult = await chaos.simulatePartialOutage(3000); // 3 seconds
      
      if (!outageResult.bufferTest.passed) {
        throw new Error(`Partial outage test failed: ${outageResult.bufferTest.errors.join(', ')}`);
      }
      
      return {
        success: true,
        errors: [],
        details: 'Chaos tests passed',
        chaos: {
          memory: memoryResult,
          outage: outageResult
        }
      };
      
    } catch (error) {
      return {
        success: false,
        errors: [error.message],
        details: 'Chaos test failed'
      };
    }
  }

  async testIntegration() {
    try {
      // Test end-to-end integration
      const { CompleteEventPipeline } = require('./complete-event-pipeline');
      const pipeline = new CompleteEventPipeline();
      
      // Test multiple event types
      const testEvents = [
        { type: 'error', payload: { message: 'Integration test error' } },
        { type: 'system', payload: { message: 'Integration test system' } },
        { type: 'payment', payload: { amount: 100, currency: 'usd' } }
      ];
      
      const results = [];
      
      for (const event of testEvents) {
        const result = await pipeline.processEvent('integration_test', event.type, event.payload);
        results.push({ type: event.type, success: result.success });
      }
      
      const failedEvents = results.filter(r => !r.success);
      
      if (failedEvents.length > 0) {
        throw new Error(`Integration test failed: ${failedEvents.map(f => f.type).join(', ')}`);
      }
      
      return {
        success: true,
        errors: [],
        details: `Integration test passed - ${results.length} events processed`
      };
      
    } catch (error) {
      return {
        success: false,
        errors: [error.message],
        details: 'Integration test failed'
      };
    }
  }

  calculateOverallScore() {
    const totalTests = Object.keys(this.testResults).length;
    const passedTests = Object.values(this.testResults).filter(t => t.success).length;
    
    this.overall.score = Math.round((passedTests / totalTests) * 100);
    this.overall.passed = this.overall.score >= 85; // 85% threshold for production readiness
    this.overall.errors = Object.values(this.testResults).flatMap(t => t.errors);
  }

  printCompleteReport() {
    console.log('\n=== COMPLETE PRODUCTION READINESS REPORT ===');
    
    const totalTests = Object.keys(this.testResults).length;
    const passedTests = Object.values(this.testResults).filter(t => t.success).length;
    
    console.log(`Total Tests: ${totalTests}`);
    console.log(`Passed: ${passedTests}`);
    console.log(`Failed: ${totalTests - passedTests}`);
    console.log(`Readiness Score: ${this.overall.score}%`);
    
    console.log('\n=== TEST RESULTS ===');
    
    Object.entries(this.testResults).forEach(([name, result]) => {
      const status = result.success ? 'PASS' : 'FAIL';
      const duration = result.duration ? ` (${result.duration}ms)` : '';
      
      console.log(`${status}: ${name}${duration}`);
      
      if (result.errors && result.errors.length > 0) {
        result.errors.forEach(error => {
          console.log(`  - ${error}`);
        });
      }
      
      if (result.details) {
        console.log(`  Details: ${result.details}`);
      }
    });
    
    console.log('\n=== READINESS ASSESSMENT ===');
    
    if (this.overall.passed) {
      console.log('STATUS: PRODUCTION READY');
      console.log('System has passed all critical tests and is ready for production deployment');
      
      console.log('\n=== PRODUCTION CHECKLIST ===');
      console.log('1. Environment variables configured');
      console.log('2. Database schema validated');
      console.log('3. Event pipeline functional');
      console.log('4. Orchestrator healthy');
      console.log('5. Performance acceptable');
      console.log('6. Chaos resilience verified');
      console.log('7. Integration tests passed');
      
      console.log('\n=== DEPLOYMENT RECOMMENDATIONS ===');
      console.log('1. Run full deployment: node production-deployment.js deploy');
      console.log('2. Monitor system: node production-orchestrator.js health');
      console.log('3. Set up alerting and monitoring');
      console.log('4. Configure backup and recovery procedures');
      
    } else {
      console.log('STATUS: NOT PRODUCTION READY');
      console.log('System has failed critical tests and requires attention');
      
      console.log('\n=== BLOCKING ISSUES ===');
      this.overall.errors.forEach(error => {
        console.log(`- ${error}`);
      });
      
      console.log('\n=== REMEDIATION PLAN ===');
      console.log('1. Fix all failing tests');
      console.log('2. Re-run readiness suite');
      console.log('3. Address any blocking issues');
      console.log('4. Ensure all critical components pass');
    }
  }

  // Quick readiness check
  async quickCheck() {
    console.log('=== QUICK PRODUCTION READINESS CHECK ===');
    
    const criticalTests = [
      { name: 'Environment', test: () => this.testPreFlight() },
      { name: 'Pipeline', test: () => this.testPipeline() },
      { name: 'Orchestrator', test: () => this.testOrchestrator() }
    ];
    
    let passed = 0;
    let failed = 0;
    
    for (const test of criticalTests) {
      try {
        const result = await test.test();
        if (result.success) {
          passed++;
          console.log(`${test.name}: PASS`);
        } else {
          failed++;
          console.log(`${test.name}: FAIL`);
        }
      } catch (error) {
        failed++;
        console.log(`${test.name}: ERROR - ${error.message}`);
      }
    }
    
    const score = Math.round((passed / (passed + failed)) * 100);
    
    console.log(`\nQuick Check: ${passed}/${passed + failed} passed (${score}%)`);
    
    if (score >= 85) {
      console.log('STATUS: PRODUCTION READY');
    } else {
      console.log('STATUS: NOT PRODUCTION READY');
    }
    
    return { passed, failed, score };
  }
}

// CLI interface
if (require.main === module) {
  const suite = new CompleteReadinessSuite();
  
  const command = process.argv[2] || 'complete';
  
  (async () => {
    switch (command) {
      case 'complete':
        await suite.runCompleteSuite();
        break;
        
      case 'quick':
        await suite.quickCheck();
        break;
        
      case 'preflight':
        await suite.testPreFlight();
        break;
        
      case 'pipeline':
        await suite.testPipeline();
        break;
        
      case 'orchestrator':
        await suite.testOrchestrator();
        break;
        
      case 'deployment':
        await suite.testDeployment();
        break;
        
      case 'performance':
        await suite.testPerformance();
        break;
        
      case 'chaos':
        await suite.testChaos();
        break;
        
      case 'integration':
        await suite.testIntegration();
        break;
        
      default:
        console.log('Usage: node complete-readiness-suite.js [complete|quick|preflight|pipeline|orchestrator|deployment|performance|chaos|integration]');
    }
  })().catch(console.error);
}

module.exports = { CompleteReadinessSuite };
