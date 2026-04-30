// ENDURANCE CHAOS TEST - WHERE SYSTEMS BETRAY YOU
// Run for 15+ minutes with real stress conditions
// This is where time breaks your "provably correct" system

const { v4: uuidv4 } = require('uuid');
const CausalExecutor = require('./causal_executor');
const DeterministicProcessor = require('./deterministic_processor');
const RetryConvergenceEnforcer = require('./retry_convergence_enforcer');
const { Worker } = require('worker_threads');

class EnduranceChaosTest {
  constructor() {
    this.causalExecutor = new CausalExecutor();
    this.deterministicProcessor = new DeterministicProcessor();
    this.retryEnforcer = new RetryConvergenceEnforcer();
    
    this.eventSpine = [];
    this.systemState = {
      chaosRuns: new Map(),
      chaosRunInstances: new Map(),
      chaosAlerts: new Map(),
      externalState: new Map()
    };
    
    this.testMetrics = {
      totalEvents: 0,
      eventsProcessed: 0,
      eventsDropped: 0,
      eventsDuplicated: 0,
      processingErrors: 0,
      memoryLeaks: 0,
      orderingViolations: 0,
      driftDetected: 0,
      startTime: null,
      endTime: null
    };
    
    this.chaosConditions = {
      cpuThrottling: false,
      memoryPressure: false,
      networkJitter: false,
      concurrentWriters: 0,
      eventDelayRange: { min: 0, max: 500 },
      corruptionRate: 0.01 // 1% corruption
    };
    
    this.isRunning = false;
    this.workers = [];
  }

  async runEnduranceTest(durationMinutes = 15) {
    console.log(`🔥 ENDURANCE CHAOS TEST - ${durationMinutes} MINUTES`);
    console.log('===============================================');
    console.log('This is where time breaks your "provably correct" system\n');
    
    this.testMetrics.startTime = Date.now();
    this.isRunning = true;
    
    try {
      // Phase 1: Setup concurrent writers
      await this.setupConcurrentWriters();
      
      // Phase 2: Start continuous event ingestion
      await this.startContinuousIngestion(durationMinutes * 60 * 1000);
      
      // Phase 3: Apply chaos conditions
      await this.applyChaosConditions();
      
      // Phase 4: Monitor for drift and mutations
      await this.monitorSystemHealth();
      
      // Phase 5: Final replay verification
      const replayResult = await this.performEnduranceReplay();
      
      this.testMetrics.endTime = Date.now();
      
      this.reportEnduranceResults(replayResult);
      
    } catch (error) {
      console.log('\n💥 ENDURANCE TEST CRASHED');
      console.log('System broke under sustained chaos:', error.message);
      this.testMetrics.endTime = Date.now();
      this.reportEnduranceResults({ crashed: true, error: error.message });
    } finally {
      this.cleanup();
    }
  }

  // =============================================================================
  // PHASE 1: SETUP CONCURRENT WRITERS
  // =============================================================================
  
  async setupConcurrentWriters() {
    console.log('🚀 Phase 1 — Setup Concurrent Writers');
    
    // Create multiple worker threads for concurrent writing
    const writerCount = 3;
    
    for (let i = 0; i < writerCount; i++) {
      const worker = new Worker('./chaos_writer.js', {
        workerData: { writerId: i, chaosConditions: this.chaosConditions }
      });
      
      worker.on('message', (message) => {
        this.handleWorkerMessage(message);
      });
      
      worker.on('error', (error) => {
        console.log(`Worker ${i} error:`, error.message);
        this.testMetrics.processingErrors++;
      });
      
      this.workers.push(worker);
    }
    
    this.chaosConditions.concurrentWriters = writerCount;
    console.log(`  Created ${writerCount} concurrent writers`);
  }

  // =============================================================================
  // PHASE 2: CONTINUOUS EVENT INGESTION
  // =============================================================================
  
  async startContinuousIngestion(durationMs) {
    console.log('⚡ Phase 2 — Continuous Event Ingestion');
    
    const endTime = Date.now() + durationMs;
    let eventCounter = 0;
    
    // Start workers
    this.workers.forEach(worker => {
      worker.postMessage({ type: 'start', endTime });
    });
    
    // Main event generation loop
    const eventGenerationInterval = setInterval(() => {
      if (!this.isRunning || Date.now() >= endTime) {
        clearInterval(eventGenerationInterval);
        return;
      }
      
      // Generate events with random delays
      this.generateEventWithDelay();
      eventCounter++;
      
      // Log progress every 1000 events
      if (eventCounter % 1000 === 0) {
        console.log(`  Generated ${eventCounter} events...`);
      }
      
    }, 10); // Generate events every 10ms
    
    console.log(`  Started continuous ingestion for ${durationMs / 60000} minutes`);
  }

  generateEventWithDelay() {
    const delay = Math.random() * this.chaosConditions.eventDelayRange.max;
    
    setTimeout(() => {
      if (!this.isRunning) return;
      
      const event = {
        event_id: uuidv4(),
        event_type: Math.random() > 0.7 ? 'CAUSAL' : 'EXTERNAL',
        determinism_key: `endurance-${Date.now()}-${Math.random()}`,
        logical_clock: this.eventSpine.length,
        decision_time: Date.now(),
        payload: {
          operation: 'endurance_test',
          value: Math.random() * 1000,
          timestamp: Date.now()
        }
      };
      
      this.eventSpine.push(event);
      this.testMetrics.totalEvents++;
      
      // Randomly duplicate events (1% chance)
      if (Math.random() < 0.01) {
        const duplicateEvent = { ...event, event_id: uuidv4() };
        this.eventSpine.push(duplicateEvent);
        this.testMetrics.eventsDuplicated++;
      }
      
      // Randomly drop events (1% chance)
      if (Math.random() < 0.01) {
        this.eventSpine.pop();
        this.testMetrics.eventsDropped++;
      }
      
    }, delay);
  }

  // =============================================================================
  // PHASE 3: APPLY CHAOS CONDITIONS
  // =============================================================================
  
  async applyChaosConditions() {
    console.log('🌪️ Phase 3 — Apply Chaos Conditions');
    
    // Start CPU throttling
    this.startCPUThrottling();
    
    // Start memory pressure
    this.startMemoryPressure();
    
    // Start network jitter simulation
    this.startNetworkJitter();
    
    console.log('  Applied all chaos conditions');
  }

  startCPUThrottling() {
    console.log('    🔄 Starting CPU throttling...');
    
    const throttlingInterval = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(throttlingInterval);
        return;
      }
      
      // Simulate CPU load
      const start = Date.now();
      while (Date.now() - start < 50) {
        // Busy wait to simulate CPU throttling
        Math.random();
      }
      
    }, 1000);
    
    this.chaosConditions.cpuThrottling = true;
  }

  startMemoryPressure() {
    console.log('    💾 Starting memory pressure...');
    
    const memoryLeakArray = [];
    
    const memoryLeakInterval = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(memoryLeakInterval);
        return;
      }
      
      // Simulate memory pressure
      for (let i = 0; i < 1000; i++) {
        memoryLeakArray.push({
          data: new Array(1000).fill(Math.random()),
          timestamp: Date.now(),
          id: uuidv4()
        });
      }
      
      // Occasionally clean some memory to simulate GC
      if (memoryLeakArray.length > 10000) {
        memoryLeakArray.splice(0, 5000);
      }
      
    }, 500);
    
    this.chaosConditions.memoryPressure = true;
  }

  startNetworkJitter() {
    console.log('    🌐 Starting network jitter simulation...');
    
    const jitterInterval = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(jitterInterval);
        return;
      }
      
      // Simulate network jitter by adding random delays to processing
      const jitterDelay = Math.random() * 100;
      setTimeout(() => {
        // This simulates network delay
      }, jitterDelay);
      
    }, 200);
    
    this.chaosConditions.networkJitter = true;
  }

  // =============================================================================
  // PHASE 4: MONITOR SYSTEM HEALTH
  // =============================================================================
  
  async monitorSystemHealth() {
    console.log('🏥 Phase 4 — Monitor System Health');
    
    const monitoringInterval = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(monitoringInterval);
        return;
      }
      
      this.checkForDrift();
      this.checkForMemoryLeaks();
      this.checkForOrderingViolations();
      
    }, 5000); // Check every 5 seconds
  }

  checkForDrift() {
    // Check for drift in system state
    const currentState = this.captureSystemState();
    const previousState = this.testMetrics.lastSystemState;
    
    if (previousState) {
      // Check for unexpected changes
      if (currentState.chaosRunsCount !== previousState.chaosRunsCount) {
        console.log(`    ⚠️ Drift detected in chaos runs: ${previousState.chaosRunsCount} → ${currentState.chaosRunsCount}`);
        this.testMetrics.driftDetected++;
      }
    }
    
    this.testMetrics.lastSystemState = currentState;
  }

  checkForMemoryLeaks() {
    // Check for memory leaks
    const memUsage = process.memoryUsage();
    
    if (this.testMetrics.lastMemoryUsage) {
      const growth = memUsage.heapUsed - this.testMetrics.lastMemoryUsage.heapUsed;
      
      // If memory grows by more than 100MB, consider it a leak
      if (growth > 100 * 1024 * 1024) {
        console.log(`    💧 Memory leak detected: ${(growth / 1024 / 1024).toFixed(2)}MB growth`);
        this.testMetrics.memoryLeaks++;
      }
    }
    
    this.testMetrics.lastMemoryUsage = memUsage;
  }

  checkForOrderingViolations() {
    // Check for ordering violations in event spine
    for (let i = 1; i < this.eventSpine.length; i++) {
      const current = this.eventSpine[i];
      const previous = this.eventSpine[i - 1];
      
      if (current.logical_clock <= previous.logical_clock) {
        console.log(`    🔀 Ordering violation detected at index ${i}`);
        this.testMetrics.orderingViolations++;
      }
    }
  }

  // =============================================================================
  // PHASE 5: ENDURANCE REPLAY VERIFICATION
  // =============================================================================
  
  async performEnduranceReplay() {
    console.log('🔄 Phase 5 — Endurance Replay Verification');
    
    console.log(`  Replaying ${this.eventSpine.length} events...`);
    
    const replayStartTime = Date.now();
    const replayResults = [];
    const hashes = new Set();
    
    // Clear system state for replay
    const originalState = this.captureSystemState();
    this.resetSystemState();
    
    // Replay all events
    for (let i = 0; i < this.eventSpine.length; i++) {
      const event = this.eventSpine[i];
      
      try {
        const result = await this.processEventForReplay(event);
        const hash = this.calculateEventHash(event, result);
        
        replayResults.push({ eventIndex: i, hash, success: true });
        hashes.add(hash);
        
        // Log progress every 1000 events
        if (i % 1000 === 0) {
          console.log(`    Replayed ${i}/${this.eventSpine.length} events...`);
        }
        
      } catch (error) {
        console.log(`    ❌ Replay failed for event ${i}: ${error.message}`);
        replayResults.push({ eventIndex: i, success: false, error: error.message });
        this.testMetrics.processingErrors++;
      }
    }
    
    const replayEndTime = Date.now();
    const replayDuration = replayEndTime - replayStartTime;
    
    // Check replay consistency
    const uniqueHashes = hashes.size;
    const expectedHashes = 1; // Should be 1 if perfectly deterministic
    
    console.log(`  Replay completed in ${replayDuration}ms`);
    console.log(`  Unique hashes: ${uniqueHashes} (expected: ${expectedHashes})`);
    console.log(`  Replay errors: ${this.testMetrics.processingErrors}`);
    
    return {
      duration: replayDuration,
      totalEvents: this.eventSpine.length,
      uniqueHashes: uniqueHashes,
      expectedHashes: expectedHashes,
      replayErrors: this.testMetrics.processingErrors,
      deterministic: uniqueHashes === expectedHashes && this.testMetrics.processingErrors === 0,
      results: replayResults
    };
  }

  async processEventForReplay(event) {
    // Process event deterministically for replay
    const systemSnapshot = this.captureSystemState();
    
    switch (event.event_type) {
      case 'CAUSAL':
        return await this.deterministicProcessor.processEventDeterministic(event, systemSnapshot);
      case 'EXTERNAL':
        return await this.processExternalEvent(event, systemSnapshot);
      default:
        throw new Error(`Unknown event type: ${event.event_type}`);
    }
  }

  async processExternalEvent(event, systemSnapshot) {
    // Process external event (simplified for endurance test)
    return {
      event_id: event.event_id,
      processed_at: Date.now(),
      normalized: true
    };
  }

  calculateEventHash(event, result) {
    const hashInput = {
      event_id: event.event_id,
      event_type: event.event_type,
      logical_clock: event.logical_clock,
      payload: this.canonicalize(event.payload),
      result: this.canonicalize(result)
    };
    
    return this.stableHash(hashInput);
  }

  // =============================================================================
  // HELPER FUNCTIONS
  // =============================================================================
  
  handleWorkerMessage(message) {
    if (message.type === 'metrics') {
      this.testMetrics.eventsProcessed += message.eventsProcessed;
      this.testMetrics.processingErrors += message.errors;
    }
  }

  captureSystemState() {
    return {
      chaosRunsCount: this.systemState.chaosRuns.size,
      chaosInstancesCount: this.systemState.chaosRunInstances.size,
      chaosAlertsCount: this.systemState.chaosAlerts.size,
      externalStateCount: this.systemState.externalState.size,
      timestamp: Date.now()
    };
  }

  resetSystemState() {
    this.systemState = {
      chaosRuns: new Map(),
      chaosRunInstances: new Map(),
      chaosAlerts: new Map(),
      externalState: new Map()
    };
  }

  canonicalize(obj) {
    if (obj === null || obj === undefined) return 'null';
    if (typeof obj !== 'object') return String(obj);
    if (Array.isArray(obj)) return '[' + obj.map(item => this.canonicalize(item)).join(',') + ']';
    
    const sortedKeys = Object.keys(obj).sort();
    const canonicalObj = {};
    sortedKeys.forEach(key => {
      canonicalObj[key] = this.canonicalize(obj[key]);
    });
    
    return JSON.stringify(canonicalObj);
  }

  stableHash(input) {
    const canonical = this.canonicalize(input);
    let hash = 0;
    for (let i = 0; i < canonical.length; i++) {
      const char = canonical.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  cleanup() {
    this.isRunning = false;
    
    // Stop all workers
    this.workers.forEach(worker => {
      worker.postMessage({ type: 'stop' });
      worker.terminate();
    });
    
    this.workers = [];
  }

  // =============================================================================
  // REPORTING
  // =============================================================================
  
  reportEnduranceResults(replayResult) {
    const duration = (this.testMetrics.endTime - this.testMetrics.startTime) / 1000 / 60;
    
    console.log('\n🏁 ENDURANCE CHAOS TEST RESULTS');
    console.log('===============================');
    console.log(`Duration: ${duration.toFixed(2)} minutes`);
    
    console.log('\n📊 TEST METRICS:');
    console.log(`  Total events generated: ${this.testMetrics.totalEvents}`);
    console.log(`  Events processed: ${this.testMetrics.eventsProcessed}`);
    console.log(`  Events dropped: ${this.testMetrics.eventsDropped}`);
    console.log(`  Events duplicated: ${this.testMetrics.eventsDuplicated}`);
    console.log(`  Processing errors: ${this.testMetrics.processingErrors}`);
    console.log(`  Memory leaks detected: ${this.testMetrics.memoryLeaks}`);
    console.log(`  Ordering violations: ${this.testMetrics.orderingViolations}`);
    console.log(`  Drift detected: ${this.testMetrics.driftDetected}`);
    
    console.log('\n🔄 REPLAY RESULTS:');
    if (replayResult.crashed) {
      console.log(`  Status: ❌ CRASHED`);
      console.log(`  Error: ${replayResult.error}`);
    } else {
      console.log(`  Replay duration: ${replayResult.duration}ms`);
      console.log(`  Events replayed: ${replayResult.totalEvents}`);
      console.log(`  Unique hashes: ${replayResult.uniqueHashes}`);
      console.log(`  Expected hashes: ${replayResult.expectedHashes}`);
      console.log(`  Replay errors: ${replayResult.replayErrors}`);
      console.log(`  Deterministic: ${replayResult.deterministic ? '✅' : '❌'}`);
    }
    
    console.log('\n🎯 ENDURANCE ASSESSMENT:');
    
    const criticalIssues = [
      this.testMetrics.memoryLeaks > 0,
      this.testMetrics.orderingViolations > 0,
      this.testMetrics.driftDetected > 0,
      replayResult.crashed || !replayResult.deterministic
    ];
    
    const hasCriticalIssues = criticalIssues.some(issue => issue);
    
    if (hasCriticalIssues) {
      console.log('❌ SYSTEM FAILED UNDER SUSTAINED CHAOS');
      console.log('\n🔧 CRITICAL ISSUES:');
      if (this.testMetrics.memoryLeaks > 0) console.log(`  - Memory leaks: ${this.testMetrics.memoryLeaks}`);
      if (this.testMetrics.orderingViolations > 0) console.log(`  - Ordering violations: ${this.testMetrics.orderingViolations}`);
      if (this.testMetrics.driftDetected > 0) console.log(`  - Drift detected: ${this.testMetrics.driftDetected}`);
      if (replayResult.crashed) console.log(`  - Replay crashed: ${replayResult.error}`);
      if (!replayResult.deterministic) console.log(`  - Non-deterministic replay: ${replayResult.uniqueHashes} hashes`);
      
      console.log('\n💡 THE REALITY:');
      console.log('Your "provably correct" system broke under sustained stress.');
      console.log('Time and scale revealed issues your short tests missed.');
      
    } else {
      console.log('✅ SYSTEM SURVIVED SUSTAINED CHAOS');
      console.log('\n💡 THE BREAKTHROUGH:');
      console.log('Your system maintained correctness under real stress conditions.');
      console.log('This is much closer to "provably correct under any conditions".');
    }
    
    console.log('\n🚀 NEXT STEPS:');
    if (hasCriticalIssues) {
      console.log('- Fix the critical issues revealed by endurance testing');
      console.log('- Re-run endurance test until all issues are eliminated');
      console.log('- Then you can start using words like "provably correct"');
    } else {
      console.log('- Test for longer durations (1 hour, 24 hours)');
      console.log('- Add more concurrent writers');
      console.log('- Test multi-node scenarios');
      console.log('- Test out-of-band mutation attempts');
    }
  }
}

// Chaos writer worker
if (require.main === module) {
  const test = new EnduranceChaosTest();
  
  // Run endurance test for 15 minutes
  test.runEnduranceTest(15).catch(console.error);
}

module.exports = EnduranceChaosTest;
