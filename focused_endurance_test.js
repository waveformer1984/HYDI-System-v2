// FOCUSED ENDURANCE TEST - 2 MINUTES WITH REAL STRESS
// Where we actually see the system break

const { v4: uuidv4 } = require('uuid');
const CausalExecutor = require('./causal_executor');
const DeterministicProcessor = require('./deterministic_processor');
const RetryConvergenceEnforcer = require('./retry_convergence_enforcer');

class FocusedEnduranceTest {
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
      processingErrors: 0,
      memoryLeaks: 0,
      orderingViolations: 0,
      driftDetected: 0,
      startTime: null,
      endTime: null
    };
    
    this.isRunning = false;
  }

  async runFocusedTest(durationMinutes = 2) {
    console.log(`🔥 FOCUSED ENDURANCE TEST - ${durationMinutes} MINUTES`);
    console.log('==============================================');
    console.log('Real stress conditions where time breaks systems\n');
    
    this.testMetrics.startTime = Date.now();
    this.isRunning = true;
    
    try {
      // Phase 1: Generate events with real stress
      await this.generateEventsWithStress(durationMinutes * 60 * 1000);
      
      // Phase 2: Apply memory pressure
      await this.applyMemoryPressure();
      
      // Phase 3: Monitor for issues
      await this.monitorForIssues();
      
      // Phase 4: Replay verification
      const replayResult = await this.performReplay();
      
      this.testMetrics.endTime = Date.now();
      
      this.reportResults(replayResult);
      
    } catch (error) {
      console.log('\n💥 FOCUSED TEST CRASHED');
      console.log('System broke under stress:', error.message);
      this.testMetrics.endTime = Date.now();
      this.reportResults({ crashed: true, error: error.message });
    } finally {
      this.isRunning = false;
    }
  }

  async generateEventsWithStress(durationMs) {
    console.log('⚡ Phase 1 — Generate Events With Real Stress');
    
    const endTime = Date.now() + durationMs;
    let eventCounter = 0;
    
    const eventGenerationLoop = async () => {
      while (this.isRunning && Date.now() < endTime) {
        try {
          // Generate event
          const event = {
            event_id: uuidv4(),
            event_type: Math.random() > 0.3 ? 'CAUSAL' : 'EXTERNAL',
            determinism_key: `stress-${Date.now()}-${Math.random()}`,
            logical_clock: this.eventSpine.length,
            decision_time: Date.now(),
            payload: {
              operation: 'stress_test',
              value: Math.random() * 1000,
              timestamp: Date.now(),
              batch_id: Math.floor(Date.now() / 10000) // Batch every 10 seconds
            }
          };
          
          this.eventSpine.push(event);
          this.testMetrics.totalEvents++;
          
          // Process event
          await this.processEvent(event);
          this.testMetrics.eventsProcessed++;
          
          eventCounter++;
          
          // Log progress
          if (eventCounter % 100 === 0) {
            console.log(`  Generated ${eventCounter} events...`);
          }
          
          // Random delay to simulate real conditions
          const delay = Math.random() * 50; // 0-50ms delay
          await this.sleep(delay);
          
        } catch (error) {
          this.testMetrics.processingErrors++;
          console.log(`  Processing error: ${error.message}`);
        }
      }
    };
    
    // Start event generation
    eventGenerationLoop();
    
    console.log(`  Started event generation for ${durationMs / 60000} minutes`);
  }

  async processEvent(event) {
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
    // Simulate external event processing with potential side effects
    if (Math.random() < 0.05) { // 5% chance of side effect
      const alertId = uuidv4();
      this.systemState.chaosAlerts.set(alertId, {
        id: alertId,
        source: 'external',
        message: `External alert from ${event.event_id}`,
        severity: 'low',
        created_at: Date.now()
      });
    }
    
    return {
      event_id: event.event_id,
      processed_at: Date.now(),
      normalized: true
    };
  }

  async applyMemoryPressure() {
    console.log('💾 Phase 2 — Apply Memory Pressure');
    
    const memoryLeakArray = [];
    
    const memoryPressureInterval = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(memoryPressureInterval);
        return;
      }
      
      // Simulate memory pressure
      for (let i = 0; i < 100; i++) {
        memoryLeakArray.push({
          data: new Array(100).fill(Math.random()),
          timestamp: Date.now(),
          id: uuidv4()
        });
      }
      
      // Check memory usage
      const memUsage = process.memoryUsage();
      if (this.testMetrics.lastMemoryUsage) {
        const growth = memUsage.heapUsed - this.testMetrics.lastMemoryUsage.heapUsed;
        if (growth > 50 * 1024 * 1024) { // 50MB growth
          console.log(`    💧 Memory pressure: ${(growth / 1024 / 1024).toFixed(2)}MB growth`);
          this.testMetrics.memoryLeaks++;
        }
      }
      this.testMetrics.lastMemoryUsage = memUsage;
      
    }, 1000);
    
    console.log('  Applied memory pressure');
  }

  async monitorForIssues() {
    console.log('🏥 Phase 3 — Monitor For Issues');
    
    const monitoringInterval = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(monitoringInterval);
        return;
      }
      
      this.checkForOrderingViolations();
      this.checkForDrift();
      
    }, 2000);
    
    console.log('  Started monitoring');
  }

  checkForOrderingViolations() {
    for (let i = 1; i < this.eventSpine.length; i++) {
      const current = this.eventSpine[i];
      const previous = this.eventSpine[i - 1];
      
      if (current.logical_clock <= previous.logical_clock) {
        console.log(`    🔀 Ordering violation at index ${i}`);
        this.testMetrics.orderingViolations++;
      }
    }
  }

  checkForDrift() {
    const currentState = this.captureSystemState();
    const previousState = this.testMetrics.lastSystemState;
    
    if (previousState) {
      if (currentState.chaosAlertsCount !== previousState.chaosAlertsCount) {
        console.log(`    ⚠️ Drift detected in alerts: ${previousState.chaosAlertsCount} → ${currentState.chaosAlertsCount}`);
        this.testMetrics.driftDetected++;
      }
    }
    
    this.testMetrics.lastSystemState = currentState;
  }

  async performReplay() {
    console.log('🔄 Phase 4 — Replay Verification');
    
    console.log(`  Replaying ${this.eventSpine.length} events...`);
    
    const replayStartTime = Date.now();
    const hashes = new Set();
    
    // Reset system state
    this.resetSystemState();
    
    // Replay all events
    for (let i = 0; i < this.eventSpine.length; i++) {
      const event = this.eventSpine[i];
      
      try {
        const result = await this.processEventForReplay(event);
        const hash = this.calculateEventHash(event, result);
        hashes.add(hash);
        
        if (i % 100 === 0) {
          console.log(`    Replayed ${i}/${this.eventSpine.length} events...`);
        }
        
      } catch (error) {
        console.log(`    ❌ Replay failed for event ${i}: ${error.message}`);
        this.testMetrics.processingErrors++;
      }
    }
    
    const replayEndTime = Date.now();
    const replayDuration = replayEndTime - replayStartTime;
    
    console.log(`  Replay completed in ${replayDuration}ms`);
    console.log(`  Unique hashes: ${hashes.size}`);
    
    return {
      duration: replayDuration,
      totalEvents: this.eventSpine.length,
      uniqueHashes: hashes.size,
      replayErrors: this.testMetrics.processingErrors,
      deterministic: hashes.size === 1 && this.testMetrics.processingErrors === 0
    };
  }

  async processEventForReplay(event) {
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

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  reportResults(replayResult) {
    const duration = (this.testMetrics.endTime - this.testMetrics.startTime) / 1000;
    
    console.log('\n🏁 FOCUSED ENDURANCE TEST RESULTS');
    console.log('==================================');
    console.log(`Duration: ${duration.toFixed(2)}s`);
    
    console.log('\n📊 TEST METRICS:');
    console.log(`  Total events: ${this.testMetrics.totalEvents}`);
    console.log(`  Events processed: ${this.testMetrics.eventsProcessed}`);
    console.log(`  Processing errors: ${this.testMetrics.processingErrors}`);
    console.log(`  Memory leaks: ${this.testMetrics.memoryLeaks}`);
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
      console.log(`  Replay errors: ${replayResult.replayErrors}`);
      console.log(`  Deterministic: ${replayResult.deterministic ? '✅' : '❌'}`);
    }
    
    console.log('\n🎯 ASSESSMENT:');
    
    const hasIssues = [
      this.testMetrics.memoryLeaks > 0,
      this.testMetrics.orderingViolations > 0,
      this.testMetrics.driftDetected > 0,
      replayResult.crashed || !replayResult.deterministic
    ].some(issue => issue);
    
    if (hasIssues) {
      console.log('❌ SYSTEM BROKE UNDER REAL STRESS');
      console.log('\n🔧 ISSUES FOUND:');
      if (this.testMetrics.memoryLeaks > 0) console.log(`  - Memory leaks: ${this.testMetrics.memoryLeaks}`);
      if (this.testMetrics.orderingViolations > 0) console.log(`  - Ordering violations: ${this.testMetrics.orderingViolations}`);
      if (this.testMetrics.driftDetected > 0) console.log(`  - Drift: ${this.testMetrics.driftDetected}`);
      if (replayResult.crashed) console.log(`  - Replay crashed: ${replayResult.error}`);
      if (!replayResult.deterministic) console.log(`  - Non-deterministic: ${replayResult.uniqueHashes} hashes`);
      
      console.log('\n💡 THE REALITY:');
      console.log('Your system broke under sustained stress.');
      console.log('This reveals issues your short tests missed.');
      
    } else {
      console.log('✅ SYSTEM SURVIVED REAL STRESS');
      console.log('\n💡 THE BREAKTHROUGH:');
      console.log('Your system maintained correctness under real stress.');
    }
  }
}

// Run the focused endurance test
if (require.main === module) {
  const test = new FocusedEnduranceTest();
  test.runFocusedTest(2).catch(console.error);
}

module.exports = FocusedEnduranceTest;
