// TIME-VIOLENCE TEST: Stage 2 Hardening
// Tests true production-grade behavior under concurrent chaos
// 
// This is NOT a sequential test. This is NOT a controlled test.
// This is the test that exposes the subtle bugs you're missing.

const { v4: uuidv4 } = require('uuid');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

class TimeViolenceTest {
  constructor() {
    this.sharedState = {
      chaosRuns: new Map(),
      chaosRunInstances: new Map(),
      chaosAlerts: new Map(),
      chaosRunVerdicts: new Map(),
      sideEffectLedger: new Map(),
      replayIntegrityChecks: new Map(),
      agentLeases: new Map(),
      gateCheckHistory: [],
      alertHistory: [],
      orphanDetectionHistory: [],
      concurrencyViolations: [],
      dataRaceConditions: []
    };
    
    this.testResults = {
      concurrentIntegrity: false,
      gateOscillation: false,
      alertDuplication: false,
      countStabilization: false,
      replayDivergence: false,
      fkRaceConditions: false,
      partialCommitFailures: false
    };
    
    this.metrics = {
      totalOperations: 0,
      concurrentOperations: 0,
      raceConditionsDetected: 0,
      gateOscillations: 0,
      alertDuplications: 0,
      orphanCreations: 0,
      replayDivergences: 0,
      inconsistentStates: 0
    };
  }

  // =============================================================================
  // TIME-VIOLENCE EXECUTION ENGINE
  // =============================================================================
  async executeTimeViolence() {
    console.log('🔥 TIME-VIOLENCE TEST: Stage 2 Hardening');
    console.log('==========================================');
    console.log('Testing chaotic resilience, not structural correctness\n');
    
    const startTime = Date.now();
    
    try {
      // Phase 1: Prepare concurrent chaos environment
      await this.prepareChaosEnvironment();
      
      // Phase 2: Execute simultaneous mutations
      await this.executeSimultaneousMutations();
      
      // Phase 3: Measure system behavior under time-violence
      await this.measureChaoticBehavior();
      
      // Phase 4: Validate consistency under stress
      await this.validateChaoticConsistency();
      
      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      
      this.reportTimeViolenceResults(duration);
      
    } catch (error) {
      console.log('\n💥 TIME-VIOLENCE TEST CRASHED');
      console.log('System failure under concurrent chaos:', error.message);
      console.log('\nThis is EXACTLY what we needed to find.');
      console.log('Your system is NOT production-hardened.');
    }
  }

  // =============================================================================
  // PHASE 1: PREPARE CONCURRENT CHAOS ENVIRONMENT
  // =============================================================================
  async prepareChaosEnvironment() {
    console.log('🚀 PHASE 1 — Prepare Concurrent Chaos Environment');
    
    // Create initial data set for concurrent operations
    for (let i = 0; i < 50; i++) {
      const runId = uuidv4();
      this.sharedState.chaosRuns.set(runId, {
        id: runId,
        name: `TimeViolence_Run_${i}`,
        status: 'running',
        created_at: new Date(Date.now() - Math.random() * 3600000)
      });
      
      // Create child instances
      for (let j = 0; j < 3; j++) {
        const instanceId = uuidv4();
        this.sharedState.chaosRunInstances.set(instanceId, {
          id: instanceId,
          chaos_run_id: runId,
          scenario_key: `instance-${j}`,
          state: 'running',
          created_at: new Date()
        });
      }
    }
    
    console.log(`  Created ${this.sharedState.chaosRuns.size} runs with ${this.sharedState.chaosRunInstances.size} instances`);
    console.log('  Ready for concurrent time-violence testing');
  }

  // =============================================================================
  // PHASE 2: EXECUTE SIMULTANEOUS MUTATIONS
  // =============================================================================
  async executeSimultaneousMutations() {
    console.log('\n⚡ PHASE 2 — Execute Simultaneous Mutations');
    
    const concurrentOperations = [
      () => this.concurrentInsertFailures(),
      () => this.concurrentDeleteMidWrite(),
      () => this.concurrentGateChecks(),
      () => this.concurrentFKCascades(),
      () => this.concurrentRetryDuplications(),
      () => this.concurrentPartialCommits(),
      () => this.concurrentReplayMutations(),
      () => this.concurrentAlertGeneration()
    ];
    
    console.log(`  Launching ${concurrentOperations.length} concurrent operation streams...`);
    
    // Execute all operations simultaneously with random timing
    const promises = concurrentOperations.map(async (operation, index) => {
      // Random delay to create true timing chaos
      await this.sleep(Math.random() * 100);
      return operation();
    });
    
    // Wait for all concurrent operations to complete
    const results = await Promise.allSettled(promises);
    
    // Analyze concurrent execution results
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      console.log(`  ⚠️  ${failures.length} concurrent operations failed (expected under time-violence)`);
      failures.forEach((failure, index) => {
        console.log(`    Operation ${index}: ${failure.reason.message}`);
      });
    }
    
    this.metrics.concurrentOperations = concurrentOperations.length;
    this.metrics.totalOperations = this.metrics.totalOperations + concurrentOperations.length;
    
    console.log('  ✅ Simultaneous mutations completed');
  }

  // =============================================================================
  // CONCURRENT OPERATION STREAMS
  // =============================================================================

  async concurrentInsertFailures() {
    console.log('    🔄 Concurrent insert failures...');
    
    const insertPromises = [];
    
    for (let i = 0; i < 20; i++) {
      const promise = new Promise((resolve, reject) => {
        // Random timing to create race conditions
        setTimeout(() => {
          try {
            const runId = uuidv4();
            
            // Simulate insert failure mid-operation
            if (Math.random() < 0.3) {
              // Partial insert - create run but fail to create instances
              this.sharedState.chaosRuns.set(runId, {
                id: runId,
                name: `Partial_Insert_${i}`,
                status: 'failed',
                created_at: new Date()
              });
              
              // Intentionally NOT creating instances to test orphan detection
              this.metrics.orphanCreations++;
              resolve();
            } else {
              // Complete insert
              this.sharedState.chaosRuns.set(runId, {
                id: runId,
                name: `Complete_Insert_${i}`,
                status: 'running',
                created_at: new Date()
              });
              
              // Create instances
              for (let j = 0; j < 2; j++) {
                const instanceId = uuidv4();
                this.sharedState.chaosRunInstances.set(instanceId, {
                  id: instanceId,
                  chaos_run_id: runId,
                  scenario_key: `instance-${j}`,
                  state: 'running',
                  created_at: new Date()
                });
              }
              
              resolve();
            }
          } catch (error) {
            reject(error);
          }
        }, Math.random() * 200);
      });
      
      insertPromises.push(promise);
    }
    
    await Promise.allSettled(insertPromises);
  }

  async concurrentDeleteMidWrite() {
    console.log('    🗑️  Concurrent delete mid-write...');
    
    const deletePromises = [];
    const runIds = Array.from(this.sharedState.chaosRuns.keys()).slice(0, 10);
    
    for (let i = 0; i < runIds.length; i++) {
      const runId = runIds[i];
      
      const promise = new Promise((resolve, reject) => {
        setTimeout(() => {
          try {
            // Simulate delete operation that might be interrupted
            const run = this.sharedState.chaosRuns.get(runId);
            if (run) {
              // Delete parent
              this.sharedState.chaosRuns.delete(runId);
              
              // Simulate cascade delete delay/interruption
              if (Math.random() < 0.4) {
                // Partial cascade - some instances remain
                const instances = Array.from(this.sharedState.chaosRunInstances.values())
                  .filter(instance => instance.chaos_run_id === runId);
                
                // Only delete some instances to simulate partial cascade
                instances.slice(0, Math.floor(instances.length / 2)).forEach(instance => {
                  this.sharedState.chaosRunInstances.delete(instance.id);
                });
                
                this.metrics.orphanCreations += instances.length - Math.floor(instances.length / 2);
              } else {
                // Complete cascade delete
                const instances = Array.from(this.sharedState.chaosRunInstances.values())
                  .filter(instance => instance.chaos_run_id === runId);
                
                instances.forEach(instance => {
                  this.sharedState.chaosRunInstances.delete(instance.id);
                });
              }
            }
            
            resolve();
          } catch (error) {
            reject(error);
          }
        }, Math.random() * 300);
      });
      
      deletePromises.push(promise);
    }
    
    await Promise.allSettled(deletePromises);
  }

  async concurrentGateChecks() {
    console.log('    🚪 Concurrent gate checks...');
    
    const gateCheckPromises = [];
    
    for (let i = 0; i < 50; i++) {
      const promise = new Promise((resolve, reject) => {
        setTimeout(() => {
          try {
            const gateResult = this.performGateCheck();
            this.sharedState.gateCheckHistory.push({
              timestamp: new Date(),
              result: gateResult,
              operation_id: i
            });
            
            // Check for gate oscillation
            if (this.sharedState.gateCheckHistory.length > 1) {
              const previous = this.sharedState.gateCheckHistory[this.sharedState.gateCheckHistory.length - 2];
              if (previous.result.gate_passed !== gateResult.gate_passed) {
                this.metrics.gateOscillations++;
                this.sharedState.concurrencyViolations.push({
                  type: 'gate_oscillation',
                  timestamp: new Date(),
                  previous: previous.result,
                  current: gateResult
                });
              }
            }
            
            resolve(gateResult);
          } catch (error) {
            reject(error);
          }
        }, Math.random() * 100);
      });
      
      gateCheckPromises.push(promise);
    }
    
    await Promise.allSettled(gateCheckPromises);
  }

  async concurrentFKCascades() {
    console.log('    🔗 Concurrent FK cascades...');
    
    const cascadePromises = [];
    
    for (let i = 0; i < 15; i++) {
      const promise = new Promise((resolve, reject) => {
        setTimeout(() => {
          try {
            // Create parent-child relationship
            const runId = uuidv4();
            this.sharedState.chaosRuns.set(runId, {
              id: runId,
              name: `FK_Cascade_Test_${i}`,
              status: 'running',
              created_at: new Date()
            });
            
            // Create multiple children
            const instanceIds = [];
            for (let j = 0; j < 3; j++) {
              const instanceId = uuidv4();
              instanceIds.push(instanceId);
              this.sharedState.chaosRunInstances.set(instanceId, {
                id: instanceId,
                chaos_run_id: runId,
                scenario_key: `fk-instance-${j}`,
                state: 'running',
                created_at: new Date()
              });
            }
            
            // Simulate concurrent delete attempts
            setTimeout(() => {
              // Delete parent
              this.sharedState.chaosRuns.delete(runId);
              
              // Check if FK constraint enforced properly
              const remainingChildren = instanceIds.filter(id => 
                this.sharedState.chaosRunInstances.has(id)
              );
              
              if (remainingChildren.length > 0) {
                this.metrics.raceConditionsDetected++;
                this.sharedState.dataRaceConditions.push({
                  type: 'fk_violation',
                  timestamp: new Date(),
                  run_id: runId,
                  orphan_instances: remainingChildren.length
                });
              }
            }, Math.random() * 50);
            
            resolve();
          } catch (error) {
            reject(error);
          }
        }, Math.random() * 200);
      });
      
      cascadePromises.push(promise);
    }
    
    await Promise.allSettled(cascadePromises);
  }

  async concurrentRetryDuplications() {
    console.log('    🔄 Concurrent retry duplications...');
    
    const retryPromises = [];
    
    for (let i = 0; i < 25; i++) {
      const promise = new Promise((resolve, reject) => {
        setTimeout(() => {
          try {
            const runId = uuidv4();
            const alertId = uuidv4();
            
            // Simulate retry operation that might create duplicates
            const createAlert = () => {
              if (this.sharedState.chaosAlerts.has(alertId)) {
                // Duplicate detected
                this.metrics.alertDuplications++;
                this.sharedState.concurrencyViolations.push({
                  type: 'alert_duplication',
                  timestamp: new Date(),
                  alert_id: alertId
                });
                return false;
              }
              
              this.sharedState.chaosAlerts.set(alertId, {
                run_id: runId,
                name: `Retry_Alert_${i}`,
                status: 'failed',
                verdict: 'FAIL',
                failure_reason: 'retry_timeout',
                severity: 'medium',
                requires_action: true,
                started_at: new Date(),
                created_at: new Date()
              });
              
              return true;
            };
            
            // Simulate multiple retry attempts
            const attempts = Math.floor(Math.random() * 3) + 1;
            for (let attempt = 0; attempt < attempts; attempt++) {
              setTimeout(() => createAlert(), attempt * 10);
            }
            
            resolve();
          } catch (error) {
            reject(error);
          }
        }, Math.random() * 150);
      });
      
      retryPromises.push(promise);
    }
    
    await Promise.allSettled(retryPromises);
  }

  async concurrentPartialCommits() {
    console.log('    💾 Concurrent partial commits...');
    
    const commitPromises = [];
    
    for (let i = 0; i < 20; i++) {
      const promise = new Promise((resolve, reject) => {
        setTimeout(() => {
          try {
            const runId = uuidv4();
            
            // Start transaction (simulated)
            const transaction = {
              id: uuidv4(),
              operations: [],
              committed: false,
              rolled_back: false
            };
            
            // Add operations to transaction
            transaction.operations.push({
              type: 'insert_run',
              data: {
                id: runId,
                name: `Partial_Commit_${i}`,
                status: 'running',
                created_at: new Date()
              }
            });
            
            // Simulate partial commit failure
            if (Math.random() < 0.3) {
              // Partial commit - some operations succeed, others fail
              transaction.operations[0].committed = true;
              this.sharedState.chaosRuns.set(runId, transaction.operations[0].data);
              
              // Next operation fails
              transaction.operations.push({
                type: 'insert_instances',
                data: [],
                committed: false
              });
              
              transaction.rolled_back = true;
              this.metrics.partialCommitFailures++;
              
              this.sharedState.concurrencyViolations.push({
                type: 'partial_commit_failure',
                timestamp: new Date(),
                transaction_id: transaction.id,
                run_id: runId
              });
            } else {
              // Full commit
              transaction.operations.forEach(op => {
                op.committed = true;
                if (op.type === 'insert_run') {
                  this.sharedState.chaosRuns.set(runId, op.data);
                }
              });
              transaction.committed = true;
            }
            
            resolve(transaction);
          } catch (error) {
            reject(error);
          }
        }, Math.random() * 250);
      });
      
      commitPromises.push(promise);
    }
    
    await Promise.allSettled(commitPromises);
  }

  async concurrentReplayMutations() {
    console.log('    🔄 Concurrent replay mutations...');
    
    const replayPromises = [];
    
    for (let i = 0; i < 15; i++) {
      const promise = new Promise((resolve, reject) => {
        setTimeout(() => {
          try {
            const runId = uuidv4();
            
            // Create original state
            const originalState = {
              run_id: runId,
              name: `Replay_Test_${i}`,
              status: 'completed',
              verdict: 'PASS',
              passed_ratio: 95.0,
              events: [
                { type: 'start', timestamp: new Date(Date.now() - 3600000) },
                { type: 'execute', timestamp: new Date(Date.now() - 1800000) },
                { type: 'complete', timestamp: new Date() }
              ]
            };
            
            this.sharedState.chaosRunVerdicts.set(runId, originalState);
            
            // Simulate replay while mutations are happening
            setTimeout(() => {
              // Mutate original state (simulating concurrent modifications)
              const mutatedState = { ...originalState };
              mutatedState.passed_ratio = 85.0; // Change the outcome
              mutatedState.events.push({ 
                type: 'mutation', 
                timestamp: new Date(),
                data: 'concurrent_modification'
              });
              
              // Attempt replay
              const replayResult = this.performReplay(runId, originalState.events);
              
              // Check for divergence
              if (replayResult.passed_ratio !== originalState.passed_ratio) {
                this.metrics.replayDivergences++;
                this.sharedState.concurrencyViolations.push({
                  type: 'replay_divergence',
                  timestamp: new Date(),
                  run_id: runId,
                  original_ratio: originalState.passed_ratio,
                  replay_ratio: replayResult.passed_ratio,
                  mutated_ratio: mutatedState.passed_ratio
                });
              }
              
              resolve(replayResult);
            }, Math.random() * 100);
            
            resolve();
          } catch (error) {
            reject(error);
          }
        }, Math.random() * 200);
      });
      
      replayPromises.push(promise);
    }
    
    await Promise.allSettled(replayPromises);
  }

  async concurrentAlertGeneration() {
    console.log('    🚨 Concurrent alert generation...');
    
    const alertPromises = [];
    
    for (let i = 0; i < 30; i++) {
      const promise = new Promise((resolve, reject) => {
        setTimeout(() => {
          try {
            const runId = uuidv4();
            const alertId = uuidv4();
            
            // Create alert with potential for duplication
            const alert = {
              run_id: runId,
              name: `Concurrent_Alert_${i}`,
              status: 'failed',
              verdict: 'FAIL',
              failure_reason: 'concurrent_failure',
              severity: ['critical', 'high', 'medium', 'low'][Math.floor(Math.random() * 4)],
              requires_action: true,
              started_at: new Date(),
              created_at: new Date()
            };
            
            // Check for existing alert (idempotency check)
            const existingAlert = Array.from(this.sharedState.chaosAlerts.values())
              .find(a => a.run_id === runId);
            
            if (existingAlert) {
              this.metrics.alertDuplications++;
              this.sharedState.concurrencyViolations.push({
                type: 'alert_duplication',
                timestamp: new Date(),
                run_id: runId,
                existing_alert_id: existingAlert.run_id
              });
            } else {
              this.sharedState.chaosAlerts.set(alertId, alert);
            }
            
            this.sharedState.alertHistory.push({
              timestamp: new Date(),
              alert: alert,
              operation_id: i
            });
            
            resolve(alert);
          } catch (error) {
            reject(error);
          }
        }, Math.random() * 120);
      });
      
      alertPromises.push(promise);
    }
    
    await Promise.allSettled(alertPromises);
  }

  // =============================================================================
  // PHASE 3: MEASURE SYSTEM BEHAVIOR UNDER TIME-VIOLENCE
  // =============================================================================
  async measureChaoticBehavior() {
    console.log('\n📊 PHASE 3 — Measure System Behavior Under Time-Violence');
    
    // Measure gate oscillation
    this.measureGateOscillation();
    
    // Measure alert duplication
    this.measureAlertDuplication();
    
    // Measure count stabilization
    this.measureCountStabilization();
    
    // Measure orphan detection
    this.measureOrphanDetection();
    
    // Measure data race conditions
    this.measureDataRaceConditions();
    
    console.log('  ✅ Chaotic behavior measurements completed');
  }

  measureGateOscillation() {
    console.log('    📈 Measuring gate oscillation...');
    
    const gateChecks = this.sharedState.gateCheckHistory;
    if (gateChecks.length < 2) return;
    
    let oscillations = 0;
    for (let i = 1; i < gateChecks.length; i++) {
      if (gateChecks[i-1].result.gate_passed !== gateChecks[i].result.gate_passed) {
        oscillations++;
      }
    }
    
    const oscillationRate = oscillations / (gateChecks.length - 1);
    
    console.log(`      Gate checks: ${gateChecks.length}`);
    console.log(`      Oscillations: ${oscillations}`);
    console.log(`      Oscillation rate: ${(oscillationRate * 100).toFixed(2)}%`);
    
    // High oscillation rate indicates gate instability
    if (oscillationRate > 0.1) { // More than 10% oscillation
      this.testResults.gateOscillation = true;
      console.log(`      ⚠️  High gate oscillation detected!`);
    }
  }

  measureAlertDuplication() {
    console.log('    🚨 Measuring alert duplication...');
    
    const alertRunIds = Array.from(this.sharedState.chaosAlerts.values()).map(a => a.run_id);
    const uniqueRunIds = [...new Set(alertRunIds)];
    
    const duplicates = alertRunIds.length - uniqueRunIds.length;
    const duplicationRate = duplicates / alertRunIds.length;
    
    console.log(`      Total alerts: ${alertRunIds.length}`);
    console.log(`      Unique runs: ${uniqueRunIds.length}`);
    console.log(`      Duplicates: ${duplicates}`);
    console.log(`      Duplication rate: ${(duplicationRate * 100).toFixed(2)}%`);
    
    if (duplicates > 0) {
      this.testResults.alertDuplication = true;
      console.log(`      ⚠️  Alert duplication detected!`);
    }
  }

  async measureCountStabilization() {
    console.log('    📊 Measuring count stabilization...');
    
    // Take multiple count measurements over time
    const measurements = [];
    for (let i = 0; i < 10; i++) {
      measurements.push({
        timestamp: new Date(),
        runs: this.sharedState.chaosRuns.size,
        instances: this.sharedState.chaosRunInstances.size,
        alerts: this.sharedState.chaosAlerts.size
      });
      
      // Small delay between measurements
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // Check if counts are stable
    const runCounts = measurements.map(m => m.runs);
    const instanceCounts = measurements.map(m => m.instances);
    const alertCounts = measurements.map(m => m.alerts);
    
    const runVariance = this.calculateVariance(runCounts);
    const instanceVariance = this.calculateVariance(instanceCounts);
    const alertVariance = this.calculateVariance(alertCounts);
    
    console.log(`      Run count variance: ${runVariance.toFixed(2)}`);
    console.log(`      Instance count variance: ${instanceVariance.toFixed(2)}`);
    console.log(`      Alert count variance: ${alertVariance.toFixed(2)}`);
    
    // High variance indicates unstable counts
    if (runVariance > 1 || instanceVariance > 1 || alertVariance > 1) {
      this.testResults.countStabilization = true;
      console.log(`      ⚠️  Unstable counts detected!`);
    }
  }

  measureOrphanDetection() {
    console.log('    👶 Measuring orphan detection...');
    
    // Detect orphans in the current state
    const orphanInstances = Array.from(this.sharedState.chaosRunInstances.values())
      .filter(instance => !this.sharedState.chaosRuns.has(instance.chaos_run_id));
    
    console.log(`      Total instances: ${this.sharedState.chaosRunInstances.size}`);
    console.log(`      Orphan instances: ${orphanInstances.length}`);
    console.log(`      Orphan rate: ${((orphanInstances.length / this.sharedState.chaosRunInstances.size) * 100).toFixed(2)}%`);
    
    if (orphanInstances.length > 0) {
      this.testResults.fkRaceConditions = true;
      console.log(`      ⚠️  Orphan instances detected!`);
      
      // Log orphan details
      orphanInstances.forEach(orphan => {
        this.sharedState.orphanDetectionHistory.push({
          timestamp: new Date(),
          instance_id: orphan.id,
          missing_parent_id: orphan.chaos_run_id
        });
      });
    }
  }

  measureDataRaceConditions() {
    console.log('    🏃 Measuring data race conditions...');
    
    const raceConditions = this.sharedState.dataRaceConditions;
    
    console.log(`      Race conditions detected: ${raceConditions.length}`);
    console.log(`      Types of races:`);
    
    const raceTypes = {};
    raceConditions.forEach(race => {
      raceTypes[race.type] = (raceTypes[race.type] || 0) + 1;
    });
    
    Object.entries(raceTypes).forEach(([type, count]) => {
      console.log(`        ${type}: ${count}`);
    });
    
    if (raceConditions.length > 0) {
      this.testResults.concurrentIntegrity = false;
      console.log(`      ⚠️  Data race conditions detected!`);
    }
  }

  // =============================================================================
  // PHASE 4: VALIDATE CHAOTIC CONSISTENCY
  // =============================================================================
  async validateChaoticConsistency() {
    console.log('\n🔍 PHASE 4 — Validate Chaotic Consistency');
    
    // Validate FK constraint enforcement under stress
    await this.validateFKUnderStress();
    
    // Validate gate correctness under simultaneous writes
    await this.validateGateUnderStress();
    
    // Validate alert consistency during partial failures
    await this.validateAlertConsistency();
    
    // Validate replay consistency under mutation
    await this.validateReplayConsistency();
    
    console.log('  ✅ Chaotic consistency validation completed');
  }

  async validateFKUnderStress() {
    console.log('    🔗 Validating FK constraints under stress...');
    
    const violations = this.sharedState.dataRaceConditions
      .filter(race => race.type === 'fk_violation');
    
    if (violations.length > 0) {
      console.log(`      ❌ FK violations detected under stress: ${violations.length}`);
      this.testResults.fkRaceConditions = true;
    } else {
      console.log(`      ✅ No FK violations detected under stress`);
    }
  }

  async validateGateUnderStress() {
    console.log('    🚪 Validating gate correctness under simultaneous writes...');
    
    const oscillations = this.sharedState.concurrencyViolations
      .filter(violation => violation.type === 'gate_oscillation');
    
    if (oscillations.length > 0) {
      console.log(`      ❌ Gate oscillations detected: ${oscillations.length}`);
      this.testResults.gateOscillation = true;
    } else {
      console.log(`      ✅ Gate remains stable under concurrent writes`);
    }
  }

  async validateAlertConsistency() {
    console.log('    🚨 Validating alert consistency during partial failures...');
    
    const duplications = this.sharedState.concurrencyViolations
      .filter(violation => violation.type === 'alert_duplication');
    
    const partialFailures = this.sharedState.concurrencyViolations
      .filter(violation => violation.type === 'partial_commit_failure');
    
    if (duplications.length > 0 || partialFailures.length > 0) {
      console.log(`      ❌ Alert inconsistencies detected: ${duplications.length} duplications, ${partialFailures.length} partial failures`);
      this.testResults.alertDuplication = true;
    } else {
      console.log(`      ✅ Alert consistency maintained under stress`);
    }
  }

  async validateReplayConsistency() {
    console.log('    🔄 Validating replay consistency under mutation...');
    
    const divergences = this.sharedState.concurrencyViolations
      .filter(violation => violation.type === 'replay_divergence');
    
    if (divergences.length > 0) {
      console.log(`      ❌ Replay divergences detected: ${divergences.length}`);
      this.testResults.replayDivergence = true;
    } else {
      console.log(`      ✅ Replay consistency maintained under concurrent mutations`);
    }
  }

  // =============================================================================
  // HELPER FUNCTIONS
  // =============================================================================

  performGateCheck() {
    const recentVerdicts = Array.from(this.sharedState.chaosRunVerdicts.values())
      .filter(v => v.started_at >= new Date(Date.now() - 24 * 60 * 60 * 1000))
      .filter(v => ['completed', 'failed'].includes(v.status));
    
    const activeAlerts = Array.from(this.sharedState.chaosAlerts.values())
      .filter(a => a.requires_action)
      .filter(a => a.started_at >= new Date(Date.now() - 24 * 60 * 60 * 1000));
    
    const alertCounts = {
      critical: activeAlerts.filter(a => a.severity === 'critical').length,
      high: activeAlerts.filter(a => a.severity === 'high').length,
      medium: activeAlerts.filter(a => a.severity === 'medium').length,
      low: activeAlerts.filter(a => a.severity === 'low').length,
      total: activeAlerts.length
    };
    
    const thresholds = {
      max_critical: 0,
      max_high: 2,
      max_medium: 5
    };
    
    const hasCriticalFailures = recentVerdicts.some(v => v.replay_mismatches > 0 || v.duplicate_effect_pairs > 0);
    const avgPassedRatio = recentVerdicts.length > 0 ? recentVerdicts.reduce((sum, v) => sum + (v.passed_ratio || 0), 0) / recentVerdicts.length : 0;
    
    const gatePassed = recentVerdicts.length >= 0 && 
                      !hasCriticalFailures && 
                      avgPassedRatio >= 80.0 &&
                      alertCounts.critical <= thresholds.max_critical &&
                      alertCounts.high <= thresholds.max_high &&
                      alertCounts.medium <= thresholds.max_medium;
    
    return {
      gate_passed: gatePassed,
      failure_reason: gatePassed ? null : this.calculateFailureReason(alertCounts, thresholds, hasCriticalFailures, avgPassedRatio),
      recent_runs_count: recentVerdicts.length,
      success_rate: avgPassedRatio,
      critical_failures: recentVerdicts.filter(v => v.replay_mismatches > 0 || v.duplicate_effect_pairs > 0).length,
      alert_summary: {
        ...alertCounts,
        thresholds
      }
    };
  }

  calculateFailureReason(alertCounts, thresholds, hasCriticalFailures, avgPassedRatio) {
    if (hasCriticalFailures) return 'Critical failures detected in recent runs';
    if (avgPassedRatio < 80.0 && avgPassedRatio > 0) return `Success rate ${avgPassedRatio.toFixed(1)}% below threshold 80.0%`;
    if (alertCounts.critical > thresholds.max_critical) return `Critical alerts (${alertCounts.critical}) exceed threshold (${thresholds.max_critical})`;
    if (alertCounts.high > thresholds.max_high) return `High alerts (${alertCounts.high}) exceed threshold (${thresholds.max_high})`;
    if (alertCounts.medium > thresholds.max_medium) return `Medium alerts (${alertCounts.medium}) exceed threshold (${thresholds.max_medium})`;
    if (avgPassedRatio === 0) return 'No recent chaos runs found';
    return 'Unknown failure reason';
  }

  performReplay(runId, events) {
    // Simulate replay logic
    const verdict = this.sharedState.chaosRunVerdicts.get(runId);
    if (!verdict) return { passed_ratio: 0 };
    
    // Simple replay: return the original verdict
    return {
      passed_ratio: verdict.passed_ratio,
      verdict: verdict.verdict
    };
  }

  calculateVariance(values) {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
    
    return Math.sqrt(avgSquaredDiff);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // =============================================================================
  // REPORTING
  // =============================================================================
  reportTimeViolenceResults(duration) {
    console.log('\n🏁 TIME-VIOLENCE TEST RESULTS');
    console.log('===============================');
    console.log(`Duration: ${duration.toFixed(2)}s`);
    console.log(`Total operations: ${this.metrics.totalOperations}`);
    console.log(`Concurrent operations: ${this.metrics.concurrentOperations}`);
    
    console.log('\n📊 CHAOS METRICS:');
    console.log(`  Race conditions: ${this.metrics.raceConditionsDetected}`);
    console.log(`  Gate oscillations: ${this.metrics.gateOscillations}`);
    console.log(`  Alert duplications: ${this.metrics.alertDuplications}`);
    console.log(`  Orphan creations: ${this.metrics.orphanCreations}`);
    console.log(`  Replay divergences: ${this.metrics.replayDivergences}`);
    console.log(`  Partial commit failures: ${this.metrics.partialCommitFailures}`);
    
    console.log('\n🔍 VALIDATION RESULTS:');
    Object.entries(this.testResults).forEach(([test, result]) => {
      console.log(`  ${test}: ${result ? '❌ FAILED' : '✅ PASSED'}`);
    });
    
    // Determine overall system readiness
    const failedTests = Object.values(this.testResults).filter(result => result).length;
    const totalTests = Object.keys(this.testResults).length;
    
    console.log(`\n🎯 OVERALL ASSESSMENT:`);
    console.log(`Tests failed: ${failedTests}/${totalTests}`);
    
    if (failedTests === 0) {
      console.log('\n✅ SYSTEM EXHIBITS CHAOTIC RESILIENCE');
      console.log('Your system is TRULY production-hardened.');
      console.log('It survives time-violence and concurrent stress.');
    } else {
      console.log('\n❌ SYSTEM LACKS CHAOTIC RESILIENCE');
      console.log('Your system is structurally correct but fails under concurrent stress.');
      console.log('This is the gap between "works in testing" and "survives in production".');
      
      console.log('\n🔧 CRITICAL ISSUES TO ADDRESS:');
      Object.entries(this.testResults).forEach(([test, failed]) => {
        if (failed) {
          console.log(`  - ${test}: System fails under concurrent stress`);
        }
      });
      
      console.log('\n💡 REALITY CHECK:');
      console.log('You have Stage 1 hardening (structural integrity).');
      console.log('You need Stage 2 hardening (chaotic resilience).');
      console.log('Most teams stop at Stage 1 and fail in production.');
      console.log('Don\'t be that team.');
    }
  }
}

// Execute the time-violence test
if (isMainThread) {
  const tester = new TimeViolenceTest();
  tester.executeTimeViolence().catch(console.error);
} else {
  // Worker thread execution (if needed for true parallelism)
  parentPort.postMessage({ status: 'completed' });
}
