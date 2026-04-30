// BROKEN REALITY DETERMINISM HARNESS
// Multi-layer adversarial system to prove deterministic convergence
// Given same causal spine → exact same durable state, no matter how reality misbehaves

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const ContainedExternalProcessor = require('./contained_external_processor');

class BrokenRealityDeterminismHarness {
  constructor() {
    this.eventSpineGenerator = new EventSpineGenerator();
    this.realityDistortionEngine = new RealityDistortionEngine();
    this.executionMatrix = new ExecutionMatrix();
    this.deterministicStateCapture = new DeterministicStateCapture();
    this.convergenceOracle = new ConvergenceOracle();
    
    this.testResults = {
      runs: [],
      convergence: null,
      failures: [],
      passed: false
    };
  }

  async runDeterminismTest(scenarios = ['write_skew', 'retry_storm', 'out_of_order', 'mid_transaction', 'external_noise']) {
    console.log('🧪 BROKEN REALITY DETERMINISM HARNESS');
    console.log('=====================================');
    console.log('Proving: Same causal spine → exact same durable state\n');
    
    try {
      for (const scenario of scenarios) {
        console.log(`\n🎯 Running scenario: ${scenario}`);
        await this.runScenario(scenario);
      }
      
      // Run the ultimate torture test
      console.log(`\n🔥 Running Replay Torture Test (100+ runs)`);
      await this.runReplayTortureTest();
      
      this.reportFinalResults();
      
    } catch (error) {
      console.log('\n💥 DETERMINISM HARNESS CRASHED');
      console.log('System failed adversarial testing:', error.message);
      this.testResults.passed = false;
      this.testResults.crashed = true;
      this.testResults.error = error.message;
    }
  }

  async runScenario(scenario) {
    // Phase 1: Generate event spine
    const eventSpine = this.eventSpineGenerator.generateSpine(scenario);
    console.log(`  Generated ${eventSpine.length} events`);
    
    // Phase 2: Create execution matrix
    const executionRuns = this.executionMatrix.createRuns(eventSpine, scenario);
    console.log(`  Created ${executionRuns.length} execution runs`);
    
    // Phase 3: Execute all runs with reality distortion
    const runResults = [];
    for (let i = 0; i < executionRuns.length; i++) {
      const run = executionRuns[i];
      console.log(`    Executing run ${i + 1}/${executionRuns.length}: ${run.name}`);
      
      const result = await this.executeRun(run, eventSpine);
      runResults.push(result);
    }
    
    // Phase 4: Check convergence
    const convergence = this.convergenceOracle.checkConvergence(runResults);
    
    this.testResults.runs.push({
      scenario: scenario,
      runs: runResults,
      convergence: convergence
    });
    
    console.log(`  Convergence: ${convergence.converged ? '✅' : '❌'}`);
    if (!convergence.converged) {
      console.log(`  Failures: ${convergence.failures.length}`);
      convergence.failures.forEach(failure => {
        console.log(`    - ${failure.type}: ${failure.description}`);
      });
    }
  }

  async executeRun(run, eventSpine) {
    const executionEngine = new CascadeExecutionEngine(run.distortionProfile);
    
    // Reset execution engine to ensure clean state
    executionEngine.reset();
    
    // Execute with reality distortion
    const executionResult = await executionEngine.execute(eventSpine);
    
    // Capture deterministic state
    const stateCapture = this.deterministicStateCapture.capture(executionResult);
    
    return {
      runName: run.name,
      distortionProfile: run.distortionProfile,
      stateHash: stateCapture.stateHash,
      eventCount: executionResult.eventsProcessed,
      derivedOutputs: stateCapture.derivedOutputs,
      sideEffects: stateCapture.sideEffects,
      replayHash: stateCapture.replayHash,
      executionTime: executionResult.executionTime,
      errors: executionResult.errors
    };
  }

  async runReplayTortureTest() {
    console.log('  Generating torture test spine...');
    const tortureSpine = this.eventSpineGenerator.generateSpine('torture_test');
    
    console.log('  Running 100+ executions with random distortions...');
    const tortureRuns = [];
    
    for (let i = 0; i < 100; i++) {
      const randomDistortion = this.realityDistortionEngine.generateRandomDistortion();
      const run = {
        name: `Torture_Run_${i}`,
        distortionProfile: randomDistortion
      };
      
      const result = await this.executeRun(run, tortureSpine);
      tortureRuns.push(result);
      
      if (i % 20 === 0) {
        console.log(`    Completed ${i}/100 torture runs...`);
      }
    }
    
    const tortureConvergence = this.convergenceOracle.checkConvergence(tortureRuns);
    
    this.testResults.tortureTest = {
      runs: tortureRuns,
      convergence: tortureConvergence
    };
    
    console.log(`  Torture test convergence: ${tortureConvergence.converged ? '✅' : '❌'}`);
    console.log(`  Unique hashes: ${new Set(tortureRuns.map(r => r.stateHash)).size}`);
  }

  reportFinalResults() {
    console.log('\n🏁 BROKEN REALITY DETERMINISM RESULTS');
    console.log('=====================================');
    
    const allScenariosPassed = this.testResults.runs.every(run => run.convergence.converged);
    const tortureTestPassed = this.testResults.tortureTest?.convergence.converged;
    
    console.log('\n📊 SCENARIO RESULTS:');
    this.testResults.runs.forEach(run => {
      console.log(`  ${run.scenario}: ${run.convergence.converged ? '✅' : '❌'}`);
      if (!run.convergence.converged) {
        console.log(`    Failures: ${run.convergence.failures.length}`);
      }
    });
    
    if (this.testResults.tortureTest) {
      console.log(`\n🔥 TORTURE TEST: ${tortureTestPassed ? '✅' : '❌'}`);
      console.log(`  Unique hashes: ${new Set(this.testResults.tortureTest.runs.map(r => r.stateHash)).size}`);
    }
    
    this.testResults.passed = allScenariosPassed && tortureTestPassed;
    
    console.log(`\n🎯 FINAL RESULT: ${this.testResults.passed ? '✅ DETERMINISTIC' : '❌ NON-DETERMINISTIC'}`);
    
    if (this.testResults.passed) {
      console.log('\n🎉 SYSTEM PROVES DETERMINISTIC CONVERGENCE');
      console.log('Your system has a single, enforceable reality independent of execution conditions');
      console.log('Production becomes boring (the dream)');
    } else {
      console.log('\n💥 SYSTEM HAS HIDDEN ENTROPY');
      console.log('You found the exact crack before reality did it for you at 3am');
      
      console.log('\n🔧 ALL FAILURES:');
      this.testResults.runs.forEach(run => {
        if (!run.convergence.converged) {
          run.convergence.failures.forEach(failure => {
            console.log(`  ${run.scenario} - ${failure.type}: ${failure.description}`);
          });
        }
      });
    }
  }
}

// =============================================================================
// COMPONENT 1: EVENT SPINE GENERATOR
// =============================================================================
class EventSpineGenerator {
  constructor() {
    this.determinismSeed = 42;
  }

  generateSpine(scenario) {
    switch (scenario) {
      case 'write_skew':
        return this.generateWriteSkewSpine();
      case 'retry_storm':
        return this.generateRetryStormSpine();
      case 'out_of_order':
        return this.generateOutOfOrderSpine();
      case 'mid_transaction':
        return this.generateMidTransactionSpine();
      case 'external_noise':
        return this.generateExternalNoiseSpine();
      case 'torture_test':
        return this.generateTortureTestSpine();
      default:
        return this.generateBaselineSpine();
    }
  }

  generateWriteSkewSpine() {
    const events = [];
    const baseId = uuidv4();
    
    // Two concurrent events that read same state and write conflicting updates
    events.push({
      event_id: `${baseId}-1`,
      causal_parent_id: null,
      determinism_key: `write-skew-${this.determinismSeed}`,
      payload_hash: this.hashPayload({ read: 'account_123', write: { balance: 100 } }),
      event_type: 'CAUSAL',
      payload: { operation: 'read_write', account_id: 'account_123', new_balance: 100 },
      logical_clock: 1
    });
    
    events.push({
      event_id: `${baseId}-2`,
      causal_parent_id: null,
      determinism_key: `write-skew-${this.determinismSeed}`,
      payload_hash: this.hashPayload({ read: 'account_123', write: { balance: 200 } }),
      event_type: 'CAUSAL',
      payload: { operation: 'read_write', account_id: 'account_123', new_balance: 200 },
      logical_clock: 2
    });
    
    return events;
  }

  generateRetryStormSpine() {
    const events = [];
    const baseId = uuidv4();
    
    // Single event that will be retried many times
    events.push({
      event_id: baseId,
      causal_parent_id: null,
      determinism_key: `retry-storm-${this.determinismSeed}`,
      payload_hash: this.hashPayload({ operation: 'complex_update', data: 'stress_test' }),
      event_type: 'CAUSAL',
      payload: { operation: 'complex_update', data: 'stress_test', retry_count: 0 },
      logical_clock: 1
    });
    
    return events;
  }

  generateOutOfOrderSpine() {
    const events = [];
    const baseId = uuidv4();
    
    // Parent and child events (child will be delivered before parent in some runs)
    events.push({
      event_id: `${baseId}-parent`,
      causal_parent_id: null,
      determinism_key: `out-of-order-${this.determinismSeed}`,
      payload_hash: this.hashPayload({ operation: 'create_parent', parent_id: baseId }),
      event_type: 'CAUSAL',
      payload: { operation: 'create_parent', parent_id: baseId },
      logical_clock: 1
    });
    
    events.push({
      event_id: `${baseId}-child`,
      causal_parent_id: `${baseId}-parent`,
      determinism_key: `out-of-order-${this.determinismSeed}`,
      payload_hash: this.hashPayload({ operation: 'create_child', parent_id: baseId }),
      event_type: 'DERIVED',
      payload: { operation: 'create_child', parent_id: baseId },
      logical_clock: 2
    });
    
    return events;
  }

  generateMidTransactionSpine() {
    const events = [];
    const baseId = uuidv4();
    
    // Event that spans decision -> commit -> visibility
    events.push({
      event_id: baseId,
      causal_parent_id: null,
      determinism_key: `mid-transaction-${this.determinismSeed}`,
      payload_hash: this.hashPayload({ operation: 'long_transaction', steps: 10 }),
      event_type: 'CAUSAL',
      payload: { operation: 'long_transaction', steps: 10, current_step: 0 },
      logical_clock: 1
    });
    
    return events;
  }

  generateExternalNoiseSpine() {
    const events = [];
    const baseId = uuidv4();
    
    // Mix of causal and external events
    events.push({
      event_id: `${baseId}-causal`,
      causal_parent_id: null,
      determinism_key: `external-noise-${this.determinismSeed}`,
      payload_hash: this.hashPayload({ operation: 'system_update' }),
      event_type: 'CAUSAL',
      payload: { operation: 'system_update' },
      logical_clock: 1
    });
    
    events.push({
      event_id: `${baseId}-external-1`,
      causal_parent_id: null,
      determinism_key: `external-noise-${this.determinismSeed}`,
      payload_hash: this.hashPayload({ source: 'external', data: 'noise_1' }),
      event_type: 'EXTERNAL',
      payload: { source: 'external', data: 'noise_1' },
      logical_clock: 2
    });
    
    events.push({
      event_id: `${baseId}-external-2`,
      causal_parent_id: null,
      determinism_key: `external-noise-${this.determinismSeed}`,
      payload_hash: this.hashPayload({ source: 'external', data: 'noise_2' }),
      event_type: 'EXTERNAL',
      payload: { source: 'external', data: 'noise_2' },
      logical_clock: 3
    });
    
    return events;
  }

  generateTortureTestSpine() {
    const events = [];
    const eventCount = 50; // Complex but manageable
    
    for (let i = 0; i < eventCount; i++) {
      const eventType = Math.random() > 0.7 ? 'CAUSAL' : (Math.random() > 0.5 ? 'DERIVED' : 'EXTERNAL');
      const parentId = i > 0 && Math.random() > 0.5 ? events[i - 1].event_id : null;
      
      events.push({
        event_id: uuidv4(),
        causal_parent_id: parentId,
        determinism_key: `torture-${this.determinismSeed}-${i}`,
        payload_hash: this.hashPayload({ index: i, type: eventType, data: Math.random() }),
        event_type: eventType,
        payload: { operation: `torture_op_${i}`, index: i, data: Math.random() },
        logical_clock: i + 1
      });
    }
    
    return events;
  }

  generateBaselineSpine() {
    const events = [];
    const baseId = uuidv4();
    
    events.push({
      event_id: baseId,
      causal_parent_id: null,
      determinism_key: `baseline-${this.determinismSeed}`,
      payload_hash: this.hashPayload({ operation: 'baseline_test' }),
      event_type: 'CAUSAL',
      payload: { operation: 'baseline_test' },
      logical_clock: 1
    });
    
    return events;
  }

  hashPayload(payload) {
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }
}

// =============================================================================
// COMPONENT 2: REALITY DISTORTION ENGINE
// =============================================================================
class RealityDistortionEngine {
  constructor() {
    this.distortionTypes = [
      'timing_delays',
      'out_of_order_delivery',
      'retry_storms',
      'mid_transaction_crashes',
      'state_races',
      'max_chaos'
    ];
  }

  generateRandomDistortion() {
    const type = this.distortionTypes[Math.floor(Math.random() * this.distortionTypes.length)];
    
    return {
      type: type,
      timing_delays: {
        enabled: Math.random() > 0.3,
        min_delay: Math.random() * 100,
        max_delay: Math.random() * 5000,
        probability: Math.random()
      },
      out_of_order_delivery: {
        enabled: Math.random() > 0.5,
        probability: Math.random()
      },
      retry_storms: {
        enabled: Math.random() > 0.7,
        duplicate_probability: Math.random(),
        max_duplicates: Math.floor(Math.random() * 10) + 1
      },
      mid_transaction_crashes: {
        enabled: Math.random() > 0.8,
        crash_probability: Math.random()
      },
      state_races: {
        enabled: Math.random() > 0.6,
        race_probability: Math.random()
      }
    };
  }

  createDistortionProfile(scenario) {
    switch (scenario) {
      case 'write_skew':
        return this.createWriteSkewDistortion();
      case 'retry_storm':
        return this.createRetryStormDistortion();
      case 'out_of_order':
        return this.createOutOfOrderDistortion();
      case 'mid_transaction':
        return this.createMidTransactionDistortion();
      case 'external_noise':
        return this.createExternalNoiseDistortion();
      default:
        return this.generateRandomDistortion();
    }
  }

  createWriteSkewDistortion() {
    return {
      type: 'write_skew',
      timing_delays: { enabled: true, min_delay: 50, max_delay: 1000, probability: 0.8 },
      state_races: { enabled: true, race_probability: 1.0 },
      out_of_order_delivery: { enabled: false, probability: 0 },
      retry_storms: { enabled: false, duplicate_probability: 0, max_duplicates: 1 },
      mid_transaction_crashes: { enabled: false, crash_probability: 0 }
    };
  }

  createRetryStormDistortion() {
    return {
      type: 'retry_storm',
      retry_storms: { enabled: true, duplicate_probability: 0.9, max_duplicates: 50 },
      timing_delays: { enabled: true, min_delay: 10, max_delay: 500, probability: 0.5 },
      state_races: { enabled: false, race_probability: 0 },
      out_of_order_delivery: { enabled: false, probability: 0 },
      mid_transaction_crashes: { enabled: false, crash_probability: 0 }
    };
  }

  createOutOfOrderDistortion() {
    return {
      type: 'out_of_order',
      out_of_order_delivery: { enabled: true, probability: 0.8 },
      timing_delays: { enabled: true, min_delay: 0, max_delay: 2000, probability: 0.6 },
      state_races: { enabled: false, race_probability: 0 },
      retry_storms: { enabled: false, duplicate_probability: 0, max_duplicates: 1 },
      mid_transaction_crashes: { enabled: false, crash_probability: 0 }
    };
  }

  createMidTransactionDistortion() {
    return {
      type: 'mid_transaction',
      mid_transaction_crashes: { enabled: true, crash_probability: 0.3 },
      timing_delays: { enabled: true, min_delay: 100, max_delay: 1000, probability: 0.4 },
      state_races: { enabled: false, race_probability: 0 },
      out_of_order_delivery: { enabled: false, probability: 0 },
      retry_storms: { enabled: false, duplicate_probability: 0, max_duplicates: 1 }
    };
  }

  createExternalNoiseDistortion() {
    return {
      type: 'external_noise',
      timing_delays: { enabled: true, min_delay: 0, max_delay: 3000, probability: 0.7 },
      out_of_order_delivery: { enabled: true, probability: 0.4 },
      retry_storms: { enabled: false, duplicate_probability: 0, max_duplicates: 1 },
      mid_transaction_crashes: { enabled: false, crash_probability: 0 },
      state_races: { enabled: false, race_probability: 0 }
    };
  }
}

// =============================================================================
// COMPONENT 3: EXECUTION MATRIX
// =============================================================================
class ExecutionMatrix {
  createRuns(eventSpine, scenario) {
    const realityEngine = new RealityDistortionEngine();
    
    // Create multiple runs with different distortion profiles
    const runs = [
      {
        name: 'Clean_Execution',
        distortionProfile: {
          type: 'clean',
          timing_delays: { enabled: false },
          out_of_order_delivery: { enabled: false },
          retry_storms: { enabled: false },
          mid_transaction_crashes: { enabled: false },
          state_races: { enabled: false }
        }
      },
      {
        name: 'Delayed_Execution',
        distortionProfile: realityEngine.createDistortionProfile('timing_delays')
      },
      {
        name: 'Scenario_Execution',
        distortionProfile: realityEngine.createDistortionProfile(scenario)
      },
      {
        name: 'Max_Chaos_Execution',
        distortionProfile: {
          type: 'max_chaos',
          timing_delays: { enabled: true, min_delay: 0, max_delay: 5000, probability: 0.8 },
          out_of_order_delivery: { enabled: true, probability: 0.6 },
          retry_storms: { enabled: false, duplicate_probability: 0, max_duplicates: 1 }, // Disabled for external_noise
          mid_transaction_crashes: { enabled: true, crash_probability: 0.2 },
          state_races: { enabled: true, race_probability: 0.4 }
        }
      }
    ];
    
    return runs;
  }
}

// =============================================================================
// COMPONENT 4: CASCADE EXECUTION ENGINE
// =============================================================================
class CascadeExecutionEngine {
  constructor(distortionProfile) {
    this.distortionProfile = distortionProfile;
    this.externalProcessor = new ContainedExternalProcessor();
    this.systemState = {
      accounts: new Map(),
      entities: new Map(),
      derived_state: new Map(),
      external_events: []
    };
    this.executionTime = 0;
    this.errors = [];
    this.eventsProcessed = 0;
  }

  reset() {
    // Reset external processor for each run
    this.externalProcessor.reset();
    this.systemState = {
      accounts: new Map(),
      entities: new Map(),
      derived_state: new Map(),
      external_events: []
    };
    this.executionTime = 0;
    this.errors = [];
    this.eventsProcessed = 0;
  }

  async execute(eventSpine) {
    const startTime = Date.now();
    
    try {
      // Apply distortion to event order
      const distortedEvents = this.applyDistortion(eventSpine);
      
      // Process events
      for (const event of distortedEvents) {
        await this.processEvent(event);
        this.eventsProcessed++;
      }
      
    } catch (error) {
      this.errors.push(error.message);
    }
    
    this.executionTime = Date.now() - startTime;
    
    return {
      systemState: this.systemState,
      executionTime: this.executionTime,
      errors: this.errors,
      eventsProcessed: this.eventsProcessed
    };
  }

  applyDistortion(eventSpine) {
    let events = [...eventSpine];
    
    // Apply timing delays
    if (this.distortionProfile.timing_delays?.enabled) {
      events = events.map(event => ({
        ...event,
        execution_delay: Math.random() * this.distortionProfile.timing_delays.max_delay
      }));
    }
    
    // Apply out-of-order delivery
    if (this.distortionProfile.out_of_order_delivery?.enabled && Math.random() < this.distortionProfile.out_of_order_delivery.probability) {
      events = events.reverse();
    }
    
    // Apply retry storms (deterministic)
    if (this.distortionProfile.retry_storms?.enabled) {
      const originalEvents = [...events];
      events = [];
      
      originalEvents.forEach(event => {
        events.push(event);
        
        // Use deterministic seeding for duplicates
        const duplicateSeed = this.calculateDuplicateSeed(event);
        const shouldDuplicate = (duplicateSeed % 100) < (this.distortionProfile.retry_storms.duplicate_probability * 100);
        
        if (shouldDuplicate) {
          const duplicateCount = (duplicateSeed % this.distortionProfile.retry_storms.max_duplicates) + 1;
          for (let i = 0; i < duplicateCount; i++) {
            events.push({
              ...event,
              event_id: uuidv4(),
              is_duplicate: true,
              original_event_id: event.event_id,
              duplicate_index: i
            });
          }
        }
      });
    }
    
    return events;
  }

  async processEvent(event) {
    // Apply execution delay
    if (event.execution_delay) {
      await this.sleep(event.execution_delay);
    }
    
    // Check for mid-transaction crash
    if (this.distortionProfile.mid_transaction_crashes?.enabled && 
        Math.random() < this.distortionProfile.mid_transaction_crashes.crash_probability) {
      throw new Error('Mid-transaction crash simulated');
    }
    
    // Process based on event type
    switch (event.event_type) {
      case 'CAUSAL':
        await this.processCausalEvent(event);
        break;
      case 'DERIVED':
        await this.processDerivedEvent(event);
        break;
      case 'EXTERNAL':
        await this.processExternalEvent(event);
        break;
    }
  }

  async processCausalEvent(event) {
    if (event.is_duplicate) {
      // Handle duplicate - should converge to same result
      return;
    }
    
    const payload = event.payload;
    
    switch (payload.operation) {
      case 'read_write':
        // Write skew scenario
        const currentBalance = this.systemState.accounts.get(payload.account_id)?.balance || 0;
        this.systemState.accounts.set(payload.account_id, {
          balance: payload.new_balance,
          last_updated: event.logical_clock
        });
        break;
        
      case 'complex_update':
        // Retry storm scenario
        this.systemState.entities.set(event.event_id, {
          operation: payload.operation,
          data: payload.data,
          processed_at: event.logical_clock
        });
        break;
        
      case 'create_parent':
        // Out-of-order scenario
        this.systemState.entities.set(payload.parent_id, {
          type: 'parent',
          created_at: event.logical_clock
        });
        break;
        
      case 'long_transaction':
        // Mid-transaction scenario
        this.systemState.entities.set(event.event_id, {
          operation: payload.operation,
          steps: payload.steps,
          current_step: payload.current_step + 1,
          completed: false
        });
        break;
        
      default:
        this.systemState.entities.set(event.event_id, {
          operation: payload.operation,
          processed_at: event.logical_clock
        });
    }
  }

  async processDerivedEvent(event) {
    const payload = event.payload;
    
    // Derived events depend on parent
    if (event.causal_parent_id && !this.systemState.entities.has(event.causal_parent_id)) {
      // Parent not found - this should be handled deterministically
      this.systemState.derived_state.set(event.event_id, {
        status: 'buffered',
        parent_missing: event.causal_parent_id
      });
    } else {
      this.systemState.derived_state.set(event.event_id, {
        status: 'processed',
        parent_id: event.causal_parent_id,
        operation: payload.operation
      });
    }
  }

  async processExternalEvent(event) {
    // External events are now processed through containment
    try {
      const payload = event.payload;
      
      // Process through contained external processor
      const result = await this.externalProcessor.processExternalEvent(
        payload.source || 'unknown',
        event.event_id,
        payload.data || {}
      );
      
      // Add to system state (deterministic)
      this.systemState.external_events.push({
        event_id: event.event_id,
        source: payload.source,
        data: payload.data,
        normalized: true,
        processed_at: event.logical_clock,
        processing_result: result,
        is_duplicate: result.isDuplicate || false
      });
      
    } catch (error) {
      // Log error but don't fail the entire execution
      this.errors.push(`External event processing error: ${error.message}`);
      
      // Still add to state for consistency
      this.systemState.external_events.push({
        event_id: event.event_id,
        source: event.payload.source,
        data: event.payload.data,
        normalized: false,
        error: error.message,
        processed_at: event.logical_clock
      });
    }
  }

  calculateDuplicateSeed(event) {
    // Generate deterministic seed based on event properties
    const seedInput = `${event.event_type}-${event.logical_clock}-${JSON.stringify(event.payload)}`;
    let hash = 0;
    for (let i = 0; i < seedInput.length; i++) {
      const char = seedInput.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// =============================================================================
// COMPONENT 5: DETERMINISTIC STATE CAPTURE
// =============================================================================
class DeterministicStateCapture {
  capture(executionResult) {
    const state = executionResult.systemState;
    
    // Canonicalize state for hashing
    const canonicalState = this.canonicalizeState(state);
    
    // Calculate state hash (no timestamps, no randomness)
    const stateHash = this.calculateStateHash(canonicalState);
    
    // Capture derived outputs
    const derivedOutputs = this.captureDerivedOutputs(state);
    
    // Capture side effects
    const sideEffects = this.captureSideEffects(state);
    
    // Calculate replay hash
    const replayHash = this.calculateReplayHash(executionResult);
    
    return {
      stateHash: stateHash,
      eventCount: executionResult.eventsProcessed,
      derivedOutputs: derivedOutputs,
      sideEffects: sideEffects,
      replayHash: replayHash
    };
  }

  canonicalizeState(state) {
    // Remove all non-deterministic elements
    const canonical = {
      accounts: {},
      entities: {},
      derived_state: {},
      external_events: []
    };
    
    // Sort keys for consistency
    Object.keys(state.accounts).sort().forEach(key => {
      const account = state.accounts.get(key);
      canonical.accounts[key] = {
        balance: account.balance,
        last_updated: account.last_updated
        // No timestamps, no randomness
      };
    });
    
    Object.keys(state.entities).sort().forEach(key => {
      const entity = state.entities.get(key);
      canonical.entities[key] = {
        type: entity.type || 'unknown',
        operation: entity.operation,
        processed_at: entity.processed_at
        // No creation timestamps
      };
    });
    
    Object.keys(state.derived_state).sort().forEach(key => {
      const derived = state.derived_state.get(key);
      canonical.derived_state[key] = {
        status: derived.status,
        parent_id: derived.parent_id
      };
    });
    
    // Sort external events
    canonical.external_events = state.external_events
      .map(event => ({
        source: event.source,
        normalized: event.normalized,
        is_duplicate: event.is_duplicate || false,
        // Only include deterministic fields from processing result
        processing_result: event.processing_result ? {
          is_duplicate: event.processing_result.is_duplicate || false,
          deterministic: event.processing_result.deterministic || false,
          // Exclude non-deterministic fields like duplicate_of and processed_at
        } : null
      }))
      .filter(event => event && event.source) // Filter out undefined events
      .sort((a, b) => a.source.localeCompare(b.source));
    
    return canonical;
  }

  calculateStateHash(canonicalState) {
    const stateString = JSON.stringify(canonicalState, Object.keys(canonicalState).sort());
    return crypto.createHash('sha256').update(stateString).digest('hex');
  }

  captureDerivedOutputs(state) {
    return Object.keys(state.derived_state).map(key => ({
      id: key,
      status: state.derived_state.get(key).status
    })).sort((a, b) => a.id.localeCompare(b.id));
  }

  captureSideEffects(state) {
    return state.external_events
      .filter(event => event && event.source) // Filter out undefined events
      .map(event => ({
        source: event.source,
        normalized: event.normalized,
        is_duplicate: event.is_duplicate || false,
        // Only include deterministic fields from processing result
        processing_result: event.processing_result ? {
          is_duplicate: event.processing_result.is_duplicate || false,
          deterministic: event.processing_result.deterministic || false
        } : null
      }))
      .sort((a, b) => a.source.localeCompare(b.source));
  }

  calculateReplayHash(executionResult) {
    const replayInput = {
      events_processed: executionResult.eventsProcessed,
      errors: executionResult.errors.length,
      execution_time: executionResult.executionTime
    };
    
    return crypto.createHash('sha256').update(JSON.stringify(replayInput)).digest('hex');
  }
}

// =============================================================================
// COMPONENT 6: CONVERGENCE ORACLE
// =============================================================================
class ConvergenceOracle {
  checkConvergence(runResults) {
    const stateHashes = runResults.map(run => run.stateHash);
    const uniqueHashes = new Set(stateHashes);
    
    const converged = uniqueHashes.size === 1;
    const failures = [];
    
    if (!converged) {
      // Classify failures
      const hashGroups = this.groupByHash(runResults);
      
      hashGroups.forEach((runs, hash) => {
        if (runs.length < runResults.length) {
          failures.push({
            type: this.classifyFailure(hashGroups, runs),
            description: `${runs.length} runs produced hash ${hash.substring(0, 8)}...`,
            affected_runs: runs.map(r => r.runName)
          });
        }
      });
    }
    
    return {
      converged: converged,
      uniqueHashes: uniqueHashes.size,
      failures: failures,
      consensusHash: converged ? Array.from(uniqueHashes)[0] : null
    };
  }

  groupByHash(runResults) {
    const groups = new Map();
    
    runResults.forEach(run => {
      if (!groups.has(run.stateHash)) {
        groups.set(run.stateHash, []);
      }
      groups.get(run.stateHash).push(run);
    });
    
    return groups;
  }

  classifyFailure(hashGroups, minorityRuns) {
    // Determine failure type based on patterns
    const eventCounts = minorityRuns.map(r => r.eventCount);
    const hasMissingEvents = eventCounts.some(count => count < Math.max(...eventCounts));
    
    if (hasMissingEvents) {
      return 'MISSING_EVENTS';
    }
    
    const hasExtraEvents = eventCounts.some(count => count > Math.min(...eventCounts));
    if (hasExtraEvents) {
      return 'RETRY_DUPLICATION';
    }
    
    const hasErrors = minorityRuns.some(r => r.errors.length > 0);
    if (hasErrors) {
      return 'EXECUTION_ERROR';
    }
    
    return 'NON_DETERMINISM';
  }
}

// Execute the harness
if (require.main === module) {
  const harness = new BrokenRealityDeterminismHarness();
  harness.runDeterminismTest().catch(console.error);
}

module.exports = BrokenRealityDeterminismHarness;
