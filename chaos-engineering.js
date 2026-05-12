require('dotenv').config();

// Chaos Engineering: Test observability loop under stress
class ChaosEngineering {
  constructor() {
    this.testResults = [];
    this.isRunning = false;
  }

  async runChaosSuite() {
    console.log('=== CHAOS ENGINEERING SUITE ===\n');
    
    // Test 1: Database Disconnect Mid-Stream
    await this.testDatabaseDisconnect();
    
    // Test 2: ProtoForge Overload
    await this.testProtoForgeOverload();
    
    // Test 3: AI Service Failure
    await this.testAIServiceFailure();
    
    // Test 4: Network Partitions
    await this.testNetworkPartitions();
    
    this.printResults();
  }

  async testDatabaseDisconnect() {
    console.log('1. Testing Database Disconnect Mid-Stream...\n');
    
    const originalUrl = process.env.SUPABASE_URL;
    const originalKey = process.env.SUPABASE_KEY;
    
    try {
      // Start normal events
      console.log('Starting normal event flow...');
      const normalEvents = await this.sendEvents(5, 'normal');
      
      // Break database connection
      console.log('Breaking database connection...');
      process.env.SUPABASE_URL = 'https://invalid.supabase.co';
      process.env.SUPABASE_KEY = 'invalid-key';
      
      // Send events during disconnect
      console.log('Sending events during disconnect...');
      const disconnectEvents = await this.sendEvents(5, 'disconnect');
      
      // Wait for failure detection
      await this.sleep(3000);
      
      // Restore connection
      console.log('Restoring database connection...');
      process.env.SUPABASE_URL = originalUrl;
      process.env.SUPABASE_KEY = originalKey;
      
      // Send recovery events
      console.log('Sending recovery events...');
      const recoveryEvents = await this.sendEvents(5, 'recovery');
      
      this.testResults.push({
        test: 'Database Disconnect',
        normal: normalEvents.success,
        disconnect: disconnectEvents.failed, // Should fail
        recovery: recoveryEvents.success,
        passed: normalEvents.success > 0 && disconnectEvents.failed > 0 && recoveryEvents.success > 0
      });
      
    } catch (error) {
      console.log('Database disconnect test failed:', error.message);
      this.testResults.push({
        test: 'Database Disconnect',
        error: error.message,
        passed: false
      });
    }
  }

  async testProtoForgeOverload() {
    console.log('\n2. Testing ProtoForge Overload...\n');
    
    try {
      // Flood with 500 events
      console.log('Flooding with 500 events...');
      const startTime = Date.now();
      
      const promises = [];
      for (let i = 0; i < 500; i++) {
        promises.push(this.sendSingleEvent(i, 'overload'));
      }
      
      const results = await Promise.all(promises);
      const endTime = Date.now();
      
      const success = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      const duration = endTime - startTime;
      
      this.testResults.push({
        test: 'ProtoForge Overload',
        success,
        failed,
        duration,
        throughput: (500 / (duration / 1000)).toFixed(2),
        passed: success >= 400 // At least 80% success
      });
      
    } catch (error) {
      console.log('ProtoForge overload test failed:', error.message);
      this.testResults.push({
        test: 'ProtoForge Overload',
        error: error.message,
        passed: false
      });
    }
  }

  async testAIServiceFailure() {
    console.log('\n3. Testing AI Service Failure...\n');
    
    try {
      // Send error events (trigger AI analysis)
      console.log('Sending error events to trigger AI analysis...');
      const aiEvents = await this.sendEvents(10, 'error', { type: 'error' });
      
      // Simulate AI service failure by breaking the analyzer
      console.log('Simulating AI service failure...');
      const originalAnalyzer = require('./core/ai-analyzer');
      
      // Temporarily break AI analyzer
      const fs = require('fs');
      const aiAnalyzerPath = './core/ai-analyzer.js';
      const originalContent = fs.readFileSync(aiAnalyzerPath, 'utf8');
      
      // Break the AI analyzer
      fs.writeFileSync(aiAnalyzerPath, `
        // Broken AI analyzer for chaos test
        async function analyzeError(event) {
          throw new Error('AI service unavailable');
        }
        module.exports = { analyzeError };
      `);
      
      // Clear require cache
      delete require.cache[require.resolve('./core/ai-analyzer')];
      
      // Send more error events during AI failure
      console.log('Sending events during AI failure...');
      const failureEvents = await this.sendEvents(10, 'ai-failure', { type: 'error' });
      
      // Restore AI analyzer
      fs.writeFileSync(aiAnalyzerPath, originalContent);
      delete require.cache[require.resolve('./core/ai-analyzer')];
      
      this.testResults.push({
        test: 'AI Service Failure',
        aiEvents: aiEvents.success,
        failureEvents: failureEvents.success, // Should still succeed but with AI failures
        passed: aiEvents.success > 0 && failureEvents.success > 0
      });
      
    } catch (error) {
      console.log('AI service failure test failed:', error.message);
      this.testResults.push({
        test: 'AI Service Failure',
        error: error.message,
        passed: false
      });
    }
  }

  async testNetworkPartitions() {
    console.log('\n4. Testing Network Partitions...\n');
    
    try {
      // Simulate intermittent connectivity
      console.log('Simulating intermittent network...');
      
      const results = [];
      for (let i = 0; i < 20; i++) {
        // Alternate between working and broken connection
        if (i % 3 === 0) {
          // Break connection
          process.env.SUPABASE_URL = 'https://invalid.supabase.co';
        } else {
          // Restore connection
          process.env.SUPABASE_URL = 'https://wufhlhrbskacneneylqa.supabase.co';
        }
        
        const result = await this.sendSingleEvent(i, 'partition');
        results.push(result);
        
        await this.sleep(100); // Small delay between events
      }
      
      // Restore connection
      process.env.SUPABASE_URL = 'https://wufhlhrbskacneneylqa.supabase.co';
      
      const success = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      
      this.testResults.push({
        test: 'Network Partitions',
        success,
        failed,
        passed: success >= 10 // At least 50% success under partitions
      });
      
    } catch (error) {
      console.log('Network partitions test failed:', error.message);
      this.testResults.push({
        test: 'Network Partitions',
        error: error.message,
        passed: false
      });
    }
  }

  async sendEvents(count, phase, options = {}) {
    const results = { success: 0, failed: 0 };
    
    for (let i = 0; i < count; i++) {
      try {
        const result = await this.sendSingleEvent(i, phase, options);
        if (result.success) results.success++;
        else results.failed++;
      } catch (error) {
        results.failed++;
      }
    }
    
    return results;
  }

  async sendSingleEvent(index, phase, options = {}) {
    try {
      const payload = {
        message: `${phase} event ${index}`,
        phase,
        index,
        timestamp: Date.now(),
        ...options
      };
      
      const response = await fetch('http://localhost:3001/error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const result = await response.json();
      return { success: result.success, eventId: result.event_id };
      
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  printResults() {
    console.log('\n=== CHAOS ENGINEERING RESULTS ===\n');
    
    this.testResults.forEach(result => {
      console.log(`Test: ${result.test}`);
      
      if (result.error) {
        console.log(`  Status: FAILED - ${result.error}`);
      } else {
        console.log(`  Status: ${result.passed ? 'PASSED' : 'FAILED'}`);
        
        if (result.success !== undefined) {
          console.log(`  Success: ${result.success}, Failed: ${result.failed}`);
        }
        
        if (result.duration) {
          console.log(`  Duration: ${result.duration}ms, Throughput: ${result.throughput} events/sec`);
        }
      }
      
      console.log('');
    });
    
    const passed = this.testResults.filter(r => r.passed).length;
    const total = this.testResults.length;
    
    console.log(`Overall: ${passed}/${total} tests passed`);
    
    if (passed === total) {
      console.log('CHAOS ENGINEERING: System is resilient under stress');
    } else {
      console.log('CHAOS ENGINEERING: System has resilience gaps');
    }
  }
}

// Run the chaos engineering suite
const chaos = new ChaosEngineering();
chaos.runChaosSuite().catch(console.error);
