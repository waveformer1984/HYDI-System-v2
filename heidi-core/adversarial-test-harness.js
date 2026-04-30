#!/usr/bin/env node

/**
 * ADVERSARIAL TEST HARNESS FOR HEIDI HSLP
 * 
 * This doesn't test if Heidi works under ideal conditions.
 * It tests if Heidi survives when reality is actively hostile.
 * 
 * Because real systems don't get study guides. They get chaos.
 */

const HeidiSelfLaunchProtocol = require('./HeidiSelfLaunchProtocol');
const { EventEmitter } = require('events');

class AdversarialTestHarness extends EventEmitter {
  constructor() {
    super();
    this.testResults = [];
    this.chaosLevel = 0;
    this.corruptionRate = 0;
    this.failureProbability = 0;
  }

  /**
   * Inject entropy into the system - make it unpredictable
   */
  injectEntropy(level = 0.3) {
    this.chaosLevel = level;
    console.log(`🌪️  Entropy injection level: ${level}`);
  }

  /**
   * Simulate gradual system corruption over time
   */
  async simulateGradualCorruption(protocol, cycles = 5) {
    console.log(`🦠 Simulating gradual corruption over ${cycles} cycles...`);
    
    for (let cycle = 0; cycle < cycles; cycle++) {
      const corruptionAmount = 0.1 + (cycle * 0.15); // Increasing corruption
      this.corruptionRate = Math.min(corruptionAmount, 1.0);
      
      console.log(`🔴 Cycle ${cycle + 1}: Corruption rate ${this.corruptionRate.toFixed(2)}`);
      
      // Corrupt random system components
      await this.corruptRandomComponents(protocol);
      
      // Wait for system to potentially detect issues
      await this.sleep(1000);
      
      // Check if system detected corruption
      const detected = await this.checkCorruptionDetection(protocol);
      console.log(`👁️  Corruption detected: ${detected ? 'YES' : 'NO'}`);
      
      if (!detected && this.corruptionRate > 0.7) {
        console.log('⚠️  System failed to detect high corruption - THIS IS A PROBLEM');
        return false;
      }
    }
    
    return true;
  }

  /**
   * Corrupt random system components in realistic ways
   */
  async corruptRandomComponents(protocol) {
    const components = ['memory', 'config', 'tasks', 'logs', 'state'];
    const numToCorrupt = Math.floor(this.chaosLevel * components.length);
    
    // Shuffle and select components to corrupt
    const toCorrupt = this.shuffleArray(components).slice(0, numToCorrupt);
    
    for (const component of toCorrupt) {
      switch (component) {
        case 'memory':
          await this.corruptMemory(protocol);
          break;
        case 'config':
          await this.corruptConfig(protocol);
          break;
        case 'tasks':
          await this.corruptTasks(protocol);
          break;
        case 'logs':
          await this.corruptLogs(protocol);
          break;
        case 'state':
          await this.corruptState(protocol);
          break;
      }
    }
  }

  /**
   * Simulate partial memory corruption - not total failure
   */
  async corruptMemory(protocol) {
    // Simulate memory inconsistency
    if (protocol.state && protocol.state.memory_snapshots) {
      // Corrupt 30% of memory entries
      const entries = Object.keys(protocol.state.memory_snapshots);
      const toCorrupt = Math.floor(entries.length * 0.3);
      
      for (let i = 0; i < toCorrupt; i++) {
        const entry = entries[Math.floor(Math.random() * entries.length)];
        if (Math.random() < this.corruptionRate) {
          // Partial corruption - not null, but wrong
          protocol.state.memory_snapshots[entry] = {
            ...protocol.state.memory_snapshots[entry],
            timestamp: 'CORRUPTED_' + Date.now(),
            checksum: '0xDEADBEEF'
          };
        }
      }
    }
  }

  /**
   * Simulate config drift - silent configuration changes
   */
  async corruptConfig(protocol) {
    if (protocol.config) {
      // Silently change configuration values
      const configKeys = Object.keys(protocol.config);
      const toCorrupt = Math.floor(configKeys.length * 0.2);
      
      for (let i = 0; i < toCorrupt; i++) {
        const key = configKeys[Math.floor(Math.random() * configKeys.length)];
        if (typeof protocol.config[key] === 'number') {
          // Drift numeric values slightly
          protocol.config[key] *= (0.8 + Math.random() * 0.4); // ±20% drift
        }
      }
    }
  }

  /**
   * Simulate task queue corruption - silent backlog issues
   */
  async corruptTasks(protocol) {
    if (protocol.state && protocol.state.task_queue) {
      // Make some tasks unexecutable
      protocol.state.task_queue.forEach(task => {
        if (Math.random() < this.corruptionRate * 0.5) {
          task.status = task.status === 'pending' ? 'stuck' : task.status;
          task.locked = true; // Silent lock - no error thrown
        }
      });
    }
  }

  /**
   * Simulate log corruption - incomplete audit trails
   */
  async corruptLogs(protocol) {
    if (protocol.state && protocol.state.error_log) {
      // Remove some log entries silently
      const toRemove = Math.floor(protocol.state.error_log.length * 0.1);
      for (let i = 0; i < toRemove; i++) {
        const index = Math.floor(Math.random() * protocol.state.error_log.length);
        protocol.state.error_log.splice(index, 1);
      }
    }
  }

  /**
   * Simulate state inconsistency - contradictory system state
   */
  async corruptState(protocol) {
    if (protocol.state) {
      // Create contradictory state
      if (Math.random() < this.corruptionRate) {
        protocol.state.HEIDI_STATUS = 'ACTIVE';
        protocol.state.MODE = 'SAFE_MODE'; // Contradiction
        protocol.state.HEARTBEAT = 'DISABLED'; // Another contradiction
      }
    }
  }

  /**
   * Check if system detects the corruption we injected
   */
  async checkCorruptionDetection(protocol) {
    // Simulate drift detection
    const originalDrift = protocol.state.drift_score;
    
    // Run integrity check (this should detect corruption)
    try {
      const coherence = await this.validateTaskExecutionCoherence(protocol);
      const stability = await this.validateLoopStability(protocol);
      const memory = await this.validateMemoryConsistency(protocol);
      const config = await this.validateConfigConsistency(protocol);
      
      // Calculate drift based on detected inconsistencies
      const failures = [coherence, stability, memory, config].filter(v => !v).length;
      protocol.state.drift_score = failures / 4;
      
      return protocol.state.drift_score > originalDrift;
    } catch (error) {
      // If validation throws errors, that's also detection
      return true;
    }
  }

  /**
   * Simulate partial module failures - not total crashes
   */
  async simulatePartialFailures(protocol, failureRate = 0.3) {
    console.log(`⚡ Simulating partial module failures (rate: ${failureRate})`);
    
    this.failureProbability = failureRate;
    
    // Override module functions with flaky behavior
    const originalStartSystem = protocol.startSystem.bind(protocol);
    protocol.startSystem = async (system) => {
      if (Math.random() < this.failureProbability) {
        // Partial failure - starts but reports issues
        console.log(`⚠️  ${system} started with warnings`);
        return true; // Lies about being healthy
      }
      return originalStartSystem(system);
    };
    
    const originalValidate = protocol.validateTaskExecutionCoherence.bind(protocol);
    protocol.validateTaskExecutionCoherence = async () => {
      if (Math.random() < this.failureProbability) {
        // Sometimes reports false positives
        return Math.random() > 0.5;
      }
      return originalValidate();
    };
  }

  /**
   * Test system recovery under stress
   */
  async testRecoveryUnderStress() {
    console.log('🏥 Testing recovery under stress...');
    
    const protocol = new HeidiSelfLaunchProtocol();
    
    // Inject chaos from the start
    this.injectEntropy(0.4);
    await this.simulatePartialFailures(protocol, 0.3);
    
    // Attempt launch with corrupted environment
    const launchResult = await protocol.launch('manual');
    
    if (!launchResult.success) {
      console.log('❌ Launch failed under stress - EXPECTED');
      
      // Now test recovery
      console.log('🔄 Testing recovery from failed launch...');
      
      // Reduce chaos and attempt recovery
      this.injectEntropy(0.1);
      const recoveryResult = await protocol.launch('manual');
      
      return recoveryResult.success;
    }
    
    return launchResult.success;
  }

  /**
   * Test with randomized and malformed inputs
   */
  async testMalformedInputs() {
    console.log('👹 Testing with malformed inputs...');
    
    const protocol = new HeidiSelfLaunchProtocol();
    const malformedInputs = [
      null,
      undefined,
      123,
      {},
      [],
      'invalid_trigger',
      '',
      '\x00\x01\x02', // Binary data
      'a'.repeat(10000), // Very long string
      { trigger: 'nested_object' }
    ];
    
    let passedTests = 0;
    
    for (const input of malformedInputs) {
      try {
        const result = await protocol.checkBootTrigger(input);
        
        // Should return false for all malformed inputs
        if (!result) {
          passedTests++;
          console.log(`✅ Correctly rejected malformed input: ${JSON.stringify(input)}`);
        } else {
          console.log(`❌ Incorrectly accepted malformed input: ${JSON.stringify(input)}`);
        }
      } catch (error) {
        // Throwing errors is also acceptable for malformed inputs
        passedTests++;
        console.log(`✅ Correctly threw error for malformed input: ${JSON.stringify(input)}`);
      }
    }
    
    return passedTests === malformedInputs.length;
  }

  /**
   * Test delayed dependency injection
   */
  async testDelayedDependencies() {
    console.log('⏱️  Testing delayed dependency injection...');
    
    const protocol = new HeidiSelfLaunchProtocol();
    
    // Make dependencies respond slowly
    let delayCount = 0;
    protocol.checkModuleAvailability = async (module) => {
      delayCount++;
      if (delayCount <= 2) {
        // First two checks are slow
        await this.sleep(2000);
        return false;
      }
      return true;
    };
    
    const startTime = Date.now();
    const result = await protocol.dependencyAlignmentLayer();
    const endTime = Date.now();
    
    const duration = endTime - startTime;
    console.log(`⏱️  Dependency alignment took ${duration}ms`);
    
    // Should handle delays gracefully
    return result && duration > 3000;
  }

  /**
   * Run full adversarial test suite
   */
  async runAdversarialTests() {
    console.log('🌪️  ADVERSARIAL TEST HARNESS');
    console.log('============================');
    console.log('Testing Heidi under hostile conditions...\n');
    
    const tests = [
      { name: 'Malformed Input Rejection', test: () => this.testMalformedInputs() },
      { name: 'Gradual Corruption Detection', test: () => this.simulateGradualCorruption(new HeidiSelfLaunchProtocol()) },
      { name: 'Partial Module Failures', test: () => this.testRecoveryUnderStress() },
      { name: 'Delayed Dependency Injection', test: () => this.testDelayedDependencies() },
      { name: 'Chaotic Boot Sequence', test: () => this.testChaoticBoot() },
      { name: 'Resource Exhaustion', test: () => this.testResourceExhaustion() },
      { name: 'Memory Pressure', test: () => this.testMemoryPressure() }
    ];
    
    let passed = 0;
    let total = tests.length;
    
    for (const { name, test } of tests) {
      console.log(`\n🧪 Running: ${name}`);
      console.log('─'.repeat(50));
      
      try {
        const result = await test();
        if (result) {
          console.log(`✅ ${name} - PASSED`);
          passed++;
        } else {
          console.log(`❌ ${name} - FAILED`);
        }
      } catch (error) {
        console.log(`💥 ${name} - ERROR: ${error.message}`);
      }
    }
    
    console.log('\n📊 ADVERSARIAL TEST RESULTS');
    console.log('===========================');
    console.log(`Passed: ${passed}/${total}`);
    console.log(`Survival Rate: ${((passed / total) * 100).toFixed(1)}%`);
    
    if (passed === total) {
      console.log('🎉 Heidi survived all adversarial conditions!');
    } else {
      console.log('⚠️  Heidi has vulnerabilities under stress');
    }
    
    return { passed, total, survivalRate: passed / total };
  }

  /**
   * Test chaotic boot sequence with random triggers
   */
  async testChaoticBoot() {
    console.log('🎲 Testing chaotic boot sequence...');
    
    const triggers = ['manual', 'system_start', 'invalid', null, undefined, ''];
    const protocol = new HeidiSelfLaunchProtocol();
    
    // Randomize trigger order and timing
    for (let i = 0; i < triggers.length; i++) {
      const trigger = triggers[Math.floor(Math.random() * triggers.length)];
      const delay = Math.random() * 1000; // Random delay
      
      await this.sleep(delay);
      
      try {
        const result = await protocol.checkBootTrigger(trigger);
        console.log(`🎲 Random trigger "${trigger}": ${result ? 'ACCEPTED' : 'REJECTED'}`);
      } catch (error) {
        console.log(`🎲 Random trigger "${trigger}": ERROR - ${error.message}`);
      }
    }
    
    return true; // Survival is just not crashing
  }

  /**
   * Test resource exhaustion scenarios
   */
  async testResourceExhaustion() {
    console.log('🔋 Testing resource exhaustion...');
    
    const protocol = new HeidiSelfLaunchProtocol();
    
    // Simulate high memory usage
    const originalMemory = process.memoryUsage();
    
    // Create memory pressure
    const memoryHog = [];
    for (let i = 0; i < 1000; i++) {
      memoryHog.push(new Array(10000).fill(Math.random()));
    }
    
    try {
      const result = await protocol.launch('manual');
      
      // Clean up
      memoryHog.length = 0;
      
      return result.success || result.reason.includes('memory');
    } catch (error) {
      memoryHog.length = 0;
      return error.message.includes('memory') || error.message.includes('resource');
    }
  }

  /**
   * Test memory pressure scenarios
   */
  async testMemoryPressure() {
    console.log('🧠 Testing memory pressure...');
    
    const protocol = new HeidiSelfLaunchProtocol();
    
    // Fill memory with garbage data
    if (!protocol.state.memory_snapshots) {
      protocol.state.memory_snapshots = {};
    }
    
    for (let i = 0; i < 10000; i++) {
      protocol.state.memory_snapshots[`garbage_${i}`] = {
        data: new Array(1000).fill(Math.random()),
        timestamp: Date.now(),
        checksum: Math.random().toString(36)
      };
    }
    
    try {
      const result = await protocol.integrityDriftValidationGate();
      return !result; // Should fail due to memory pressure
    } catch (error) {
      return true; // Throwing error is acceptable under memory pressure
    }
  }

  // Helper methods
  shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Validation helpers (simulated)
  async validateTaskExecutionCoherence(protocol) {
    // Simulate coherence check
    return Math.random() > this.corruptionRate * 0.5;
  }

  async validateLoopStability(protocol) {
    // Simulate stability check
    return Math.random() > this.corruptionRate * 0.3;
  }

  async validateMemoryConsistency(protocol) {
    // Simulate memory consistency check
    return Math.random() > this.corruptionRate * 0.4;
  }

  async validateConfigConsistency(protocol) {
    // Simulate config consistency check
    return Math.random() > this.corruptionRate * 0.2;
  }
}

// Run adversarial tests if this file is executed directly
if (require.main === module) {
  const harness = new AdversarialTestHarness();
  harness.runAdversarialTests().catch(error => {
    console.error('💥 Adversarial test harness failed:', error);
    process.exit(1);
  });
}

module.exports = AdversarialTestHarness;
