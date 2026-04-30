// BROKEN REALITY INJECTION TEST - FIXED VERSION
// Tests what happens when the world fights back
// This is where distributed systems actually fail

const { v4: uuidv4 } = require('uuid');

class BrokenRealityFixedTest {
  constructor() {
    this.eventSpine = [];
    this.systemState = {
      chaosRuns: new Map(),
      chaosRunInstances: new Map(),
      chaosAlerts: new Map(),
      chaosRunVerdicts: new Map(),
      externalState: new Map()
    };
    
    // These should be at the top level, not inside systemState
    this.delayedEvents = [];
    this.droppedEvents = [];
    this.duplicatedEvents = [];
    this.reorderedVisibility = new Map();
    this.rogueWrites = [];
    
    this.injectionMetrics = {
      delayedCommits: 0,
      droppedExternals: 0,
      duplicatedRetries: 0,
      reorderedEvents: 0,
      rogueWrites: 0,
      sideEffectLeaks: 0,
      replayDivergences: 0,
      crossBoundaryConflicts: 0,
      resourceContentionViolations: 0
    };
    
    this.testResults = {
      crossBoundaryPressure: false,
      partialObservabilityReplay: false,
      sideEffectLeakage: false,
      deterministicUnderStress: false,
      brokenRealityResilience: false
    };
  }

  async executeBrokenRealityTest() {
    console.log('🧪 BROKEN REALITY INJECTION TEST - FIXED');
    console.log('=======================================');
    console.log('Testing what happens when the world fights back\n');
    
    const startTime = Date.now();
    
    try {
      // Phase 1: Setup controlled chaos environment
      await this.setupControlledEnvironment();
      
      // Phase 2: Inject broken reality
      await this.injectBrokenReality();
      
      // Phase 3: Test cross-boundary state pressure
      await this.testCrossBoundaryPressure();
      
      // Phase 4: Test replay under partial observability
      await this.testPartialObservabilityReplay();
      
      // Phase 5: Test side-effect leakage
      await this.testSideEffectLeakage();
      
      // Phase 6: Test determinism under resource contention
      await this.testDeterminismUnderStress();
      
      // Phase 7: Validate final state consistency
      await this.validateFinalStateConsistency();
      
      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      
      this.reportBrokenRealityResults(duration);
      
    } catch (error) {
      console.log('\n💥 BROKEN REALITY TEST CRASHED');
      console.log('System failed when reality fought back:', error.message);
      console.log('\nThis is where distributed systems actually break.');
    }
  }

  // =============================================================================
  // PHASE 1: SETUP CONTROLLED ENVIRONMENT
  // =============================================================================
  async setupControlledEnvironment() {
    console.log('🚀 PHASE 1 — Setup Controlled Environment');
    
    // Create initial system state
    for (let i = 0; i < 10; i++) {
      const runId = uuidv4();
      this.systemState.chaosRuns.set(runId, {
        id: runId,
        name: `Controlled_Run_${i}`,
        status: 'running',
        created_at: new Date()
      });
      
      // Create some instances
      for (let j = 0; j < 2; j++) {
        const instanceId = uuidv4();
        this.systemState.chaosRunInstances.set(instanceId, {
          id: instanceId,
          chaos_run_id: runId,
          scenario_key: `instance-${j}`,
          state: 'running',
          created_at: new Date()
        });
      }
    }
    
    // Create some external state (outside CASCADE)
    for (let i = 0; i < 5; i++) {
      const externalId = uuidv4();
      this.systemState.externalState.set(externalId, {
        id: externalId,
        type: 'external_resource',
        value: Math.random() * 1000,
        last_modified: new Date()
      });
    }
    
    console.log(`  Created ${this.systemState.chaosRuns.size} controlled runs`);
    console.log(`  Created ${this.systemState.chaosRunInstances.size} controlled instances`);
    console.log(`  Created ${this.systemState.externalState.size} external resources`);
    console.log('  Ready for broken reality injection');
  }

  // =============================================================================
  // PHASE 2: INJECT BROKEN REALITY
  // =============================================================================
  async injectBrokenReality() {
    console.log('\n⚡ PHASE 2 — Inject Broken Reality');
    
    // Simulate broken reality injection with controlled delays
    await this.simulateDelayedCommits(30);
    await this.simulateDroppedExternals(20);
    await this.simulateDuplicatedRetries(15);
    await this.simulateReorderedVisibility(25);
    await this.simulateRogueWrites(10);
    
    console.log('  Broken reality injection completed');
  }

  // =============================================================================
  // SIMULATION FUNCTIONS (NO setTimeout CONTEXT ISSUES)
  // =============================================================================
  
  async simulateDelayedCommits(count) {
    console.log('    ⏰ Simulate delayed commits...');
    
    for (let i = 0; i < count; i++) {
      const eventId = uuidv4();
      const delay = Math.random() * 100; // 0-100ms delay
      
      // Create event but delay commit
      const event = {
        id: this.eventSpine.length,
        event_id: eventId,
        event_type: 'CAUSAL',
        agent: 'EXECUTOR',
        payload: {
          operation_id: `delayed_commit_${i}`,
          delay_ms: delay
        },
        decision_time: new Date(),
        commit_time: null,
        visibility_time: null,
        processing_status: 'pending',
        created_at: new Date()
      };
      
      this.eventSpine.push(event);
      this.delayedEvents.push(eventId);
      
      // Simulate delayed commit
      await this.sleep(delay);
      event.commit_time = new Date();
      event.visibility_time = new Date();
      event.processing_status = 'committed';
      this.injectionMetrics.delayedCommits++;
    }
  }

  async simulateDroppedExternals(count) {
    console.log('    💣 Simulate dropped externals...');
    
    for (let i = 0; i < count; i++) {
      const externalId = uuidv4();
      
      // Create external event but drop it before normalization
      const externalEvent = {
        id: this.eventSpine.length,
        event_id: externalId,
        event_type: 'EXTERNAL',
        agent: 'SYSTEM',
        payload: {
          external_source: 'dropped_source',
          external_event_type: 'performance_signal',
          external_data: { value: Math.random() * 1000 }
        },
        decision_time: new Date(),
        processing_status: 'dropped',
        created_at: new Date()
      };
      
      // Intentionally don't add to spine - simulate drop
      this.droppedEvents.push(externalId);
      this.injectionMetrics.droppedExternals++;
      
      await this.sleep(Math.random() * 10);
    }
  }

  async simulateDuplicatedRetries(count) {
    console.log('    🔄 Simulate duplicated retries...');
    
    for (let i = 0; i < count; i++) {
      const parentEventId = uuidv4();
      const retryEventId = uuidv4();
      
      // Create parent event
      const parentEvent = {
        id: this.eventSpine.length,
        event_id: parentEventId,
        event_type: 'CAUSAL',
        agent: 'EXECUTOR',
        payload: {
          operation_id: `retry_parent_${i}`,
          failure_rate: 0.8
        },
        decision_time: new Date(),
        processing_status: 'committed',
        commit_time: new Date(),
        visibility_time: new Date(),
        created_at: new Date()
      };
      
      this.eventSpine.push(parentEvent);
      
      // Create duplicate retry event
      const retryEvent1 = {
        id: this.eventSpine.length,
        event_id: retryEventId,
        event_type: 'CAUSAL',
        agent: 'RETRY_COORDINATOR',
        payload: {
          original_event_id: parentEventId,
          retry_reason: 'processing_failure',
          retry_count: 1
        },
        causal_parent_id: parentEventId,
        decision_time: new Date(),
        processing_status: 'pending',
        created_at: new Date()
      };
      
      const retryEvent2 = {
        id: this.eventSpine.length,
        event_id: uuidv4(), // Different ID but same parent
        event_type: 'CAUSAL',
        agent: 'RETRY_COORDINATOR',
        payload: {
          original_event_id: parentEventId,
          retry_reason: 'processing_failure',
          retry_count: 1
        },
        causal_parent_id: parentEventId,
        decision_time: new Date(),
        processing_status: 'pending',
        created_at: new Date()
      };
      
      this.eventSpine.push(retryEvent1);
      this.eventSpine.push(retryEvent2);
      
      this.duplicatedEvents.push([retryEvent1.event_id, retryEvent2.event_id]);
      this.injectionMetrics.duplicatedRetries++;
      
      await this.sleep(Math.random() * 5);
    }
  }

  async simulateReorderedVisibility(count) {
    console.log('    🔀 Simulate reordered event visibility...');
    
    for (let i = 0; i < count; i++) {
      const eventId = uuidv4();
      const visibilityDelay = Math.random() * 200; // 0-200ms
      const reorderingDelay = Math.random() * 50; // 0-50ms reordering
      
      const event = {
        id: this.eventSpine.length,
        event_id: eventId,
        event_type: 'CAUSAL',
        agent: 'EXECUTOR',
        payload: {
          operation_id: `reordered_${i}`,
          visibility_delay: visibilityDelay,
          reordering_delay: reorderingDelay
        },
        decision_time: new Date(),
        commit_time: new Date(),
        visibility_time: null,
        processing_status: 'committed',
        created_at: new Date()
      };
      
      this.eventSpine.push(event);
      
      // Reorder visibility timing
      await this.sleep(reorderingDelay);
      event.visibility_time = new Date(Date.now() + visibilityDelay + reorderingDelay);
      this.reorderedVisibility.set(eventId, {
        original_delay: visibilityDelay,
        reordering_delay: reorderingDelay,
        final_visibility_time: event.visibility_time
      });
      this.injectionMetrics.reorderedEvents++;
      
      await this.sleep(Math.random() * 5);
    }
  }

  async simulateRogueWrites(count) {
    console.log('    💀 Simulate rogue writes...');
    
    for (let i = 0; i < count; i++) {
      const runId = uuidv4();
      const instanceId = uuidv4();
      
      // Create run in CASCADE
      this.systemState.chaosRuns.set(runId, {
        id: runId,
        name: `Rogue_Run_${i}`,
        status: 'running',
        created_at: new Date()
      });
      
      // Create instance in CASCADE
      this.systemState.chaosRunInstances.set(instanceId, {
        id: instanceId,
        chaos_run_id: runId,
        scenario_key: `rogue_instance_${i}`,
        state: 'running',
        created_at: new Date()
      });
      
      // Simulate rogue write outside CASCADE
      const rogueWrite = {
        timestamp: new Date(),
        source: 'rogue_service',
        operation: 'direct_write',
        table: 'chaos_run_instances',
        data: {
          id: instanceId,
          chaos_run_id: uuidv4(), // Different run ID - creates orphan
          scenario_key: 'rogue_modified',
          state: 'modified_by_rogue',
          created_at: new Date()
        },
        bypassed_cascade: true
      };
      
      this.rogueWrites.push(rogueWrite);
      this.injectionMetrics.rogueWrites++;
      
      // Update the instance with rogue data
      this.systemState.chaosRunInstances.set(instanceId, rogueWrite.data);
      
      await this.sleep(Math.random() * 10);
    }
  }

  // =============================================================================
  // PHASE 3: TEST CROSS-BOUNDARY STATE PRESSURE
  // =============================================================================
  async testCrossBoundaryPressure() {
    console.log('\n🔀 PHASE 3 — Test Cross-Boundary State Pressure');
    
    // Multiple agents mutating related state simultaneously
    for (let i = 0; i < 20; i++) {
      const runId = Array.from(this.systemState.chaosRuns.keys())[i % this.systemState.chaosRuns.size];
      const externalId = Array.from(this.systemState.externalState.keys())[i % this.systemState.externalState.size];
      
      // Agent 1: Mutate CASCADE state
      const event1Id = this.submitEvent('CAUSAL', 'AGENT_1', {
        run_id: runId,
        operation: 'update_status',
        new_status: 'modified_by_agent_1',
        timestamp: new Date()
      });
      
      // Agent 2: Mutate external state (simultaneous)
      const externalWrite = {
        id: externalId,
        type: 'external_resource',
        value: Math.random() * 2000,
        last_modified: new Date(),
        modified_by: 'agent_2',
        cross_boundary_reference: runId
      };
      
      this.systemState.externalState.set(externalId, externalWrite);
      
      // Agent 3: Try to create relationship between states
      const relationshipEventId = uuidv4();
      const relationshipEvent = {
        id: this.eventSpine.length,
        event_id: relationshipEventId,
        event_type: 'CAUSAL',
        agent: 'AGENT_3',
        payload: {
          run_id: runId,
          external_id: externalId,
          relationship: 'cross_boundary_link',
          created_at: new Date()
        },
        decision_time: new Date(),
        processing_status: 'pending',
        created_at: new Date()
      };
      
      this.eventSpine.push(relationshipEvent);
      
      await this.sleep(Math.random() * 2);
    }
    
    // Check for cross-boundary conflicts
    const conflicts = this.detectCrossBoundaryConflicts();
    this.testResults.crossBoundaryPressure = conflicts.length === 0;
    
    console.log(`  Cross-boundary pressure: ${conflicts.length === 0 ? '✅ No conflicts' : '❌ ' + conflicts.length + ' conflicts'}`);
  }

  // =============================================================================
  // PHASE 4: TEST REPLAY UNDER PARTIAL OBSERVABILITY
  // =============================================================================
  async testPartialObservabilityReplay() {
    console.log('\n👁️ PHASE 4 — Test Replay Under Partial Observability');
    
    // Create a sequence of events
    const originalEvents = [];
    for (let i = 0; i < 10; i++) {
      const eventId = this.submitEvent('CAUSAL', 'SYSTEM', {
        sequence: i,
        operation: `replay_test_${i}`,
        value: Math.random() * 100
      });
      originalEvents.push(eventId);
    }
    
    // Process all events
    for (const eventId of originalEvents) {
      await this.processEvent(eventId);
    }
    
    // Capture final state
    const originalFinalState = this.captureSystemState();
    
    // Now simulate partial observability
    const partialEvents = originalEvents.slice(0, Math.floor(originalEvents.length * 0.7)); // Lose 30% of events
    const missingEvents = originalEvents.slice(Math.floor(originalEvents.length * 0.7));
    
    // Clear and replay with partial observability
    this.eventSpine = [];
    this.systemState = {
      chaosRuns: new Map(),
      chaosRunInstances: new Map(),
      chaosAlerts: new Map(),
      chaosRunVerdicts: new Map(),
      externalState: new Map()
    };
    
    // Replay with partial events
    for (const eventId of partialEvents) {
      await this.processEvent(eventId);
    }
    
    const replayFinalState = this.captureSystemState();
    
    // Check if states match
    const statesMatch = JSON.stringify(originalFinalState) === JSON.stringify(replayFinalState);
    
    this.testResults.partialObservabilityReplay = statesMatch;
    
    console.log(`  Partial observability replay: ${statesMatch ? '✅ States match' : '❌ States diverge'}`);
    console.log(`  Original events: ${originalEvents.length}, Partial events: ${partialEvents.length}, Missing: ${missingEvents.length}`);
    
    if (!statesMatch) {
      this.injectionMetrics.replayDivergences++;
    }
  }

  // =============================================================================
  // PHASE 5: TEST SIDE-EFFECT LEAKAGE
  // =============================================================================
  async testSideEffectLeakage() {
    console.log('\n💧 PHASE 5 — Test Side-Effect Leakage');
    
    // Create events with declared side effects
    const sideEffectEvents = [];
    
    for (let i = 0; i < 15; i++) {
      const eventId = uuidv4();
      const event = {
        id: this.eventSpine.length,
        event_id: eventId,
        event_type: 'CAUSAL',
        agent: 'EXECUTOR',
        payload: {
          operation_id: `side_effect_test_${i}`,
          declared_side_effects: [
            { id: uuidv4(), type: 'database_write', table: 'chaos_runs' },
            { id: uuidv4(), type: 'cache_update', key: `cache_${i}` }
          ]
        },
        side_effects: [], // Will be populated during processing
        decision_time: new Date(),
        processing_status: 'pending',
        created_at: new Date()
      };
      
      this.eventSpine.push(event);
      sideEffectEvents.push(eventId);
    }
    
    // Process events
    for (const eventId of sideEffectEvents) {
      await this.processEvent(eventId);
    }
    
    // Now inject hidden side effects outside declared list
    const hiddenSideEffect = {
      timestamp: new Date(),
      source: 'hidden_process',
      operation: 'undeclared_write',
      table: 'chaos_alerts',
      data: {
        id: uuidv4(),
        run_id: uuidv4(),
        severity: 'critical',
        created_at: new Date()
      },
      bypassed_declaration: true
    };
    
    this.injectionMetrics.sideEffectLeaks++;
    
    // Add to system state outside side_effects tracking
    this.systemState.chaosAlerts.set(hiddenSideEffect.data.id, hiddenSideEffect.data);
    
    await this.sleep(50);
    
    // Check for side effect leakage
    const declaredSideEffects = sideEffectEvents.reduce((acc, eventId) => {
      const event = this.eventSpine.find(e => e.event_id === eventId);
      return acc + (event?.side_effects?.length || 0);
    }, 0);
    
    const actualAlerts = this.systemState.chaosAlerts.size;
    const leakedSideEffects = actualAlerts - declaredSideEffects;
    
    this.testResults.sideEffectLeakage = leakedSideEffects === 0;
    
    console.log(`  Side-effect leakage: ${leakedSideEffects === 0 ? '✅ No leaks' : '❌ ' + leakedSideEffects + ' leaks'}`);
    console.log(`  Declared side effects: ${declaredSideEffects}, Actual alerts: ${actualAlerts}`);
  }

  // =============================================================================
  // PHASE 6: TEST DETERMINISM UNDER RESOURCE CONTENTION
  // =============================================================================
  async testDeterminismUnderStress() {
    console.log('\n🏋️ PHASE 6 — Test Determinism Under Resource Contention');
    
    const stressTests = [];
    
    for (let i = 0; i < 20; i++) {
      const input = {
        operation_id: `stress_test_${i}`,
        value: Math.random() * 1000,
        timestamp: new Date()
      };
      
      // Simulate resource contention by adding delays
      const contentionDelay = Math.random() * 50; // 0-50ms
      
      // First execution under stress
      const result1 = await this.processWithContention(input, contentionDelay);
      
      // Second execution with same input but different timing
      const result2 = await this.processWithContention(input, Math.random() * 50);
      
      // Check determinism
      const deterministic = JSON.stringify(result1) === JSON.stringify(result2);
      
      stressTests.push({ input, result1, result2, deterministic, contentionDelay });
      
      await this.sleep(Math.random() * 2);
    }
    
    // Check determinism
    const deterministicCount = stressTests.filter(t => t.deterministic).length;
    const totalTests = stressTests.length;
    
    this.testResults.deterministicUnderStress = deterministicCount === totalTests;
    
    console.log(`  Determinism under stress: ${deterministicCount}/${totalTests} tests deterministic`);
    
    if (deterministicCount < totalTests) {
      this.injectionMetrics.resourceContentionViolations++;
    }
  }

  // =============================================================================
  // HELPER FUNCTIONS
  // =============================================================================
  
  submitEvent(eventType, agent, payload, metadata = {}, causalParentId = null) {
    const eventId = uuidv4();
    const event = {
      id: this.eventSpine.length,
      event_id: eventId,
      event_type: eventType,
      agent: agent,
      payload: payload,
      metadata: metadata,
      causal_parent_id: causalParentId,
      decision_time: new Date(),
      processing_status: 'pending',
      created_at: new Date()
    };
    
    this.eventSpine.push(event);
    return eventId;
  }

  async processEvent(eventId) {
    const event = this.eventSpine.find(e => e.event_id === eventId);
    if (!event) return null;
    
    event.processing_status = 'processing';
    
    try {
      // Simulate processing
      await this.sleep(Math.random() * 5);
      
      // Process based on type
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
      
      event.processing_status = 'committed';
      event.commit_time = new Date();
      event.visibility_time = new Date();
      
    } catch (error) {
      event.processing_status = 'failed';
      event.last_error = error.message;
    }
    
    return event;
  }

  async processCausalEvent(event) {
    // Process causal event
    if (event.payload?.operation === 'update_status') {
      const runId = event.payload.run_id;
      const run = this.systemState.chaosRuns.get(runId);
      if (run) {
        run.status = event.payload.new_status;
        run.modified_at = new Date();
      }
    }
    
    // Generate side effects
    if (event.payload?.declared_side_effects) {
      event.side_effects = event.payload.declared_side_effects.map(se => ({
        ...se,
        processed_at: new Date(),
        status: 'completed'
      }));
    }
  }

  async processDerivedEvent(event) {
    // Process derived event (pure function)
    // No state mutation
  }

  async processExternalEvent(event) {
    // Process external event
    // Normalize and convert to causal if needed
  }

  async processWithContention(input, delay) {
    // Simulate processing under resource contention
    await this.sleep(delay);
    
    return {
      input: input,
      result: {
        value: input.value * 2,
        processed_at: new Date(),
        contention_delay: delay
      },
      deterministic: true
    };
  }

  captureSystemState() {
    return {
      chaos_runs_count: this.systemState.chaosRuns.size,
      chaos_instances_count: this.systemState.chaosRunInstances.size,
      chaos_alerts_count: this.systemState.chaosAlerts.size,
      external_state_count: this.systemState.externalState.size,
      timestamp: new Date()
    };
  }

  detectCrossBoundaryConflicts() {
    const conflicts = [];
    
    // Check for orphan instances
    const orphanInstances = Array.from(this.systemState.chaosRunInstances.values())
      .filter(instance => !this.systemState.chaosRuns.has(instance.chaos_run_id));
    
    if (orphanInstances.length > 0) {
      conflicts.push({
        type: 'orphan_instances',
        count: orphanInstances.length,
        instances: orphanInstances
      });
    }
    
    // Check for inconsistent cross-references
    for (const [externalId, external] of this.systemState.externalState.entries()) {
      if (external.cross_boundary_reference) {
        const runExists = this.systemState.chaosRuns.has(external.cross_boundary_reference);
        if (!runExists) {
          conflicts.push({
            type: 'broken_cross_reference',
            external_id: externalId,
            missing_reference: external.cross_boundary_reference
          });
        }
      }
    }
    
    return conflicts;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // =============================================================================
  // PHASE 7: VALIDATE FINAL STATE CONSISTENCY
  // =============================================================================
  async validateFinalStateConsistency() {
    console.log('\n🎯 PHASE 7 — Validate Final State Consistency');
    
    // Check if system can be replayed to same final state
    const currentState = this.captureSystemState();
    
    // Count all issues
    const issues = {
      delayedCommits: this.delayedEvents.length,
      droppedExternals: this.droppedEvents.length,
      duplicatedRetries: this.duplicatedEvents.length,
      reorderedEvents: this.reorderedVisibility.size,
      rogueWrites: this.rogueWrites.length,
      sideEffectLeaks: this.injectionMetrics.sideEffectLeaks,
      replayDivergences: this.injectionMetrics.replayDivergences,
      crossBoundaryConflicts: this.detectCrossBoundaryConflicts().length
    };
    
    const totalIssues = Object.values(issues).reduce((sum, count) => sum + count, 0);
    
    this.testResults.brokenRealityResilience = totalIssues === 0;
    
    console.log(`  Final state consistency: ${totalIssues === 0 ? '✅ Consistent' : '❌ ' + totalIssues + ' issues'}`);
    
    console.log('\n📊 ISSUE BREAKDOWN:');
    Object.entries(issues).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });
    
    if (totalIssues > 0) {
      console.log('\n❌ BROKEN REALITY DETECTED');
      console.log('The system breaks when reality fights back.');
      console.log('This is where distributed systems actually fail in production.');
    } else {
      console.log('\n✅ BROKEN REALITY RESILIENCE ACHIEVED');
      console.log('System maintains consistency even under broken reality injection.');
    }
  }

  // =============================================================================
  // REPORTING
  // =============================================================================
  reportBrokenRealityResults(duration) {
    console.log('\n🏁 BROKEN REALITY INJECTION TEST RESULTS');
    console.log('=====================================');
    console.log(`Duration: ${duration.toFixed(2)}s`);
    
    console.log('\n📊 INJECTION METRICS:');
    console.log(`  Delayed commits: ${this.injectionMetrics.delayedCommits}`);
    console.log(`  Dropped externals: ${this.injectionMetrics.droppedExternals}`);
    console.log(`  Duplicated retries: ${this.injectionMetrics.duplicatedRetries}`);
    console.log(`  Reordered events: ${this.injectionMetrics.reorderedEvents}`);
    console.log(`  Rogue writes: ${this.injectionMetrics.rogueWrites}`);
    console.log(`  Side-effect leaks: ${this.injectionMetrics.sideEffectLeaks}`);
    console.log(`  Replay divergences: ${this.injectionMetrics.replayDivergences}`);
    console.log(`  Cross-boundary conflicts: ${this.injectionMetrics.crossBoundaryConflicts}`);
    console.log(`  Resource contention violations: ${this.injectionMetrics.resourceContentionViolations}`);
    
    console.log('\n🔍 TEST RESULTS:');
    Object.entries(this.testResults).forEach(([test, result]) => {
      console.log(`  ${test}: ${result ? '✅ PASSED' : '❌ FAILED'}`);
    });
    
    const passedTests = Object.values(this.testResults).filter(result => result).length;
    const totalTests = Object.keys(this.testResults).length;
    
    console.log(`\n🎯 BROKEN REALITY ASSESSMENT:`);
    console.log(`Tests passed: ${passedTests}/${totalTests}`);
    
    if (passedTests === totalTests) {
      console.log('\n🎉 BROKEN REALITY RESILIENCE ACHIEVED');
      console.log('System maintains consistency even when reality fights back.');
      console.log('This is true adversarial resilience.');
    } else {
      console.log('\n⚠️ BROKEN REALITY VULNERABILITIES DETECTED');
      console.log('System breaks when injected with real-world chaos.');
      console.log('This is where distributed systems actually fail in production.');
      
      console.log('\n🔧 CRITICAL VULNERABILITIES:');
      Object.entries(this.testResults).forEach(([test, failed]) => {
        if (!failed) {
          console.log(`  - ${test}: System fails under broken reality`);
        }
      });
    }
    
    console.log('\n💡 THE REAL INSIGHT:');
    console.log('Clean tests prove nothing under broken reality.');
    console.log('Only when the system survives chaos injection can we claim true resilience.');
  }
}

// Execute the broken reality injection test
const tester = new BrokenRealityFixedTest();
tester.executeBrokenRealityTest().catch(console.error);
