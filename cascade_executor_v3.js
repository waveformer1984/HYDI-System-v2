// CASCADE PROMPT v3.0 - Global Causal Executor
// Enforces single, replayable causal spine of truth
// Version: 3.0.0

const { v4: uuidv4 } = require('uuid');

class CascadePromptV3 {
  constructor() {
    this.eventSpine = [];
    this.causalChains = new Map();
    this.systemState = {
      chaosRuns: new Map(),
      chaosRunInstances: new Map(),
      chaosAlerts: new Map(),
      chaosRunVerdicts: new Map(),
      globalOrder: 0,
      lastProcessedEvent: null,
      consistencyChecks: [],
      violations: []
    };
    
    this.executionMetrics = {
      totalEvents: 0,
      processedEvents: 0,
      failedEvents: 0,
      causalViolations: 0,
      cascadeIntegrityFailures: 0,
      replayInconsistencies: 0,
      determinismViolations: 0,
      sideEffectViolations: 0,
      externalNormalizationFailures: 0
    };
    
    this.stage3Results = {
      globalOrdering: false,
      causalIntegrity: false,
      deterministicRetries: false,
      externalNormalization: false,
      consistencyVerification: false,
      adversarialResilience: false
    };
    
    this.executionMode = 'ENFORCING_CAUSAL_LEGIBILITY';
  }

  // =============================================================================
  // 1. CAUSAL EVENT SUBMISSION
  // =============================================================================
  async submitCausalEvent(eventType, agent, payload, metadata = {}, causalParentId = null, decisionTime = null) {
    const eventId = v4();
    const logicalClock = this.globalOrder++;
    
    const determinismKey = this.generateDeterminismKey(payload, metadata, agent, logicalClock);
    
    const systemSnapshot = this.captureSystemSnapshot(decisionTime);
    
    const event = {
      id: this.globalOrder++,
      event_id: eventId,
      event_timestamp: decisionTime || new Date(),
      logical_clock: logicalClock,
      causal_parent_id: causalParentId,
      causality_chain_id: causalParentId ? this.causalChains.get(causalParentId)?.[0] : v4(),
      event_type: eventType,
      agent: agent,
      payload: payload,
      metadata: metadata,
      determinism_key: determinismKey,
      side_effects: [],
      processing_status: 'pending',
      processing_started_at: null,
      processing_completed_at: null,
      processing_attempts: 0,
      processing_error: null,
      system_snapshot: systemSnapshot,
      decision_time: decisionTime || new Date(),
      commit_time: null,
      visibility_time: null,
      replay_hash: null,
      has_been_replayed: false,
      replay_verified_at: null,
      created_at: new Date(),
      updated_at: new Date()
    };
    
    this.eventSpine.push(event);
    
    if (causalParentId) {
      this.causalChains.get(causalParentId).push(eventId);
    } else {
      this.causalChains.set(event.causality_chain_id, [eventId]);
    }
    
    this.executionMetrics.totalEvents++;
    return eventId;
  }

  // =============================================================================
  // 2. EXTERNAL EVENT NORMALIZATION
  // =============================================================================
  async normalizeExternalEvent(externalSource, externalEventType, externalData, agent = 'SYSTEM', metadata = {}) {
    // Normalize external data into causal event format
    const normalizedPayload = {
      external_source: externalSource,
      external_type: externalEventType,
      original_data: externalData,
      normalized_at: new Date()
    };
    
    const determinismKey = this.generateDeterminismKey(normalizedPayload, metadata, agent, this.globalOrder);
    const decisionTime = new Date();
    
    return this.submitCausalEvent('EXTERNAL', agent, normalizedPayload, metadata, null, decisionTime);
  }

  // =============================================================================
  // 3. DERIVED EVENT GENERATION
  // =============================================================================
  async generateDerivedEvent(derivationType, parentEventId, derivedPayload, agent = 'SYSTEM', metadata = {}) {
    const parentEvent = this.eventSpine.find(e => e.event_id === parentEventId);
    
    if (!parentEvent) {
      throw new Error(`Parent event not found: ${parentEventId}`);
    }
    
    const determinismKey = this.generateDeterminismKey(derivedPayload, metadata, agent, parentEvent.logical_clock);
    
    const derivedPayload = {
      derivation_type: derivationType,
      parent_event_id: parentEventId,
      derived_at: new Date(),
      parent_payload: parentEvent.payload,
      ...derivedPayload
    };
    
    const eventId = v4();
    const logicalClock = this.globalOrder++;
    
    const systemSnapshot = parentEvent.system_snapshot;
    
    const event = {
      id: this.globalOrder++,
      event_id: eventId,
      event_timestamp: parentEvent.event_timestamp,
      logical_clock: logicalClock,
      causal_parent_id: parentEventId,
      causality_chain_id: parentEvent.causality_chain_id,
      event_type: 'DERIVED',
      agent: agent,
      payload: derivedPayload,
      metadata: metadata,
      determinism_key: determinismKey,
      side_effects: [], // Derived events have no side effects
      processing_status: 'pending',
      processing_started_at: null,
      processing_completed_at: null,
      processing_attempts: 0,
      processing_error: null,
      system_snapshot: systemSnapshot,
      decision_time: parentEvent.decision_time,
      commit_time: new Date(),
      visibility_time: new Date(),
      replay_hash: null,
      has_been_replayed: false,
      replay_verified_at: null,
      created_at: new Date(),
      updated_at: new Date()
    };
    
    this.eventSpine.push(event);
    this.causalChains.get(event.causality_chain_id).push(eventId);
    
    this.executionMetrics.totalEvents++;
    return eventId;
  }

  // =============================================================================
  // 4. CAUSAL EVENT PROCESSOR WITH STRICT ENFORCEMENT
  // =============================================================================
  async processCausalEvent(eventId, processorId = 'cascade_executor') {
    const event = this.eventSpine.find(e => e.event_id === eventId);
    if (!event) {
      throw new Error(`Event not found: ${eventId}`);
    }
    
    // Check if already processed
    if (event.processing_status === 'committed') {
      return {
        success: true,
        processed_at: event.processing_completed_at,
        error_message: null,
        side_effects: event.side_effects,
        determinism_violation: false,
        cascade_integrity_failure: false,
        replay_hash: event.replay_hash
      };
    }
    
    // Update processing status
    event.processing_status = 'processing';
    event.processing_started_at = new Date();
    event.processing_attempts++;
    event.updated_at = new Date();
    
    try {
      // Get parent determinism key for derived events
      const parentDeterminismKey = event.causal_parent_id ? 
        this.eventSpine.find(e => e.event_id === event.causal_parent_id)?.determinism_key : null;
      
      // Capture current system snapshot
      const currentSnapshot = this.captureSystemSnapshot(event.decision_time);
      
      // Process event based on type
      let processingResult;
      switch (event.event_type) {
        case 'CAUSAL':
          processingResult = this.processCausalEventInternal(event);
          break;
        case 'DERIVED':
          processingResult = this.processDerivedEventInternal(event);
          break;
        case 'EXTERNAL':
          processingResult = this.processExternalEventInternal(event);
          break;
        default:
          processingResult = {
            status: 'unknown_event_type',
            event_type: event.event_type,
            payload: event.payload
          };
      }
      
      // Calculate replay hash for verification
      const replayHash = this.calculateReplayHash(
        processingResult || event.payload,
        event.side_effects,
        currentSnapshot,
        event.determinism_key,
        event.logical_clock
      );
      
      // Update event as committed
      event.processing_status = 'committed';
      event.processing_completed_at = new Date();
      event.commit_time = new Date();
      event.visibility_time = new Date(); // Immediate visibility for now
      event.replay_hash = replayHash;
      event.has_been_replayed = false;
      event.replay_verified_at = new Date();
      event.updated_at = new Date();
      
      // Update payload with processing result
      event.payload = { ...event.payload, ...processingResult };
      
      // Check for determinism violations
      const parentDeterminismKey = event.causal_parent_id ? 
        this.eventSpine.find(e => e.event_id === event.causal_parent_id)?.determinism_key : null;
      
      if (event.event_type === 'DERIVED' && parentDeterminismKey) {
        const currentSnapshot = this.captureSystemSnapshot(event.decision_time);
        const expectedSnapshot = event.system_snapshot;
        
        if (JSON.stringify(currentSnapshot) !== JSON.stringify(expectedSnapshot)) {
          event.causality_violation = true;
          this.executionMetrics.determinismViolations++;
        }
      }
      
      // Check for cascade integrity failures
      if (event.event_type === 'CAUSAL' && event.side_effects.length > 0) {
        // Check if side effects are properly tracked
        const sideEffectIds = event.side_effects.map(se => se.id);
        const orphanedSideEffects = sideEffectIds.filter(id => 
          !this.systemState.sideEffectLedger.has(id));
        
        if (orphanedSideEffects.length > 0) {
          event.cascade_integrity_failure = true;
          this.executionMetrics.cascadeIntegrity_failures++;
        }
      }
      
      return {
        success: true,
        processed_at: event.processing_completed_at,
        error_message: null,
        side_effects: event.side_effects,
        determinism_violation: event.causality_violation,
        cascade_integrity_failure: event.cascade_integrity_failure,
        replay_hash: replayHash
      };
      
    } catch (error) {
      // Mark as failed
      event.processing_status = 'failed';
      event.processing_completed_at = new Date();
      event.last_error = error.message;
      event.updated_at = new Date();
      
      // Check for causality violation
      if (event.event_type === 'CAUSAL') {
        event.causality_violation = true;
        this.executionMetrics.causalViolations++;
      }
      
      return {
        success: false,
        processed_at: event.processing_completed_at,
        error_message: error.message,
        side_effects: event.side_effects,
        determinism_violation: true,
        cascade_integrity_failure: event.causality_violation,
        replay_hash: null
      };
    }
  }

  // =============================================================================
  // 5. RETRY AS FIRST-CLASS CAUSAL EVENTS
  // =============================================================================
  async submitRetryEvent(parentEventId, retryReason, retryPayload = {}, maxRetries = 5) {
    const parentEvent = this.eventSpine.find(e => e.event_id === parentEventId);
    if (!parentEvent) {
      throw new Error(`Parent event not found for retry: ${parentEventId}`);
    }
    
    // Check retry limit
    const retryCount = this.eventSpine.filter(e => 
      e.causal_chain_id === parentEvent.causality_chain_id && 
      e.event_type === 'retry_attempted'
    ).length;
    
    if (retryCount >= maxRetries) {
      throw new Error(`Maximum retries exceeded for event: ${parentEventId}`);
    }
    
    // Capture failure snapshot
    const failureSnapshot = jsonb_build_object(
      'parent_event_id', parentEventId,
      'parent_payload', parentEvent.payload,
      'processing_error', parentEvent.last_error,
      'retry_count', retryCount,
      'max_retries', maxRetries
    );
    
    // Get current system snapshot
    const systemSnapshot = this.captureSystemSnapshot(parentEvent.decision_time);
    
    // Generate determinism key for retry
    const determinismKey = this.generateDeterminismKey(
      retryPayload || {},
      { retry_reason, retry_count, max_retries },
      'RETRY_COORDINATOR',
      parentEvent.determinism_key,
      systemSnapshot
    );
    
    const logicalClock = this.globalOrder++;
    
    // Submit retry as causal event
    const retryEventId = v4();
    
    const retryEvent = {
      id: this.globalOrder++,
      event_id: retryEventId,
      event_timestamp: parentEvent.event_timestamp,
      logical_clock: logicalClock,
      causal_parent_id: parentEventId,
      causality_chain_id: parentEvent.causality_chain_id,
      event_type: 'CAUSAL',
      agent: 'RETRY_COORDINATOR',
      payload: {
        original_event_id: parentEventId,
        retry_reason: retryReason,
        retry_count: retryCount + 1,
        max_retries: maxRetries,
        original_payload: parentEvent.payload,
        failure_snapshot: failureSnapshot,
        retry_payload: retryPayload
      },
      metadata: {
        retry_of: parentEventId,
        processor: 'retry_coordinator'
      },
      determinism_key: determinismKey,
      side_effects: [], // Retries have no direct side effects
      processing_status: 'pending',
      decision_time: parentEvent.decision_time,
      system_snapshot: systemSnapshot,
      created_at: new Date(),
      updated_at: new Date()
    };
    
    this.eventSpine.push(retryEvent);
    this.causalChains.get(parentEvent.causality_chain_id).push(retryEventId);
    
    this.executionMetrics.totalEvents++;
    return retryEventId;
  }

  // =============================================================================
  // 6. CONSISTENCY VERIFICATION AFTER EACH EVENT
  // =============================================================================
  async verifyCausalConsistency(eventId) {
    const event = this.eventSpine.find(e => e.event_id === eventId);
    if (!event) {
      return {
        is_consistent: false,
        violation_type: 'event_not_found',
        description: 'Event not found in spine',
        detected_at: new Date(),
        affected_event_ids: []
      };
    }
    
    const violations = [];
    
    // Check for hidden side effects by comparing snapshots
    if (event.system_snapshot) {
      const currentSnapshot = this.captureSystemSnapshot(event.decision_time);
      
      if (JSON.stringify(currentSnapshot) !== JSON.stringify(event.system_snapshot)) {
        violations.push({
          type: 'unexpected_state_change',
          before: event.system_snapshot,
          after: currentSnapshot
        });
        
        // Find events that might have caused this
        const affectedEvents = this.eventSpine.filter(e => 
          e.logical_clock >= event.logical_clock - 10 && 
          e.logical_clock <= event.logical_clock + 10
        );
        
        return {
          is_consistent: false,
          violation_type: 'unexpected_state_change',
          description: 'Unexpected state change detected',
          detected_at: new Date(),
          affected_event_ids: affectedEvents.map(e => e.event_id)
        };
      }
    }
    
    // Check for causality violations
    if (event.causality_violation) {
      violations.push({
        type: 'causality_violation',
        event_id: event.event_id,
        parent_determinism_key: event.parent_determinism_key
      });
      
      const affectedEvents = this.eventSpine.filter(e => 
        e.causal_chain_id === event.causality_chain_id &&
        e.logical_clock >= event.logical_clock - 5 &&
        e.logical_clock <= event.logical_clock + 5
      );
      
      return {
        is_consistent: false,
        violation_type: 'causality_violation',
        description: 'Causality violation detected',
        detected_at: new Date(),
        affected_event_ids: affectedEvents.map(e => e.event_id)
      };
    }
    
    // Check for cascade integrity failures
    if (event.cascade_integrity_failure) {
      violations.push({
        type: 'cascade_integrity_failure',
        event_id: event.event_id
      });
      
      const affectedEvents = this.eventSpine.filter(e => 
        e.causal_chain_id === event.causal_chain_id &&
        e.logical_clock >= event.logical_clock - 3 &&
        e.logical_clock <= event.logical_clock + 3
      );
      
      return {
        is_consistent: false,
        violation_type: 'cascade_integrity_failure',
        description: 'Cascade integrity failure detected',
        detected_at: new Date(),
        affected_event_ids: affectedEvents.map(e => e.event_id)
      };
    }
    
    // All checks passed
    return {
      is_consistent: violations.length === 0,
      violation_type: 'no_violations',
      description: 'No violations detected',
      detected_at: new Date(),
      affected_event_ids: []
    };
  }

  // =============================================================================
  // 7. REPLAY VERIFICATION
  // =============================================================================
  async verifyReplayConsistency(fromEventId = null, toEventId = null) {
    const fromId = fromId || (SELECT MIN(id) FROM public.global_causal_spine WHERE processing_status = 'committed');
    const toId = toId || (SELECT MAX(id) FROM public.global_causal_spine WHERE processing_status = 'committed');
    
    const eventsChecked = await this.verifyReplayConsistency(fromId, toId);
    
    return eventsChecked;
  }

  // =============================================================================
  // 8. GLOBAL STATE QUERIES
  // =============================================================================
  getGlobalStateFromSpine() {
    const latestEvent = this.eventSpine.reduce((latest, current) => 
      latest.id > current.id ? latest : current
    );
    
    const lastConsistencyCheck = this.eventSpine
      .filter(e => e.event_type === 'consistency_check')
      .sort((a, b) => b.id > a.id)
      .slice(-1)[0]?.created_at;
    
    const systemState = {
      timestamp: latestEvent.event_timestamp,
      chaos_runs_count: this.systemState.chaosRuns.size,
      chaos_alerts_count: this.systemState.chaosAlerts.size,
      active_chaos_runs: Array.from(this.systemState.chaosRuns.values()).filter(run => run.status === 'running').length,
      pending_events: this.eventSpine.filter(e => e.processing_status === 'pending').length,
      logical_clock: latestEvent.logical_clock
    };
    
    return {
      total_events: this.eventSpine.length,
      pending_events: this.eventSpine.filter(e => e.processing_status === 'pending').length,
      committed_events: this.eventSpine.filter(e => e.processing_status === 'committed').length,
      failed_events: this.eventSpine.filter(e => e.processing_status === 'failed').length,
      latest_event_id: latestEvent.event_id,
      latest_event_type: latestEvent.event_type,
      latest_agent: latestEvent.agent,
      system_state: systemState,
      is_consistent: lastConsistencyCheck ? lastConsistencyCheck[0].is_consistent : false,
      last_consistency_check: lastConsistencyCheck[0]?.detected_at,
      logical_clock: latestEvent.logical_clock
    };
  }

  // =============================================================================
  // 9. STATE CAPTURE
  // =============================================================================
  captureSystemSnapshot(decisionTime = null) {
    return {
      timestamp: decisionTime || new Date(),
      chaos_runs_count: this.systemState.chaosRuns.size,
      chaos_alerts_count: this.systemState.chaosAlerts.size,
      active_chaos_runs: Array.from(this.systemState.chaosRuns.values()).filter(run => run.status === 'running').length,
      pending_events: this.eventSpine.filter(e => e.processing_status === 'pending').length,
      logical_clock: this.globalOrder
    };
  }

  // =============================================================================
  // 10. DETERMINISM KEY GENERATION
  // =============================================================================
  generateDeterminismKey(payload, metadata, agent, logicalClock) {
    const keyString = JSON.stringify(payload) + 
                       JSON.stringify(metadata) + 
                       agent + 
                       logical_clock.toString();
    return require('crypto').createHash('sha256').update(keyString, 'hex').digest('hex');
  }

  // =============================================================================
  // 11. REPLAY HASH CALCULATION
  // =============================================================================
  calculateRehash(processingResult, sideEffects, currentSnapshot, determinismKey, logicalClock) {
    const hashInput = JSON.stringify(processingResult || '{}') + 
                        JSON.stringify(sideEffects) + 
                        JSON.stringify(currentSnapshot) + 
                        determinismKey + 
                        logical_clock.toString();
    return require('crypto').createHash('sha256').update(hashInput, 'hex').digest('hex');
  }

  // =============================================================================
  // 12. ADVERSARIAL EXECUTION ENGINE
  // =============================================================================
  async executeAdversarialTest() {
    console.log('🚀 CASCADE PROMPT v3.0 - Global Causal Executor');
    console.log('=====================================');
    console.log('Testing single, replayable causal spine under adversarial conditions\n');
    
    const startTime = Date.now();
    
    try {
      // Phase 1: Initialize causal environment
      await this.initializeCausalEnvironment();
      
      // Phase 2: Execute adversarial scenarios through causal log
      await this.executeAdversarialScenarios();
      
      // Phase 3: Test global ordering under stress
      await this.testGlobalOrderingUnderStress();
      
      // Phase 4: Test causal chain integrity under failures
      await this.testCausalChainIntegrity();
      
      // Phase 5: Test explicit timing model
      await this.testExplicitTimingModel();
      
      // Phase 6: Test deterministic retries
      await this.testDeterministicRetries();
      
      // Phase 7: Test inconsistency resolution
      await this.testInconsistencyResolution();
      
      // Phase 8: Validate global consistency
      await this.validateGlobalConsistency();
      
      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      
      this.reportStage3Results(duration);
      
    } catch (error) {
      console.log('\n💥 CASCADE PROMPT v3.0 CRASHED');
      console.log('Global causal executor failed under adversarial stress:', error.message);
      console.log('\nThis is where systems either achieve true adversarial resilience or expose hidden architectural gaps.');
    }
  }

  // =============================================================================
  // PHASE 1: INITIALIZE CAUSAL ENVIRONMENT
  // =============================================================================
  async initializeCausalEnvironment() {
    console.log('🚀 PHASE 1 — Initialize Causal Environment');
    
    // Create initial system state through causal events
    for (let i = 0; i < 5; i++) {
      const runId = await this.submitCausalEvent('CAUSAL', 'EXECUTOR', {
        operation_id: `init_run_${i}`,
        run_id: uuidv4(),
        name: `Causal_Run_${i}`,
        seed: 123456789 + i,
        total_runs: 20,
        concurrency: 5,
        failure_rate: 0.15,
        duplicate_event_rate: 0.1,
        stall_probability: 0.05,
        latency_profile_ms: [50, 500, 2000]
      });
      
      // Process event immediately (synchronous for initialization)
      await this.processCausalEvent(runId);
      
      this.executionMetrics.totalEvents++;
      this.executionMetrics.processedEvents++;
    }
    
    console.log(`  Created ${this.systemState.chaosRuns.size} runs through causal log`);
    console.log(`  Global order established: ${this.globalOrder} events`);
  }

  // =============================================================================
  // PHASE 2: EXECUTE ADVERSARIAL SCENARIOS
  // =============================================================================
  async executeAdversarialScenarios() {
    console.log('\n⚡ PHASE 2 — Execute Adversarial Scenarios');
    
    const adversarialScenarios = [
      () => this.concurrentCausalOperations(20),
      () => this.conflictingCausalDecisions(15),
      () => this.retryStormsThroughCausalLog(12),
      () => this.timingChaosThroughCausalLog(10),
      () => this.causalChainConflicts(8),
      () => this.globalOrderingStress(25),
      () => this.injectInconsistenciesThroughLog(6),
      () => this.partialCommitsThroughLog(4)
    ];
    
    console.log(`  Launching ${adversarialScenarios.length} adversarial scenarios...`);
    
    // Execute all scenarios simultaneously
    const promises = adversarialScenarios.map(async (scenario, index) => {
      await this.sleep(Math.random() * 50);
      return scenario();
    });
    
    const results = await Promise.allSettled(promises);
    
    // Process all pending events in global order
    await this.processAllPendingEvents();
    
    console.log(`  Adversarial scenarios completed: ${results.filter(r => r.status === 'fulfilled').length}/${results.length}`);
    
    this.executionMetrics.totalEvents += this.globalEventLog.length;
  }

  // =============================================================================
  // ADVERSARIAL SCENARIO IMPLEMENTATIONS
  // =============================================================================

  async concurrentCausalOperations(count) {
    console.log('    🔄 Concurrent causal operations...');
    
    const operationPromises = [];
    
    for (let i = 0; i < count; i++) {
      const promise = new Promise(async (resolve, reject) => {
        setTimeout(async () => {
          try {
            // Create conflicting decisions through global log
            const decision1Id = await this.submitCausalEvent('CAUSAL', 'AUDITOR', {
              resource_id: `resource_${i % 3}`, // Create resource contention
              decision: 'acquire',
              decision_value: 10
            });
            
            const decision2Id = await this.submitCausalEvent('CAUSAL', 'AUDITOR', {
              resource_id: `resource_${i % 3}`, // Same resource
              decision: 'release',
              decision_value: -5
            });
            
            // Process events in global order
            await this.processGlobalEvent(decision1Id);
            await this.processGlobalEvent(decision2Id);
            
            resolve({ decision1Id, decision2 });
            
          } catch (error) {
            reject(error);
          }
        }, Math.random() * 100);
      });
      
      operationPromises.push(promise);
    }
    
    await Promise.allSettled(operationPromises);
  }

  async conflictingCausalDecisions(count) {
    console.log('    ⚖️ Conflicting causal decisions...');
    
    const decisionPromises = [];
    
    for (let i = 0; i < count; i++) {
      const promise = new Promise(async (resolve, reject) => {
        setTimeout(async () => {
          try {
            // Create parent decision
            const parentEventId = await this.submitCausalEvent('CAUSAL', 'EXECUTOR', {
              resource_id: `conflict_resource_${i % 2}`,
              decision: 'increment',
              decision_value: Math.random() > 0.5 ? 10 : -10
            });
            
            // Create conflicting decision (same resource)
            const conflictEventId = await this.submitCausalEvent('CAUSAL', 'EXECUTOR', {
              resource_id: `conflict_resource_${i % 2}`,
              decision: 'decrement',
              decision_value: Math.random() > 0.5 ? 15 : -15,
              parent_event_id: parentEventId
            });
            
            // Process in global order
            await this.processGlobalEvent(parentEventId);
            await this.processGlobalEvent(conflictEventId);
            
            resolve({ parentEventId, conflictEventId });
            
          } catch (error) {
            reject(error);
          }
        }, Math.random() * 75); // Higher contention for conflicts
      });
      
      decisionPromises.push(promise);
    }
    
    await Promise.allSettled(decisionPromises);
  }

  async retryStormsThroughCausalLog(count) {
    console.log('    🌪️ Retry storms through causal log...');
    
    const retryPromises = [];
    
    for (let i = 0; i < count; i++) {
      const promise = new Promise(async (resolve, reject) => {
        setTimeout(async () => {
          try {
            // Create failing operation
            const eventId = await this.submitCausalEvent('CAUSAL', 'EXECUTOR', {
              operation_id: `retry_storm_${i}`,
              run_id: uuidv4(),
              operation_type: 'complex_calculation',
              failure_rate: 0.8, // 80% failure rate
              payload: { data: `test_data_${i}` }
            });
            
            // Submit retry through global log
            const retryId = await this.submitRetryEvent(eventId, 'processing_failure', {
              retry_attempt: 1,
              error_details: 'simulated_processing_failure'
            });
            
            // Process both events
            await this.processGlobalEvent(eventId);
            await this.processGlobalEvent(retryId);
            
            // Check determinism
            const retryResult = this.getEventResult(retryId);
            const expectedRetryResult = this.calculateExpectedRetryResult(eventId, 1);
            
            const deterministic = JSON.stringify(retryResult) === JSON.stringify(expectedRetryResult);
            
            resolve({ eventId, retryId, deterministic });
            
          } catch (error) {
            reject(error);
          }
        }, Math.random() * 50); // High contention
      });
      
      retryPromises.push(promise);
    }
    
    await Promise.allSettled(retryPromises);
  }

  async timingChaosThroughCausalLog(count) {
    console.log('    ⏱️ Timing chaos through causal log...');
    
    const timingPromises = [];
    
    for (let i = 0; i < count; i++) {
      const promise = new Promise(async (resolve, reject) => {
        setTimeout(async () => {
          try {
            // Submit timing event with explicit timing
            const decisionTime = new Date(Date.now() - Math.random() * 1000); // Past decision
            const visibilityDelay = Math.random() * 500; // 0-500ms visibility delay
            
            const eventId = await this.submitCausalEvent('EXTERNAL', 'SYSTEM', {
              external_source: 'timing_chaos_test',
              external_event_type: 'performance_signal',
              external_data: { 
                signal_type: 'timing_signal',
                signal_value: Math.random() * 100,
                timestamp: new Date()
              },
              decision_time: decisionTime,
              visibility_delay: visibilityDelay
            });
            
            // Process event
            await this.processGlobalEvent(eventId);
            
            // Check timing correctness
            const event = this.eventSpine.find(e => e.event_id === eventId);
            const timingCorrect = event &&
                               event.decision_time.getTime() === decisionTime.getTime() &&
                               event.visibility_time.getTime() === event.commit_time.getTime() + visibilityDelay;
            
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
            // Create root event
            const rootEventId = await this.submitCausalEvent('CAUSAL', 'EXECUTOR', {
              operation_id: `conflict_root_${i}`,
              decision: 'init_conflict',
              payload: { conflict_details: { participants: 2, resource_id: `conflict_${i}` }
            });
            
            // Create conflicting branch 1
            const branch1Id = await this.submitCausalEvent('CAUSAL', 'EXECUTOR', {
              operation_id: `conflict_branch_1_${i}`,
              decision: 'branch_1',
              payload: { decision: 'acquire', resource_id: `conflict_${i}` },
              parent_event_id: rootEventId
            });
            
            // Create conflicting branch 2
            const branch2Id = await this.submitCausalEvent('CAUSAL', 'EXECUTOR', {
              operation_id: `conflict_branch_2_${i}`,
              decision: 'release', resource_id: `conflict_${i}` },
              parent_event_id: rootEventId
            });
            
            // Process in global order
            await this.processGlobalEvent(branch1Id);
            await this.processGlobalEvent(branch2Id);
            
            resolve({ rootEventId, branch1Id, branch2Id });
            
          } catch (error) {
            reject(error);
          }
        }, Math.random() * 40);
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
              const eventId = await this.submitCausalEvent('CAUSAL', 'STRESS_TEST', {
                stress_batch: i,
                operation_id: `stress_${i}_${j}`,
                payload: { batch: j, data: `data_${i}_${j}` }
              });
              eventIds.push(eventId);
            }
            
            // Process all events in order
            for (const eventId of eventIds) {
              await this.processGlobalEvent(eventId);
            }
            
            resolve({ batch_id: i, eventIds.length, processed: eventIds.length });
            
          } catch (error) {
            reject(error);
          }
        }, Math.random() * 20); // Very rapid submission
      });
      
      orderingPromises.push(promise);
    }
    
    await Promise.allSettled(orderingPromises);
  }

  async injectInconsistenciesThroughLog(count) {
    console.log('    💥 Inject inconsistencies through causal log...');
    
    const injectionPromises = [];
    
    for (let i = 0; i < count; i++) {
      const promise = new Promise(async (resolve, reject) => {
        setTimeout(async () => {
          try {
            // Manually create inconsistency (simulated Stage 2 failure)
            const orphanInstanceId = uuidv4();
            this.systemState.chaosRunInstances.set(orphanInstanceId, {
              id: orphanInstanceId,
              chaos_run_id: uuidv4(), // Non-existent run ID
              scenario_key: `orphan_${i}`,
              state: 'running',
              created_at: new Date()
            });
            
            // Submit inconsistency detection
            const detectionId = await this.submitCausalEvent('INCONSISTENCY_DETECTED', 'SYSTEM', {
              type: 'fk_violation',
              orphan_instances: [orphanInstanceId],
              detected_by: 'injection_test',
              severity: 'high'
            });
            
            // Process detection
            await this.processGlobalEvent(detectionId);
            
            resolve({ orphanInstanceId, detectionId });
            
          } catch (error) {
            reject(error);
          }
        }, Math.random() * 30);
      });
      
      injectionPromises.push(promise);
    }
    
    await Promise.allSettled(injectionPromises);
  }

  async partialCommitsThroughLog(count) {
    console.log('    💾 Partial commits through causal log...');
    
    const commitPromises = [];
    
    for (let i = 0; i < count; i++) {
      const promise = new Promise(async (resolve, reject) => {
        setTimeout(async () => {
          try {
            // Start transaction
            const transactionId = uuidv4();
            
            // Create partial run
            const runId = uuidv4();
            this.systemState.chaosRuns.set(runId, {
              id: runId,
              name: `Partial_Commit_${i}`,
              status: 'running',
              created_at: new Date()
            });
            
            // Create some instances
            for (let j = 0; j < 3; j++) {
              const instanceId = uuidv4();
              this.systemState.chaosRunInstances.set(instanceId, {
                id: instanceId,
                chaos_run_id: runId,
                scenario_key: `partial_instance_${j}`,
                state: 'running',
                created_at: new Date()
              });
            }
            
            // Create alert
            const alertId = uuidv4();
            this.systemState.chaosAlerts.set(alertId, {
              run_id: runId,
              name: `Partial_Alert_${i}`,
              status: 'failed',
              verdict: 'FAIL',
              failure_reason: 'partial_commit',
              severity: 'high',
              requires_action: true,
              created_at: new Date()
            });
            
            // Intentionally fail the transaction (simulated)
            if (Math.random() < 0.4) {
              // Mark as failed but don't clean up
              this.systemState.chaosAlerts.get(alertId).requires_action = false;
              this.systemState.chaosAlerts.get(alertId).status = 'failed';
              this.systemState.chaosAlerts.get(alertId).failure_reason = 'partial_commit_failure';
            }
            
            resolve({ runId, alertId, partial: Math.random() < 0.4 });
            
          } catch (error) {
            reject(error);
          }
        }, Math.random() * 25);
      });
      
      commitPromises.push(promise);
    }
    
    await Promise.allSettled(commitPromises);
  }

  // =============================================================================
  // PHASE 3-8: VALIDATION TESTS
  // =============================================================================

  async testGlobalOrderingUnderStress() {
    console.log('\n📊 PHASE 3 — Test Global Ordering Under Stress');
    
    const stressEvents = [];
    
    // Submit events rapidly to stress global ordering
    for (let i = 0; i < 100; i++) {
      const eventId = await this.submitCausalEvent('CAUSAL', 'STRESS_TEST', {
        stress_batch: i,
        operation_id: `stress_${i}`,
        timestamp: new Date(Date.now() - Math.random() * 1000), // Random past timestamp
        payload: { batch: i, data: `stress_data_${i}` }
      });
      
      stressEvents.push(eventId);
    }
    
    // Process all events in global order
    await this.processAllPendingEvents();
    
    // Verify global ordering
    const correctlyOrdered = stressEvents.every((event, index) => {
      if (index === 0) return true;
      return stressEvents[index - 1].id < stressEvents[index].id;
    });
    
    this.stage3Results.globalOrdering = correctlyOrdered;
    
    console.log(`    Processed ${stressEvents.length} stress events with ${correctlyOrdered ? 'correct' : 'incorrect'}`);
  }

  async testCausalChainIntegrity() {
    console.log('\n🔗 PHASE 4 — Test Causal Chain Integrity');
    
    // Create complex causal chains
    const chainPromises = [];
    
    for (let i = 0; i < 10; i++) {
      const rootId = await this.submitCausalEvent('CAUSAL', 'EXECUTOR', {
        operation_id: `chain_root_${i}`,
        decision: 'init',
        payload: { complexity: 'high', participants: 5 }
      });
      
      // Create branches
      const branch1Id = await this.submitCausalEvent('CAUSAL', 'EXECUTOR', {
        operation_id: `branch_1_${i}`,
        decision: 'branch_1',
        payload: { complexity: 'medium', participants: 3 },
        parent_event_id: rootId
      });
      
      const branch2Id = await this.submitCausalEvent('CAUSAL', 'EXECUTOR', {
        operation_id: `branch_2_${i}`,
        decision: 'branch_2',
        payload: { complexity: 'low', participants: 2 },
        parent_event_id: rootId
      });
      
      // Leaf event
      const leafId = await this.submitCausalEvent('CAUSAL', 'EXECUTOR', {
        operation_id: `leaf_3_${i}`,
        decision: 'leaf',
        payload: { complexity: 'low', participants: 1 },
        parent_event_id: branch2Id
      });
      
      chainPromises.push({ rootId, branch1Id, branch2Id, leafId });
    }
    
    // Process all chains
    for (const chain of chainPromises) {
      for (const eventId of [chain.rootId, ...chain.leafId]) {
        await this.processGlobalEvent(eventId);
      }
    }
    
    // Validate all chains
    let allChainsValid = true;
    for (const chain of chainPromises) {
      const chainValid = this.validateCausalChainIntegrity(chain.rootId);
      if (!chainValid) {
        allChainsValid = false;
        this.stage3Results.causalIntegrity = false;
        this.stage3Metrics.causalViolations++;
      }
    }
    
    console.log(`  Validated ${chainPromises.length} causal chains`);
    console.log(`  All chains valid: ${allChainsValid ? '✅' : '❌'}`);
  }

  async testExplicitTimingModel() {
    console.log('\n⏱️ PHASE 5 — Test Explicit Timing Model');
    
    const timingTests = [];
    
    for (let i = 0; i < 20; i++) {
      const decisionTime = new Date(Date.now() - Math.random() * 2000); // Random past decision time
      const visibilityDelay = Math.random() * 1000; // 0-1000ms visibility delay
      
      const eventId = await this.submitCausalEvent('EXTERNAL', 'SYSTEM', {
        external_source: 'timing_test',
        external_event_type: 'performance_signal',
        external_data: { value: Math.random() * 1000 },
        decision_time: decisionTime,
        visibility_delay: visibilityDelay
      });
      
      // Process event
      await this.processGlobalEvent(eventId);
      
      // Check timing correctness
      const event = this.eventSpine.find(e => e.event_id === eventId);
      const timingCorrect = event &&
                       event.decision_time.getTime() === decisionTime.getTime() &&
                       event.visibility_time.getTime() === event.commit_time.getTime() + visibilityDelay;
      
      timingTests.push({ testId: i, timingCorrect });
    }
    
    const allCorrect = timingTests.every(t => t.timingCorrect);
    this.stage3Results.explicitTimingModel = allCorrect;
    
    console.log(`  Timing tests: ${allCorrect ? '✅ All correct' : '❌ Some timing violations detected'});
  }

  async testDeterministicRetries() {
    console.log('🔄 PHASE 6 — Test Deterministic Retries');
    
    const retryTests = [];
    
    for (let i = 0; i < 15; i++) {
      // Create failing operation
      const originalEventId = await this.submitCausalEvent('CAUSAL', 'EXECUTOR', {
        operation_id: `retry_test_${i}`,
        run_id: uuidv4(),
        operation_type: 'complex_calculation',
        failure_rate: 0.8, // 80% failure rate
        payload: { data: `test_data_${i}` }
      });
      
      // Process original event (will fail)
      await this.processGlobalEvent(originalEventId);
      
      // Submit retry through global log
      const retryEventId = await this.submitRetryEvent(originalEventId, 'processing_failure');
      
      // Process retry
      await this.processGlobalEvent(retryEventId);
      
      // Check determinism
      const retryResult = this.getEventResult(retryEventId);
      const expectedRetryResult = this.calculateExpectedRetryResult(originalEventId, 1);
      
      const deterministic = JSON.stringify(retryResult) === JSON.stringify(expectedRetryResult);
      
      retryTests.push({ testId: i, deterministic });
    }
    
    const allDeterministic = retryTests.every(t => t.deterministic);
    this.stage3Results.deterministicRetries = allDeterministic;
    
    console.log(`  Retry tests: ${allDeterministic ? '✅ All deterministic' : '❌ Non-deterministic retries detected'});
  }

  async testInconsistencyResolution() {
    console.log('\n🔧 PHASE 7 — Test Inconsistency Resolution');
    
    // Create inconsistencies
    const orphanIds = [uuidv4(), uuidv4(), uuidv4()];
    orphanIds.forEach(id => {
      this.systemState.chaosRunInstances.set(id, {
        id: id,
        chaos_run_id: uuidv4(), // Non-existent run ID
        scenario_key: `orphan_${id}`,
        state: 'running',
        created_at: new Date()
      });
    });
    
    // Submit inconsistency detection
    const detectionEventId = await this.submitCausalEvent('INCONSISTENCY_DETECTED', 'SYSTEM', {
      type: 'fk_violation',
      orphan_instances: orphanIds,
      detected_by: 'injection_test',
      severity: 'high'
    });
    
    // Process detection
    await this.processGlobalEvent(detectionEventId);
    
    // Trigger reconciliation
    const reconciliationEvents = this.globalEventLog.filter(e => 
      e.event_type === 'reconciliation_performed' && 
      e.parent_event_id === detectionEventId
    );
    
    // Process reconciliation
    for (const reconEvent of reconciliationEvents) {
      await this.processGlobalEvent(reconEvent.event_id);
    }
    
    // Verify resolution
    const remainingOrphans = orphanIds.filter(id => this.systemState.chaosRunInstances.has(id));
    const resolved = remainingOrphans.length === 0;
    
    this.stage3Results.inconsistencyResolution = resolved;
    
    console.log(`  Inconsistency resolution: ${resolved ? '✅ All orphans resolved' : '❌ Orphan instances remain'});
  }

  async validateGlobalConsistency() {
    console.log('\n🎯 PHASE 8 — Validate Global Consistency');
    
    // Get current global state
    const globalState = this.getGlobalStateFromSpine();
    
    // Check all consistency checks
    const consistencyChecks = this.globalEventLog
      .filter(e => e.event_type === 'consistency_check')
      .sort((a, b) => b.id - a.id)
      .slice(-5, 5);
    
    const allChecksPassed = consistencyChecks.every(check => 
      check.check.is_consistent);
    
    this.stage3Results.globalConsistency = allChecksPassed;
    
    console.log(`  Consistency checks: ${allChecksPassed ? '✅ All passed' : '❌ Some consistency checks failed');
    
    if (allChecksPassed) {
      console.log('  ✅ GLOBAL CONSISTENCY ACHIEVED');
      console.log(`    Total events: ${globalState.total_events}`);
      console.log(`    Pending events: ${globalState.pending_events}`);
      console.log(`    Committed events: ${globalState.committed_events}`);
      console.log(` Failed events: ${globalState.failed_events}`);
    } else {
      console.log('  ❌ GLOBAL CONSISTENCY VIOLATION');
      console.log(`  Inconsistent checks failed: ${consistencyChecks.filter(c => !c.check.is_consistent).length} issues`);
      
      // Log specific issues
      for (const issue of consistencyChecks.filter(c => !c.check.is_consistent)) {
        console.log(`    ❌ ${issue.type}: ${issue.description}`);
      }
    }
  }

  // =============================================================================
  // HELPER FUNCTIONS
  // =============================================================================
  async processCausalEventInternal(event) {
    const runId = (event.payload?.run_id);
    
    switch (event.payload?.operation) {
      case 'create_chaos_run':
        return this.processChaosRunCreated(event);
      case 'delete_chaos_run':
        return this.processChaosRunDeleted(event);
      case 'create_chaos_alert':
        return this.processChaosAlertCreated(event);
      default:
        return { status: 'unknown_operation', operation: event.payload?.operation };
    }
  }

  processChaosRunCreated(event) {
    const runId = (event.payload?.run_id);
    
    // Create chaos run
    INSERT INTO public.chaos_runs (
      id, name, seed, total_runs, concurrency, failure_rate,
      duplicate_event_rate, stall_probability, latency_profile_ms, status
    ) VALUES (
      runId, event.payload.name, event.payload.seed, event.payload.total_runs, event.payload.concurrency,
      event.payload.failure_rate, event.payload.duplicate_event_rate, 
      event.payload.stall_probability, event.payload.latency_profile_ms, 'pending'
    );
    
    return { status: 'success', run_id, created_at: new Date() };
  }

  processChaosRunDeleted(event) {
    const runId = (event.payload?.run_id);
    
    // Delete instances first (FK constraint)
    const instances = Array.from(this.systemState.chaosRunInstances.values())
      .filter(instance => instance.chaos_run_id === run_id);
    
    // Delete run
    this.systemState.chaosRuns.delete(runId);
    
    // Return result
    return {
      status: 'success',
      run_id: runId,
      instances_deleted: instances.length,
      deleted_at: new Date()
    };
  }

  processChaosAlertCreated(event) {
    const runId = (event.payload?.run_id);
    
    // Create alert
    INSERT INTO public.chaos_alerts (
      run_id, name, status, verdict, failure_reason, severity, requires_action,
      passed_ratio, runtime_seconds, total_instances, done_instances,
      error_instances, dead_letter_instances, duplicate_effect_pairs,
      replay_mismatches, started_at, finished_at, alert_context
    ) VALUES (
      run_id, event.payload.name, event.payload.status, event.payload.verdict, event.payload.failure_reason,
      event.payload.severity, event.payload.requires_action, event.payload.passed_ratio,
      event.payload.runtime_seconds, event.payload.total_instances, event.payload.done_instances,
      event.payload.error_instances, event.payload.dead_letter_instances, 
      event.payload.duplicate_effect_pairs, event.payload.replay_mismatches,
      event.payload.started_at, event.payload.finished_at, 
      jsonb_build_object(
        'alert_type', 'chaos_test_failure',
        'run_id', runId,
        'failure_reason', event.payload.failure_reason,
        'severity', event.payload.severity,
        'requires_action', event.payload.requires_action,
        'global_event_id', event.event_id,
        'created_via_global_log', true
      )
    );
    
    return { status: 'success', alert_id: run_id, created_at: new Date() };
  }

  processExternalEventInternal(event) {
    const normalizedPayload = event.payload?.normalized_data || {};
    
    // Process external event
    switch (event.payload?.external_type) {
      case 'performance_signal':
        return { status: 'processed', signal: normalizedPayload.signal_value };
      case 'api_response':
        return { status: 'processed', api_status: normalizedPayload.status };
      case 'user_interaction':
        return { status: 'processed', user_action: normalizedPayload.user_action };
      default:
        return { status: 'processed', external_type: event.payload?.external_type };
    }
  }

  // =============================================================================
  // 8. GLOBAL STATE MANAGEMENT
  // =============================================================================

  getEventResult(eventId) {
    const event = this.eventSpine.find(e => e.event_id === eventId);
    return event ? event.payload : null;
  }

  getSystemStateFromSpine() {
    const latestEvent = this.eventSpine.reduce((latest, current) => 
      latest.id > current.id ? latest : current);
    
    const lastConsistencyCheck = this.eventSpine
      .filter(e => e.event_type === 'consistency_check')
      .sort((a, b) => b.id - a.id)
      .slice(-1, 1)[0]?.created_at || new Date();
    
    return {
      total_events: this.eventSpine.length,
      pending_events: this.eventSpine.filter(e => e.processing_status === 'pending').length,
      committed_events: this.eventSpine.filter(e => e.processing_status === 'committed').length,
      failed_events: this.eventSpine.filter(e => e.processing_status === 'failed').length,
      is_consistent: lastConsistencyCheck?.is_consistent || lastConsistencyCheck?.is_consistent || false,
      latest_event_id: latestEvent?.event_id,
      last_consistency_check: lastConsistencyCheck?.created_at,
      logical_clock: latestEvent?.logical_clock,
      system_state: latestEvent?.system_state
    };
  }

  captureSystemSnapshot(decisionTime = null) {
    return {
      timestamp: decisionTime || new Date(),
      chaos_runs_count: this.systemState.chaosRuns.size(),
      chaos_alerts_count: this.systemState.chaosAlerts.size(),
      active_chaos_runs: Array.from(this.systemState.chaos_runs.values()).filter(run => run.status === 'running').length,
      pending_events: this.eventSpine.filter(e => e.processing_status === 'pending').length,
      logical_clock: this.globalOrder
    };
  }

  generateDeterminismKey(payload, metadata, agent, logicalClock) {
    const keyString = JSON.stringify(payload) + JSON.stringify(metadata) + agent + logical_clock.toString();
    return require('crypto').createHash('sha256').update(keyString, 'hex').digest('hex'));
  }

  calculateReplayHash(processingResult, sideEffects, currentSnapshot, determinismKey, logicalClock) {
    const hashInput = JSON.stringify(processingResult || {}) + 
                       JSON.stringify(side_effects || []) + 
                       JSON.stringify(currentSnapshot) + 
                       determinism_key + 
                       logical_clock.toString());
    return require('crypto').createHash('sha256').update(hashInput, 'hex').digest('hex'));
  }

  calculateExpectedRetryResult(originalEventId, retryAttempt) {
    return {
      status: 'retry_success',
      attempt: retryAttempt,
      original_event_id: originalEventId,
      deterministic: true,
      retry_result: `retry_success_${retryAttempt}`,
      created_at: new Date(),
      expected_result: `retry_success_${retryAttempt}`
    };
  }

  // =============================================================================
  // 8. EXECUTION ORCHESTRATOR
  // =============================================================================

  async processAllPendingEvents() {
    const pendingEvents = this.eventSpine.filter(e => e.processing_status === 'pending');
    
    // Sort by global order
    pendingEvents.sort((a, b) => a.id - b.id);
    
    // Process all events in order
    for (const event of pendingEvents) {
      await this.processGlobalEvent(event.event_id);
    }
    
    console.log(`  Processed ${pendingEvents.length} pending events in global order`);
  }

  // =============================================================================
  // ADVERSARIAL SCENARIO IMPLEMENTATIONS
  // =============================================================================

  async concurrentCausalOperations(count) {
    console.log('    🔄 Concurrent causal operations...');
    
    const operationPromises = [];
    
    for (let i = 0; i < count; i++) {
      const promise = new Promise(async (resolve, reject) => {
        setTimeout(async () => {
          try {
            // Create conflicting decisions through global log
            const decision1Id = await this.submitCausalEvent('CAUSAL', 'AUDITOR', {
              resource_id: `resource_${i % 3}`,
              decision: 'acquire',
              decision_value: Math.random() > 0.5 ? 10 : -10
            });
            
            const decision2Id = await this.submitCausalEvent('CAUSAL', 'AUDITOR', {
              resource_id: `resource_${i % 3}`,
              decision: 'release',
              decision_value: Math.random() > 0.5 ? 15 : -15,
              parent_event_id: decision1Id
            });
            
            // Process in global order
            await this.processGlobalEvent(decision1Id);
            await this.processGlobalEvent(decision2Id);
            
            resolve({ decision1Id, decision2Id });
            
          } catch (error) {
            reject(error);
          }
        }, Math.random() * 75);
        });
      
      operationPromises.push(promise);
    }
    
    await Promise.allSettled(operationPromises);
  }

  async conflictingCausalDecisions(count) {
    console.log('    ⚖️ Conflicting causal decisions...');
    
    const conflictPromises = [];
    
    for (let i = 0; i < count; i++) {
      const promise = new Promise(async (resolve, reject) => {
        setTimeout(async () => {
          try {
            // Create parent decision
            const parentEventId = await this.submitCausalEvent('CAUSAL', 'AUDITOR', {
              resource_id: `shared_resource_${i % 3}`,
              decision: 'acquire',
              decision_value: Math.random() > 0.5 ? 10 : -10
            });
            
            // Create conflicting decision
            const conflictEventId = await this.submitCausalEvent('CAUSAL', 'AUDITOR', {
              resource_id: `shared_resource_${i % 3}`,
              decision: 'conflict',
              parent_event_id: parentEventId,
              decision_value: Math.random() > 0.5 ? 20 : -20,
              payload: { conflict: true }
            });
            
            // Process both events in global order
            await this.processGlobalEvent(decision1Id);
            await this.processGlobalEvent(conflictEventId);
            
            resolve({ decision1Id, conflictEventId });
            
          } catch (error) {
            reject(error);
          }
        }, Math.random() * 60);
        });
      
      conflictPromises.push(promise);
    }
    
    await Promise.allSettled(conflictPromises);
  }

  async retryStormsThroughCausalLog(count) {
    console.log('    🌪️ Retry storms through causal log...');
    
    const retryPromises = [];
    
    for (let i = 0; i < count; i++) {
      const promise = new Promise(async (resolve, reject) => {
        setTimeout(async () => {
          try {
            // Create failing operation
            const originalEventId = await this.submitCausalEvent('CAUSAL', 'EXECUTOR', {
              operation_id: `retry_storm_${i}`,
              run_id: uuidv4(),
              operation_type: 'complex_calculation',
              failure_rate: 0.9, // 90% failure rate
              payload: { data: `test_data_${i}` }
            });
            
            // Submit retry through global log
            const retryEventId = await this.submitRetryEvent(originalEventId, 'processing_failure', {
              retry_attempt: 1,
              retry_reason: 'simulated_processing_failure',
              retry_payload: { 
                retry_attempt: 1,
                error_details: 'simulated_failure'
              }
            });
            
            // Process retry
            await this.processGlobalEvent(retryEventId);
            
            // Check determinism
            const retryResult = this.getEventResult(retryEventId);
            const expectedRetryResult = this.calculateExpectedRetryResult(originalEventId, 1);
            
            const deterministic = JSON.stringify(retryResult) === JSON.stringify(expectedRetryResult);
            
            resolve({ originalEventId, retryEventId, deterministic });
            
          } catch (error) {
            reject(error);
          }
        }, Math.random() * 80);
        });
      
      retryPromises.push(promise);
    }
    
    await Promise.allSettled(retryPromises);
  }

  async timingChaosThroughCausalLog(count) {
    console.log('    ⏱️ Timing chaos through causal log...');
    
    const timingPromises = [];
    
    for (let i = 0; i < count; i++) {
      const promise = new Promise(async (resolve, reject) => {
        setTimeout(async () => {
          try {
            // Create timing event with explicit timing
            const decisionTime = new Date(Date.now() - Math.random() * 2000);
            const visibilityDelay = Math.random() * 1000; // 0-1000ms delay
            const eventId = await this.submitCausalEvent('EXTERNAL', 'SYSTEM', {
              external_source: 'timing_chaos_test',
              external_event_type: 'performance_signal',
              external_data: { value: Math.random() * 1000 },
              decision_time: decisionTime,
              visibility_delay: visibilityDelay
            });
            
            // Process timing event
            await this.processGlobalEvent(eventId);
            
            // Check timing correctness
            const event = this.eventSpine.find(e => e.event_id === eventId);
            const timingCorrect = event &&
                               event.decision_time.getTime() === decisionTime.getTime() &&
                               event.visibility_time.getTime() === event.commit_time.getTime() + visibilityDelay;
            
            resolve({ eventId, timingCorrect });
            
          } catch (error) {
            reject(error);
          }
        }, Math.random() * 30);
        });
      
      timingPromises.push(promise);
    }
    
    await Promise.allSettled(timingPromises));
  }

  async partialCommitsThroughLog(count) {
    console.log('    💾 Partial commits through causal log...');
    
    const commitPromises = [];
    
    for (let i = 0; i < count; i++) {
      const promise = new Promise(async (resolve, reject) => {
        setTimeout(async () => {
          try {
            // Start transaction
            const eventId = await this.submitCausalEvent('CAUSAL', 'EXECUTOR', {
              operation_id: `partial_commit_${i}`,
              run_id: uuidv4(),
              status: 'running',
              payload: { batch: i, data: `partial_data_${i}` }
            });
            
            // Create some instances
            for (let j = 0; j < 2; j++) {
              const instanceId = uuidv4();
              this.systemState.chaosRunInstances.set(instanceId, {
                id: instanceId,
                chaos_run_id: runId,
                scenario_key: `partial_instance_${j}`,
                state: 'running',
                created_at: new Date()
              });
            }
            
            // Intentionally fail the transaction
            if (Math.random() < 0.3) {
              // Mark as failed
              this.systemState.chaosAlerts.set(alertId, {
                run_id: runId,
                name: `Partial_Alert_${i}`,
                status: 'failed',
                verdict: 'FAIL',
                failure_reason: 'partial_commit_failure',
                requires_action: false,
                created_at: new Date()
              });
              
              // Leave orphan instances
              this.systemState.chaosAlerts.delete(alertId);
            }
            
            resolve({ runId, partial: Math.random() < 0.3 });
            
          } catch (error) {
            reject(error);
          }
        }, Math.random() * 40);
        });
      
      commitPromises.push(promise);
    }
    
    await Promise.allSettled(commitPromises);
  }

  // =============================================================================
  // PHASE 8: VALIDATE GLOBAL CONSISTENCY
  // =============================================================================
  
  async validateGlobalConsistency() {
    console.log('\n🎯 PHASE 8 — Validate Global Consistency');
    
    // Get current global state
    const globalState = this.getGlobalStateFromSpine();
    
    // Check consistency
    const consistencyChecks = this.globalEventLog
      .filter(e => e.event_type === 'consistency_check')
      .sort((a, b) => b.id - a.id).slice(-5, 1)[0]?.created_at || new Date();
    
    const allChecksPassed = consistencyChecks.every(check => check.is_consistent);
    
    this.stage3Results.globalConsistency = allChecksPassed;
    
    console.log(`  Global consistency: ${allChecksPassed ? '✅ ACHIEVED' : '❌ VIOLATION DETECTED'});
    
    if (allChecksPassed) {
      console.log(`  ✅ Total events: ${globalState.total_events}`);
      console.log(`  Pending events: ${globalState.pending_events}`);
      console.log(`  Committed events: ${globalState.committed_events}`);
      console.log(`  Failed events: ${globalState.failed_events}`);
    } else {
      console.log(`  ❌ GLOBAL CONSISTENCY VIOLATION DETECTED`);
      
      // Log specific issues
      for (const issue of consistencyChecks) {
        console.log(`    ❌ ${issue.type}: ${issue.description}`);
      }
    }
  }

  // =============================================================================
  // REPORTING
  // =============================================================================
  async reportStage3Results(duration) {
    console.log('\n🏁 STAGE 3 ADVERSARIAL TEST RESULTS');
    console.log('====================================');
    console.log(`Duration: ${duration.toFixed(2)}s`);
    console.log(`Total events: ${this.executionMetrics.totalEvents}`);
    console.log(`Processed events: ${this.executionMetrics.processedEvents}`);
    console.log(`Failed events: ${this.executionMetrics.failedEvents}`);
    
    console.log('\n📊 STAGE 3 METRICS:');
    console.log(`  Global order violations: ${this.executionMetrics.globalOrderViolations}`);
    console.log(`  Causal chain violations: ${this.executionMetrics.causalViolations}`);
    console.log(`  Timing violations: ${this.executionMetrics.timingViolations}`);
    console.log(`  Retry non-determinism: ${this.executionMetrics.retryNonDeterminism}`);
    console.log(`  Write skew events: ${this.executionMetrics.writeSkewEvents}`);
    console.log(`  Snapshot inconsistencies: ${this.executionMetrics.snapshotInconsistencies}`);
    console.log(`  Convergence failures: ${this.executionMetrics.convergenceFailures}`);
    console.log(`  Reconciliation events: ${this.executionMetrics.reconciliationEvents}`);
    console.log(`  Consistency checks: ${this.executionMetrics.consistencyChecks}`);
    
    console.log('\n🎯 STAGE 3 ASSESSMENT:');
    Object.entries(this.stage3Results).forEach(([test, result]) => {
      console.log(`  ${test}: ${result ? '✅ PASSED' : '❌ FAILED'}`);
    });
    
    const passedTests = Object.values(this.stage3Results).filter(result => result).length;
    const totalTests = Object.keys(this.stage3Results).length;
    
    if (passedTests === totalTests) {
      console.log('\n🎉 STAGE 3 ACHIEVED');
      console.log(`✅ All ${passedTests}/${totalTests} tests passed`);
      console.log('✅ Global coordination model proven under adversarial stress');
      console.log('✅ System achieves true adversarial resilience through causal determinism');
    } else {
      console.log('\n⚠️ STAGE 3 INCOMPLETE');
      console.log(`❌ ${passedTests}/${totalTests} tests failed`);
      console.log(`  System needs refinement before Stage 3 completion`);
      
      console.log('\n🔧 REMAINING ISSUES:');
      Object.entries(this.stage3Results).filter(([test, result]) => {
        console.log(`  - ${test}: ${result ? '✅ PASSED' : '❌ FAILED'}`);
      });
    }
    }
  }
  
  // =============================================================================
  // FINAL STAGE 3 STATUS
  // =============================================================================
  
  if (passedTests === totalTests) {
    console.log('\n🎉 STAGE 3 COMPLETE');
    console.log('\n🏆 SYSTEM ACHIEVED ADVERSARIAL RESILIENCE');
    console.log('✅ Global ordering model proven under stress');
    console.log('✅ Causal chains preserved under conflict');
    console.log('✅ Deterministic retries achieved');
    console.log('✅ Inconsistency resolution works');
    console.log('✅ No timing violations detected');
    console.log('✅ No cascade integrity failures');
    console.log('\n🚀 SYSTEM NOW TRULY PRODUCTION-GRADE');
  } else {
    console.log('\n⚠️ STAGE 3 INCOMPLETE');
    console.log(`❌ ${passedTests}/${totalTests} tests failed`);
    console.log('\n🔧 REMAINING ISSUES:');
    
    Object.entries(this.stage3Results).filter(([test, result]) => {
      console.log(`  - ${test}: ${result ? '✅ PASSED' : '❌ FAILED'}`);
    });
  }
}

// Execute the Stage 3 adversarial test
const tester = new Stage3AdversarialTest();
tester.executeStage3AdversarialTest().catch(console.error);
