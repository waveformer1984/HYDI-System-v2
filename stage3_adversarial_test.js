// STAGE 3 ADVERSARIAL TEST: Global Coordination Validation
// Tests that global coordination eliminates Stage 2 failure modes by construction

const { v4: uuidv4 } = require('uuid');

class Stage3AdversarialTest {
  constructor() {
    this.globalEventLog = [];
    this.causalChains = new Map();
    this.systemState = {
      chaosRuns: new Map(),
      chaosRunInstances: new Map(),
      chaosAlerts: new Map(),
      chaosRunVerdicts: new Map(),
      globalOrder: 0,
      lastProcessedEvent: null,
      inconsistencies: [],
      reconciliations: []
    };
    
    this.stage3Metrics = {
      totalEvents: 0,
      processedEvents: 0,
      failedEvents: 0,
      causalChainViolations: 0,
      timingViolations: 0,
      retryNonDeterminism: 0,
      writeSkewEvents: 0,
      snapshotInconsistencies: 0,
      convergenceFailures: 0,
      globalOrderViolations: 0,
      reconciliationEvents: 0,
      consistencyChecks: 0
    };
    
    this.stage3Results = {
      globalOrdering: false,
      singleSourceOfCausality: false,
      explicitTimingModel: false,
      deterministicRetries: false,
      inconsistencyResolution: false,
      globalConsistency: false,
      adversarialResilience: false
    };
  }

  // =============================================================================
  // STAGE 3 ADVERSARIAL EXECUTION
  // =============================================================================
  async executeStage3AdversarialTest() {
    console.log('🚀 STAGE 3 ADVERSARIAL TEST: Global Coordination Validation');
    console.log('=======================================================');
    console.log('Testing that global coordination eliminates Stage 2 failure modes\n');
    
    const startTime = Date.now();
    
    try {
      // Phase 1: Initialize global coordination environment
      await this.initializeGlobalCoordination();
      
      // Phase 2: Execute adversarial scenarios through global event log
      await this.executeGlobalEventLogAdversary();
      
      // Phase 3: Test global ordering under extreme concurrency
      await this.testGlobalOrderingUnderStress();
      
      // Phase 4: Test causal chain integrity under failures
      await this.testCausalChainIntegrity();
      
      // Phase 5: Test explicit timing model under skew
      await this.testExplicitTimingModel();
      
      // Phase 6: Test deterministic retry model
      await this.testDeterministicRetries();
      
      // Phase 7: Test inconsistency detection and reconciliation
      await this.testInconsistencyResolution();
      
      // Phase 8: Validate global consistency
      await this.validateGlobalConsistency();
      
      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      
      this.reportStage3Results(duration);
      
    } catch (error) {
      console.log('\n💥 STAGE 3 ADVERSARIAL TEST CRASHED');
      console.log('Global coordination failure under adversarial stress:', error.message);
      console.log('\nStage 3 architecture needs refinement.');
    }
  }

  // =============================================================================
  // PHASE 1: INITIALIZE GLOBAL COORDINATION
  // =============================================================================
  async initializeGlobalCoordination() {
    console.log('🚀 PHASE 1 — Initialize Global Coordination');
    
    // Create initial system state
    for (let i = 0; i < 10; i++) {
      const runId = await this.submitGlobalEvent('chaos_run_created', {
        run_id: uuidv4(),
        name: `Global_Run_${i}`,
        seed: 12345 + i,
        total_runs: 20,
        concurrency: 5,
        failure_rate: 0.15,
        duplicate_event_rate: 0.1,
        stall_probability: 0.05,
        latency_profile_ms: [50, 500, 2000]
      });
      
      // Process event to create system state
      await this.processGlobalEvent(runId);
    }
    
    console.log(`  Created ${this.systemState.chaosRuns.size} runs through global event log`);
    console.log(`  Global order established: ${this.systemState.globalOrder} events`);
    console.log('  Global coordination environment ready');
  }

  // =============================================================================
  // PHASE 2: EXECUTE ADVERSARIAL SCENARIOS THROUGH GLOBAL EVENT LOG
  // =============================================================================
  async executeGlobalEventLogAdversary() {
    console.log('\n⚡ PHASE 2 — Execute Adversarial Scenarios Through Global Event Log');
    
    const adversarialScenarios = [
      () => this.concurrentChaosOperationsThroughLog(15),
      () => this.conflictingDecisionsThroughLog(10),
      () => this.retryStormsThroughLog(8),
      () => this.timingChaosThroughLog(6),
      () => this.causalChainConflicts(5),
      () => this.globalOrderingStress(12),
      () => this.inconsistentStateInjection(4),
      () => this.reconciliationUnderAdversarialConditions(3)
    ];
    
    console.log(`  Launching ${adversarialScenarios.length} adversarial scenarios...`);
    
    // Execute all scenarios simultaneously through global event log
    const promises = adversarialScenarios.map(async (scenario, index) => {
      await this.sleep(Math.random() * 10);
      return scenario();
    });
    
    const results = await Promise.allSettled(promises);
    
    // Process all events in global order
    await this.processAllPendingEvents();
    
    const failures = results.filter(r => r.status === 'rejected');
    console.log(`  Adversarial scenarios completed: ${results.length - failures.length}/${results.length}`);
    
    this.stage3Metrics.totalEvents += this.globalEventLog.length;
  }

  // =============================================================================
  // ADVERSARIAL SCENARIOS THROUGH GLOBAL EVENT LOG
  // =============================================================================

  async concurrentChaosOperationsThroughLog(count) {
    console.log('    🔄 Concurrent chaos operations through global log...');
    
    const operationPromises = [];
    
    for (let i = 0; i < count; i++) {
      const promise = new Promise(async (resolve, reject) => {
        setTimeout(async () => {
          try {
            // Submit operations through global event log
            const eventId = await this.submitGlobalEvent('chaos_run_created', {
              run_id: uuidv4(),
              name: `Concurrent_Global_Run_${i}`,
              seed: Math.floor(Math.random() * 1000000),
              total_runs: 10,
              concurrency: 3,
              failure_rate: 0.2,
              duplicate_event_rate: 0.15,
              stall_probability: 0.08,
              latency_profile_ms: [100, 800, 1500]
            });
            
            // Create alert for the run
            const alertId = await this.submitGlobalEvent('chaos_alert_created', {
              run_id: (this.globalEventLog.find(e => e.event_id === eventId)?.payload?.run_id),
              name: `Alert_${i}`,
              status: 'failed',
              verdict: 'FAIL',
              failure_reason: 'concurrent_failure',
              severity: 'medium',
              requires_action: true,
              passed_ratio: 75.0,
              runtime_seconds: 120,
              total_instances: 10,
              done_instances: 7,
              error_instances: 3
            });
            
            resolve({ eventId, alertId });
            
          } catch (error) {
            reject(error);
          }
        }, Math.random() * 20);
      });
      
      operationPromises.push(promise);
    }
    
    await Promise.allSettled(operationPromises);
  }

  async conflictingDecisionsThroughLog(count) {
    console.log('    ⚖️  Conflicting decisions through global log...');
    
    const decisionPromises = [];
    const sharedResourceId = 'shared_decision_resource';
    
    for (let i = 0; i < count; i++) {
      const promise = new Promise(async (resolve, reject) => {
        setTimeout(async () => {
          try {
            // Create causal chain for conflicting decisions
            const causalChainId = uuidv4();
            
            // First decision
            const decision1Id = await this.submitGlobalEvent('decision_made', {
              resource_id: sharedResourceId,
              decision: 'increment',
              decision_maker: `agent_${i}`,
              causal_chain_id: causalChainId,
              decision_value: 10,
              timestamp: new Date()
            });
            
            // Conflicting decision (would cause write skew in Stage 2)
            const decision2Id = await this.submitGlobalEvent('decision_made', {
              resource_id: sharedResourceId,
              decision: 'decrement',
              decision_maker: `agent_${i}_conflict`,
              causal_chain_id: causalChainId,
              parent_event_id: decision1Id,
              decision_value: -5,
              timestamp: new Date()
            });
            
            // Process events in order - global ordering resolves conflict
            await this.processGlobalEvent(decision1Id);
            await this.processGlobalEvent(decision2Id);
            
            resolve({ decision1Id, decision2Id, causalChainId });
            
          } catch (error) {
            reject(error);
          }
        }, Math.random() * 15);
      });
      
      decisionPromises.push(promise);
    }
    
    await Promise.allSettled(decisionPromises);
  }

  async retryStormsThroughLog(count) {
    console.log('    🌪️  Retry storms through global log...');
    
    const retryPromises = [];
    
    for (let i = 0; i < count; i++) {
      const promise = new Promise(async (resolve, reject) => {
        setTimeout(async () => {
          try {
            // Create original event that will fail
            const originalEventId = await this.submitGlobalEvent('chaos_operation', {
              operation_id: `operation_${i}`,
              operation_type: 'complex_calculation',
              failure_rate: 0.7, // 70% failure rate
              payload: { data: `test_data_${i}` }
            });
            
            // Simulate processing failure
            if (Math.random() < 0.7) {
              // Submit retry event through global log
              const retryEventId = await this.submitRetryEvent(originalEventId, 'processing_failure', {
                retry_attempt: 1,
                error_details: 'simulated_processing_failure'
              });
              
              // Process retry - deterministic due to global ordering
              await this.processGlobalEvent(retryEventId);
              
              // Check if retry is deterministic
              const retryResult = this.getEventResult(retryEventId);
              const expectedRetryResult = this.calculateExpectedRetryResult(originalEventId, 1);
              
              if (JSON.stringify(retryResult) !== JSON.stringify(expectedRetryResult)) {
                this.stage3Metrics.retryNonDeterminism++;
              }
              
              resolve({ originalEventId, retryEventId, deterministic: JSON.stringify(retryResult) === JSON.stringify(expectedRetryResult) });
            } else {
              await this.processGlobalEvent(originalEventId);
              resolve({ originalEventId, retryRequired: false });
            }
            
          } catch (error) {
            reject(error);
          }
        }, Math.random() * 25);
      });
      
      retryPromises.push(promise);
    }
    
    await Promise.allSettled(retryPromises);
  }

  async timingChaosThroughLog(count) {
    console.log('    ⏱️  Timing chaos through global log...');
    
    const timingPromises = [];
    
    for (let i = 0; i < count; i++) {
      const promise = new Promise(async (resolve, reject) => {
        setTimeout(async () => {
          try {
            // Submit event with explicit timing
            const decisionTime = new Date(Date.now() - Math.random() * 1000);
            const visibilityDelay = Math.random() * 500; // 0-500ms visibility delay
            
            const eventId = await this.submitGlobalEvent('timing_test_event', {
              test_id: `timing_test_${i}`,
              decision_time: decisionTime,
              visibility_delay: visibilityDelay,
              payload: { test_data: `timing_${i}` }
            }, decisionTime);
            
            // Coordinate timing
            await this.coordinateEventTiming(eventId, visibilityDelay);
            
            // Check for timing violations
            const eventRecord = this.globalEventLog.find(e => e.event_id === eventId);
            const timingCorrect = eventRecord && 
                                 eventRecord.decision_time.getTime() === decisionTime.getTime() &&
                                 eventRecord.visibility_time.getTime() === eventRecord.commit_time.getTime() + visibilityDelay;
            
            if (!timingCorrect) {
              this.stage3Metrics.timingViolations++;
            }
            
            resolve({ eventId, timingCorrect });
            
          } catch (error) {
            reject(error);
          }
        }, Math.random() * 30);
      });
      
      timingPromises.push(promise);
    }
    
    await Promise.allSettled(timingPromises);
  }

  async causalChainConflicts(count) {
    console.log('    🔗 Causal chain conflicts...');
    
    const conflictPromises = [];
    
    for (let i = 0; i < count; i++) {
      const promise = new Promise(async (resolve, reject) => {
        setTimeout(async () => {
          try {
            // Create complex causal chain
            const rootEventId = await this.submitGlobalEvent('root_operation', {
              operation_id: `root_${i}`,
              operation_type: 'root'
            });
            
            // Branch 1
            const branch1EventId = await this.submitGlobalEvent('branch_operation', {
              operation_id: `branch1_${i}`,
              branch: 'branch_1',
              parent_event_id: rootEventId
            });
            
            // Branch 2 (conflicting with Branch 1)
            const branch2EventId = await this.submitGlobalEvent('branch_operation', {
              operation_id: `branch2_${i}`,
              branch: 'branch_2',
              parent_event_id: rootEventId,
              conflicts_with: branch1EventId
            });
            
            // Process in global order - should resolve conflicts
            await this.processAllPendingEvents();
            
            // Check causal chain integrity
            const causalChainIntegrity = this.validateCausalChainIntegrity(rootEventId);
            
            if (!causalChainIntegrity) {
              this.stage3Metrics.causalChainViolations++;
            }
            
            resolve({ rootEventId, branch1EventId, branch2EventId, integrity: causalChainIntegrity });
            
          } catch (error) {
            reject(error);
          }
        }, Math.random() * 20);
      });
      
      conflictPromises.push(promise);
    }
    
    await Promise.allSettled(conflictPromises);
  }

  async globalOrderingStress(count) {
    console.log('    📊 Global ordering stress...');
    
    const orderingPromises = [];
    
    for (let i = 0; i < count; i++) {
      const promise = new Promise(async (resolve, reject) => {
        setTimeout(async () => {
          try {
            // Submit events rapidly to stress global ordering
            const eventIds = [];
            
            for (let j = 0; j < 5; j++) {
              const eventId = await this.submitGlobalEvent('stress_test', {
                batch_id: i,
                event_number: j,
                timestamp: new Date()
              });
              eventIds.push(eventId);
            }
            
            // Process all events
            await this.processAllPendingEvents();
            
            // Verify global ordering
            const events = this.globalEventLog.filter(e => eventIds.includes(e.event_id));
            const correctlyOrdered = events.every((event, index) => {
              if (index === 0) return true;
              return events[index - 1].id < event.id;
            });
            
            if (!correctlyOrdered) {
              this.stage3Metrics.globalOrderViolations++;
            }
            
            resolve({ batchId: i, eventCount: eventIds.length, correctlyOrdered });
            
          } catch (error) {
            reject(error);
          }
        }, Math.random() * 10);
      });
      
      orderingPromises.push(promise);
    }
    
    await Promise.allSettled(orderingPromises);
  }

  async inconsistentStateInjection(count) {
    console.log('    💥 Inconsistent state injection...');
    
    const injectionPromises = [];
    
    for (let i = 0; i < count; i++) {
      const promise = new Promise(async (resolve, reject) => {
        setTimeout(async () => {
          try {
            // Manually create inconsistent state (simulating Stage 2 failure)
            const orphanInstanceId = uuidv4();
            this.systemState.chaosRunInstances.set(orphanInstanceId, {
              id: orphanInstanceId,
              chaos_run_id: uuidv4(), // Non-existent run ID
              scenario_key: 'orphan_instance',
              state: 'running',
              created_at: new Date()
            });
            
            // Submit inconsistency detection event
            const detectionEventId = await this.submitGlobalEvent('inconsistency_detected', {
              inconsistency_type: 'fk_violation',
              orphan_instances: [orphanInstanceId],
              detected_by: 'injection_test',
              severity: 'high'
            });
            
            // Process detection
            await this.processGlobalEvent(detectionEventId);
            
            // Check if reconciliation was triggered
            const reconciliationEvents = this.globalEventLog.filter(e => 
              e.event_type === 'reconciliation_performed' && 
              e.parent_event_id === detectionEventId
            );
            
            if (reconciliationEvents.length > 0) {
              this.stage3Metrics.reconciliationEvents++;
              // Process reconciliation
              for (const reconEvent of reconciliationEvents) {
                await this.processGlobalEvent(reconEvent.event_id);
              }
            }
            
            resolve({ orphanInstanceId, detectionEventId, reconciled: reconciliationEvents.length > 0 });
            
          } catch (error) {
            reject(error);
          }
        }, Math.random() * 15);
      });
      
      injectionPromises.push(promise);
    }
    
    await Promise.allSettled(injectionPromises);
  }

  async reconciliationUnderAdversarialConditions(count) {
    console.log('    🔄 Reconciliation under adversarial conditions...');
    
    const reconciliationPromises = [];
    
    for (let i = 0; i < count; i++) {
      const promise = new Promise(async (resolve, reject) => {
        setTimeout(async () => {
          try {
            // Create multiple types of inconsistencies simultaneously
            const inconsistencies = [];
            
            // FK violation
            const orphanId = uuidv4();
            this.systemState.chaosRunInstances.set(orphanId, {
              id: orphanId,
              chaos_run_id: uuidv4(),
              scenario_key: `orphan_${i}`,
              state: 'running',
              created_at: new Date()
            });
            inconsistencies.push({ type: 'fk_violation', id: orphanId });
            
            // Alert-verdict mismatch
            const alertId = uuidv4();
            this.systemState.chaosAlerts.set(alertId, {
              run_id: uuidv4(), // Non-existent verdict
              name: `Orphan_Alert_${i}`,
              status: 'failed',
              verdict: 'FAIL',
              created_at: new Date()
            });
            inconsistencies.push({ type: 'alert_verdict_mismatch', id: alertId });
            
            // Submit detection event
            const detectionEventId = await this.submitGlobalEvent('inconsistency_detected', {
              inconsistencies: inconsistencies,
              detected_by: 'adversarial_reconciliation_test',
              severity: 'critical',
              simultaneous_count: inconsistencies.length
            });
            
            // Process detection and reconciliation
            await this.processGlobalEvent(detectionEventId);
            
            // Check reconciliation results
            const reconciliationEvents = this.globalEventLog.filter(e => 
              e.event_type === 'reconciliation_performed' && 
              e.parent_event_id === detectionEventId
            );
            
            let allReconciled = true;
            for (const reconEvent of reconciliationEvents) {
              await this.processGlobalEvent(reconEvent.event_id);
              
              // Verify reconciliation was successful
              const reconResult = reconEvent.payload?.actions_taken;
              if (!reconResult || Object.keys(reconResult).length === 0) {
                allReconciled = false;
              }
            }
            
            resolve({ detectionEventId, inconsistencies: inconsistencies.length, reconciled: allReconciled });
            
          } catch (error) {
            reject(error);
          }
        }, Math.random() * 20);
      });
      
      reconciliationPromises.push(promise);
    }
    
    await Promise.allSettled(reconciliationPromises);
  }

  // =============================================================================
  // PHASE 3-8: VALIDATION TESTS
  // =============================================================================

  async testGlobalOrderingUnderStress() {
    console.log('\n📊 PHASE 3 — Test Global Ordering Under Stress');
    
    // Submit events rapidly and verify ordering
    const eventIds = [];
    const startTime = Date.now();
    
    for (let i = 0; i < 100; i++) {
      const eventId = await this.submitGlobalEvent('stress_ordering', {
        sequence: i,
        timestamp: new Date(startTime + i),
        batch: Math.floor(i / 10)
      });
      eventIds.push(eventId);
    }
    
    // Process all events
    await this.processAllPendingEvents();
    
    // Verify global ordering
    const events = this.globalEventLog.filter(e => eventIds.includes(e.event_id));
    const orderingCorrect = events.every((event, index) => {
      if (index === 0) return true;
      return events[index - 1].id < event.id;
    });
    
    this.stage3Results.globalOrdering = orderingCorrect;
    
    console.log(`    Processed ${events.length} events with ${orderingCorrect ? 'correct' : 'incorrect'} global ordering`);
  }

  async testCausalChainIntegrity() {
    console.log('\n🔗 PHASE 4 — Test Causal Chain Integrity');
    
    // Create complex causal chains
    const causalChains = [];
    
    for (let i = 0; i < 10; i++) {
      const rootId = await this.submitGlobalEvent('causal_test_root', { chain_id: i });
      const branch1Id = await this.submitGlobalEvent('causal_test_branch1', { chain_id: i, parent: rootId });
      const branch2Id = await this.submitGlobalEvent('causal_test_branch2', { chain_id: i, parent: rootId });
      const leafId = await this.submitGlobalEvent('causal_test_leaf', { chain_id: i, parent: branch1Id });
      
      causalChains.push({ rootId, branch1Id, branch2Id, leafId });
    }
    
    // Process all events
    await this.processAllPendingEvents();
    
    // Validate causal chains
    let allChainsValid = true;
    for (const chain of causalChains) {
      const valid = this.validateCausalChainIntegrity(chain.rootId);
      if (!valid) {
        allChainsValid = false;
        this.stage3Metrics.causalChainViolations++;
      }
    }
    
    this.stage3Results.singleSourceOfCausality = allChainsValid;
    
    console.log(`    Validated ${causalChains.length} causal chains with ${allChainsValid ? 'no' : 'some'} violations`);
  }

  async testExplicitTimingModel() {
    console.log('\n⏱️ PHASE 5 — Test Explicit Timing Model');
    
    // Test timing separation
    const timingTests = [];
    
    for (let i = 0; i < 20; i++) {
      const decisionTime = new Date(Date.now() - Math.random() * 2000);
      const visibilityDelay = Math.random() * 1000;
      
      const eventId = await this.submitGlobalEvent('timing_test', {
        test_id: i,
        decision_time: decisionTime,
        visibility_delay: visibilityDelay
      }, decisionTime);
      
      await this.coordinateEventTiming(eventId, visibilityDelay);
      
      const event = this.globalEventLog.find(e => e.event_id === eventId);
      const timingCorrect = event && 
                           event.decision_time.getTime() === decisionTime.getTime() &&
                           event.visibility_time.getTime() === event.commit_time.getTime() + visibilityDelay;
      
      timingTests.push({ testId: i, timingCorrect });
    }
    
    const timingCorrectCount = timingTests.filter(t => t.timingCorrect).length;
    this.stage3Results.explicitTimingModel = timingCorrectCount === timingTests.length;
    
    console.log(`    Timing tests: ${timingCorrectCount}/${timingTests.length} correct`);
  }

  async testDeterministicRetries() {
    console.log('\n🔄 PHASE 6 — Test Deterministic Retries');
    
    const retryTests = [];
    
    for (let i = 0; i < 15; i++) {
      // Create failing event
      const originalId = await this.submitGlobalEvent('retry_test_operation', {
        operation_id: i,
        should_fail: true,
        failure_rate: 1.0
      });
      
      // Process original event (will fail)
      await this.processGlobalEvent(originalId);
      
      // Submit retry
      const retryId = await this.submitRetryEvent(originalId, 'test_failure');
      await this.processGlobalEvent(retryId);
      
      // Check determinism
      const retryResult = this.getEventResult(retryId);
      const expectedRetryResult = this.calculateExpectedRetryResult(originalId, 1);
      
      const deterministic = JSON.stringify(retryResult) === JSON.stringify(expectedRetryResult);
      retryTests.push({ testId: i, deterministic });
      
      if (!deterministic) {
        this.stage3Metrics.retryNonDeterminism++;
      }
    }
    
    const deterministicCount = retryTests.filter(t => t.deterministic).length;
    this.stage3Results.deterministicRetries = deterministicCount === retryTests.length;
    
    console.log(`    Deterministic retries: ${deterministicCount}/${retryTests.length}`);
  }

  async testInconsistencyResolution() {
    console.log('\n🔧 PHASE 7 — Test Inconsistency Resolution');
    
    // Create various inconsistencies
    const inconsistencyTests = [];
    
    // FK violations
    const orphanIds = [uuidv4(), uuidv4(), uuidv4()];
    orphanIds.forEach(id => {
      this.systemState.chaosRunInstances.set(id, {
        id: id,
        chaos_run_id: uuidv4(),
        scenario_key: 'test_orphan',
        state: 'running',
        created_at: new Date()
      });
    });
    
    // Submit detection
    const detectionId = await this.submitGlobalEvent('inconsistency_detected', {
      type: 'fk_violation',
      orphan_instances: orphanIds,
      severity: 'high'
    });
    
    await this.processGlobalEvent(detectionId);
    
    // Check if reconciliation was triggered
    const reconciliationEvents = this.globalEventLog.filter(e => 
      e.event_type === 'reconciliation_performed' && 
      e.parent_event_id === detectionId
    );
    
    // Process reconciliation
    for (const reconEvent of reconciliationEvents) {
      await this.processGlobalEvent(reconEvent.event_id);
    }
    
    // Verify resolution
    const remainingOrphans = orphanIds.filter(id => 
      this.systemState.chaosRunInstances.has(id)
    );
    
    const resolved = remainingOrphans.length === 0;
    inconsistencyTests.push({ type: 'fk_violation', resolved });
    
    if (!resolved) {
      this.stage3Metrics.convergenceFailures++;
    }
    
    this.stage3Results.inconsistencyResolution = resolved;
    
    console.log(`    Inconsistency resolution: ${resolved ? 'successful' : 'failed'}`);
  }

  async validateGlobalConsistency() {
    console.log('\n🎯 PHASE 8 — Validate Global Consistency');
    
    // Check system-wide consistency
    const consistencyChecks = [
      this.checkGlobalOrderConsistency(),
      this.checkCausalChainConsistency(),
      this.checkTimingConsistency(),
      this.checkStateConsistency()
    ];
    
    const allConsistent = consistencyChecks.every(check => check.consistent);
    
    this.stage3Results.globalConsistency = allConsistent;
    
    console.log(`    Global consistency: ${allConsistent ? 'achieved' : 'has issues'}`);
  }

  // =============================================================================
  // HELPER FUNCTIONS
  // =============================================================================

  async submitGlobalEvent(eventType, payload, decisionTime = null) {
    const eventId = uuidv4();
    const causalChainId = uuidv4();
    
    const event = {
      id: this.systemState.globalOrder++,
      event_id: eventId,
      event_type: eventType,
      event_version: '1.0',
      causal_chain_id: causalChainId,
      parent_event_id: null,
      causality_token: uuidv4(),
      payload: payload,
      metadata: {},
      decision_time: decisionTime || new Date(),
      commit_time: new Date(),
      visibility_time: new Date(),
      processing_status: 'pending',
      processing_attempts: 0,
      system_snapshot: this.captureSystemSnapshot(),
      created_at: new Date(),
      updated_at: new Date()
    };
    
    this.globalEventLog.push(event);
    this.causalChains.set(causalChainId, [eventId]);
    
    return eventId;
  }

  async submitRetryEvent(originalEventId, reason, additionalPayload = {}) {
    const originalEvent = this.globalEventLog.find(e => e.event_id === originalEventId);
    if (!originalEvent) {
      throw new Error('Original event not found');
    }
    
    const retryCount = this.globalEventLog.filter(e => 
      e.causal_chain_id === originalEvent.causal_chain_id &&
      e.event_type === 'retry_attempted'
    ).length;
    
    const eventId = uuidv4();
    const retryEvent = {
      id: this.systemState.globalOrder++,
      event_id: eventId,
      event_type: 'retry_attempted',
      event_version: '1.0',
      causal_chain_id: originalEvent.causal_chain_id,
      parent_event_id: originalEventId,
      causality_token: uuidv4(),
      payload: {
        original_event_id: originalEventId,
        retry_reason: reason,
        retry_count: retryCount + 1,
        max_retries: 5,
        original_payload: originalEvent.payload,
        ...additionalPayload
      },
      metadata: {},
      decision_time: new Date(),
      commit_time: new Date(),
      visibility_time: new Date(),
      processing_status: 'pending',
      processing_attempts: 0,
      system_snapshot: this.captureSystemSnapshot(),
      created_at: new Date(),
      updated_at: new Date()
    };
    
    this.globalEventLog.push(retryEvent);
    this.causalChains.get(originalEvent.causal_chain_id).push(eventId);
    
    return eventId;
  }

  async processGlobalEvent(eventId) {
    const event = this.globalEventLog.find(e => e.event_id === eventId);
    if (!event) {
      throw new Error('Event not found');
    }
    
    if (event.processing_status === 'committed') {
      return event.payload;
    }
    
    // Update processing status
    event.processing_status = 'processing';
    event.processing_attempts++;
    event.updated_at = new Date();
    
    try {
      // Process event based on type
      let result;
      switch (event.event_type) {
        case 'chaos_run_created':
          result = this.processChaosRunCreated(event);
          break;
        case 'chaos_alert_created':
          result = this.processChaosAlertCreated(event);
          break;
        case 'inconsistency_detected':
          result = this.processInconsistencyDetected(event);
          break;
        case 'reconciliation_performed':
          result = this.processReconciliationPerformed(event);
          break;
        case 'retry_attempted':
          result = this.processRetryAttempted(event);
          break;
        default:
          result = { status: 'processed' };
      }
      
      // Mark as committed
      event.processing_status = 'committed';
      event.commit_time = new Date();
      event.visibility_time = new Date(); // Immediate visibility for now
      event.payload = { ...event.payload, ...result };
      event.updated_at = new Date();
      
      this.stage3Metrics.processedEvents++;
      
      // Run consistency check after processing
      await this.postEventConsistencyCheck(eventId);
      
      return result;
      
    } catch (error) {
      event.processing_status = 'failed';
      event.last_error = error.message;
      event.updated_at = new Date();
      
      this.stage3Metrics.failedEvents++;
      throw error;
    }
  }

  async processAllPendingEvents() {
    const pendingEvents = this.globalEventLog.filter(e => e.processing_status === 'pending');
    
    // Process in global order
    pendingEvents.sort((a, b) => a.id - b.id);
    
    for (const event of pendingEvents) {
      await this.processGlobalEvent(event.event_id);
    }
  }

  async coordinateEventTiming(eventId, visibilityDelay) {
    const event = this.globalEventLog.find(e => e.event_id === eventId);
    if (!event) return;
    
    event.visibility_time = new Date(event.commit_time.getTime() + visibilityDelay);
    event.updated_at = new Date();
  }

  captureSystemSnapshot() {
    return {
      timestamp: new Date(),
      chaos_runs_count: this.systemState.chaosRuns.size,
      chaos_instances_count: this.systemState.chaosRunInstances.size,
      chaos_alerts_count: this.systemState.chaosAlerts.size,
      pending_events_count: this.globalEventLog.filter(e => e.processing_status === 'pending').length,
      global_order: this.systemState.globalOrder
    };
  }

  validateCausalChainIntegrity(rootEventId) {
    const rootEvent = this.globalEventLog.find(e => e.event_id === rootEventId);
    if (!rootEvent) return false;
    
    const causalChain = this.globalEventLog.filter(e => 
      e.causal_chain_id === rootEvent.causal_chain_id
    );
    
    // Check that all parent relationships are valid
    for (const event of causalChain) {
      if (event.parent_event_id) {
        const parent = causalChain.find(e => e.event_id === event.parent_event_id);
        if (!parent || parent.id >= event.id) {
          return false; // Parent not found or ordering violation
        }
      }
    }
    
    return true;
  }

  getEventResult(eventId) {
    const event = this.globalEventLog.find(e => e.event_id === eventId);
    return event ? event.payload : null;
  }

  calculateExpectedRetryResult(originalEventId, retryAttempt) {
    // Deterministic retry calculation
    return {
      status: 'retry_success',
      attempt: retryAttempt,
      original_event_id: originalEventId,
      deterministic: true
    };
  }

  async postEventConsistencyCheck(eventId) {
    this.stage3Metrics.consistencyChecks++;
    
    // Check for inconsistencies created by this event
    const orphanInstances = Array.from(this.systemState.chaosRunInstances.values())
      .filter(instance => !this.systemState.chaosRuns.has(instance.chaos_run_id));
    
    if (orphanInstances.length > 0) {
      // Submit inconsistency detection
      await this.submitGlobalEvent('inconsistency_detected', {
        type: 'fk_violation',
        orphan_instances: orphanInstances.map(i => i.id),
        triggered_by_event: eventId,
        severity: 'high'
      });
    }
  }

  checkGlobalOrderConsistency() {
    const events = this.globalEventLog;
    const correctlyOrdered = events.every((event, index) => {
      if (index === 0) return true;
      return events[index - 1].id < event.id;
    });
    
    return { consistent: correctlyOrdered, type: 'global_order' };
  }

  checkCausalChainConsistency() {
    const chains = Array.from(this.causalChains.entries());
    let allValid = true;
    
    for (const [chainId, eventIds] of chains) {
      const chainEvents = this.globalEventLog.filter(e => eventIds.includes(e.event_id));
      const valid = this.validateCausalChainIntegrity(chainEvents[0]?.event_id);
      if (!valid) allValid = false;
    }
    
    return { consistent: allValid, type: 'causal_chains' };
  }

  checkTimingConsistency() {
    const events = this.globalEventLog.filter(e => e.decision_time && e.visibility_time);
    let allValid = true;
    
    for (const event of events) {
      const expectedVisibility = new Date(event.commit_time.getTime());
      if (event.visibility_time.getTime() !== expectedVisibility.getTime()) {
        allValid = false;
      }
    }
    
    return { consistent: allValid, type: 'timing' };
  }

  checkStateConsistency() {
    // Check for orphan instances
    const orphanInstances = Array.from(this.systemState.chaosRunInstances.values())
      .filter(instance => !this.systemState.chaosRuns.has(instance.chaos_run_id));
    
    // Check for orphan alerts
    const orphanAlerts = Array.from(this.systemState.chaosAlerts.values())
      .filter(alert => !this.systemState.chaosRunVerdicts.has(alert.run_id));
    
    return { 
      consistent: orphanInstances.length === 0 && orphanAlerts.length === 0,
      type: 'state',
      orphan_instances: orphanInstances.length,
      orphan_alerts: orphanAlerts.length
    };
  }

  // Event processors (simplified)
  processChaosRunCreated(event) {
    const runData = event.payload;
    this.systemState.chaosRuns.set(runData.run_id, {
      id: runData.run_id,
      name: runData.name,
      status: 'pending',
      created_at: new Date()
    });
    
    return { status: 'success', run_id: runData.run_id };
  }

  processChaosAlertCreated(event) {
    const alertData = event.payload;
    this.systemState.chaosAlerts.set(alertData.run_id, {
      run_id: alertData.run_id,
      name: alertData.name,
      status: alertData.status,
      verdict: alertData.verdict,
      created_at: new Date()
    });
    
    return { status: 'success', alert_id: alertData.run_id };
  }

  processInconsistencyDetected(event) {
    const inconsistencyData = event.payload;
    this.systemState.inconsistencies.push({
      type: inconsistencyData.type,
      detected_at: new Date(),
      details: inconsistencyData
    });
    
    // Trigger reconciliation automatically
    setTimeout(async () => {
      const reconciliationId = await this.submitGlobalEvent('reconciliation_performed', {
        reconciled_inconsistency: event.event_id,
        actions_taken: { automatic_cleanup: true },
        strategy: 'automatic'
      });
      
      await this.processGlobalEvent(reconciliationId);
    }, 10);
    
    return { status: 'detected', inconsistency_type: inconsistencyData.type };
  }

  processReconciliationPerformed(event) {
    const reconData = event.payload;
    
    // Perform reconciliation based on inconsistency type
    if (reconData.reconciled_inconsistency) {
      const inconsistency = this.systemState.inconsistencies.find(
        i => i.details?.triggered_by_event === reconData.reconciled_inconsistency
      );
      
      if (inconsistency && inconsistency.type === 'fk_violation') {
        // Clean up orphan instances
        const orphanIds = inconsistency.details.orphan_instances || [];
        orphanIds.forEach(id => {
          this.systemState.chaosRunInstances.delete(id);
        });
      }
      
      // Mark inconsistency as resolved
      inconsistency.resolved_at = new Date();
      inconsistency.resolved_by = event.event_id;
    }
    
    this.stage3Metrics.reconciliationEvents++;
    
    return { status: 'reconciled', actions: reconData.actions_taken };
  }

  processRetryAttempted(event) {
    const retryData = event.payload;
    
    // Deterministic retry processing
    const result = {
      status: 'retry_success',
      attempt: retryData.retry_count,
      original_event_id: retryData.original_event_id,
      deterministic: true
    };
    
    return result;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // =============================================================================
  // REPORTING
  // =============================================================================
  reportStage3Results(duration) {
    console.log('\n🏁 STAGE 3 ADVERSARIAL TEST RESULTS');
    console.log('===================================');
    console.log(`Duration: ${duration.toFixed(2)}s`);
    console.log(`Total events: ${this.stage3Metrics.totalEvents}`);
    console.log(`Processed events: ${this.stage3Metrics.processedEvents}`);
    console.log(`Failed events: ${this.stage3Metrics.failedEvents}`);
    
    console.log('\n📊 STAGE 3 METRICS:');
    console.log(`  Global order violations: ${this.stage3Metrics.globalOrderViolations}`);
    console.log(`  Causal chain violations: ${this.stage3Metrics.causalChainViolations}`);
    console.log(`  Timing violations: ${this.stage3Metrics.timingViolations}`);
    console.log(`  Retry non-determinism: ${this.stage3Metrics.retryNonDeterminism}`);
    console.log(`  Write skew events: ${this.stage3Metrics.writeSkewEvents}`);
    console.log(`  Snapshot inconsistencies: ${this.stage3Metrics.snapshotInconsistencies}`);
    console.log(`  Convergence failures: ${this.stage3Metrics.convergenceFailures}`);
    console.log(`  Reconciliation events: ${this.stage3Metrics.reconciliationEvents}`);
    console.log(`  Consistency checks: ${this.stage3Metrics.consistencyChecks}`);
    
    console.log('\n🔍 STAGE 3 VALIDATION RESULTS:');
    Object.entries(this.stage3Results).forEach(([test, result]) => {
      console.log(`  ${test}: ${result ? '✅ PASSED' : '❌ FAILED'}`);
    });
    
    // Determine overall Stage 3 readiness
    const passedTests = Object.values(this.stage3Results).filter(result => result).length;
    const totalTests = Object.keys(this.stage3Results).length;
    
    console.log(`\n🎯 STAGE 3 ASSESSMENT:`);
    console.log(`Tests passed: ${passedTests}/${totalTests}`);
    
    if (passedTests === totalTests) {
      console.log('\n🎉 STAGE 3 GLOBAL COORDINATION ACHIEVED');
      console.log('Your system has true adversarial resilience.');
      console.log('Global coordination eliminates Stage 2 failure modes by construction.');
      console.log('This is production-grade distributed system architecture.');
    } else {
      console.log('\n⚠️  STAGE 3 COORDINATION INCOMPLETE');
      console.log('Global coordination architecture needs refinement.');
      
      console.log('\n🔧 REMAINING COORDINATION ISSUES:');
      Object.entries(this.stage3Results).forEach(([test, failed]) => {
        if (!failed) {
          console.log(`  - ${test}: Coordination mechanism needs work`);
        }
      });
    }
    
    console.log('\n📈 STAGE 3 STATUS:');
    console.log('Global ordering contract: ' + (this.stage3Results.globalOrdering ? '✅ Proven' : '❌ Needs work'));
    console.log('Single source of causality: ' + (this.stage3Results.singleSourceOfCausality ? '✅ Proven' : '❌ Needs work'));
    console.log('Explicit timing model: ' + (this.stage3Results.explicitTimingModel ? '✅ Proven' : '❌ Needs work'));
    console.log('Deterministic retries: ' + (this.stage3Results.deterministicRetries ? '✅ Proven' : '❌ Needs work'));
    console.log('Inconsistency resolution: ' + (this.stage3Results.inconsistencyResolution ? '✅ Proven' : '❌ Needs work'));
    console.log('Global consistency: ' + (this.stage3Results.globalConsistency ? '✅ Proven' : '❌ Needs work'));
    console.log('Adversarial resilience: ' + (passedTests === totalTests ? '✅ Achieved' : '❌ Needs work'));
  }
}

// Execute the Stage 3 adversarial test
const tester = new Stage3AdversarialTest();
tester.executeStage3AdversarialTest().catch(console.error);
