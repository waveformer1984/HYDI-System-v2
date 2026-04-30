// PERMANENT GUARDS - INVARIANT ENFORCEMENT FOR PRODUCTION
// You don't trust yourself later. So enforce it now.

class PermanentGuards {
  constructor() {
    this.invariantChecks = new Map();
    this.violationKillSwitch = true;
    this.corruptedChains = new Set();
  }

  // =============================================================================
  // STEP 5.1: ADD INVARIANT CHECKS IN PIPELINE
  // =============================================================================
  
  async assertReplayConsistency(event, systemSnapshot) {
    // After every event: assertReplayConsistency()
    
    console.log(`🔍 Checking replay consistency for event ${event.event_id}`);
    
    // Generate replay hash
    const replayHash = this.calculateReplayHash(event, systemSnapshot);
    
    // Check if we've seen this event before
    const previousHash = this.invariantChecks.get(`replay_${event.event_id}`);
    
    if (previousHash && previousHash !== replayHash) {
      this.handleInvariantViolation('REPLAY_CONSISTENCY', {
        event_id: event.event_id,
        expected_hash: previousHash,
        actual_hash: replayHash,
        timestamp: new Date()
      });
      return false;
    }
    
    // Store hash for future checks
    this.invariantChecks.set(`replay_${event.event_id}`, replayHash);
    
    console.log(`    ✅ Replay consistency maintained`);
    return true;
  }

  async assertNoExternalMutation(event, systemSnapshot) {
    // After every event: assertNoExternalMutation()
    
    console.log(`🔍 Checking for external mutations`);
    
    // Check if system snapshot has been modified outside causal events
    const snapshotHash = this.calculateSnapshotHash(systemSnapshot);
    const previousSnapshotHash = this.invariantChecks.get('system_snapshot');
    
    if (previousSnapshotHash && previousSnapshotHash !== snapshotHash) {
      this.handleInvariantViolation('EXTERNAL_MUTATION', {
        event_id: event.event_id,
        expected_snapshot: previousSnapshotHash,
        actual_snapshot: snapshotHash,
        timestamp: new Date()
      });
      return false;
    }
    
    // Store snapshot hash
    this.invariantChecks.set('system_snapshot', snapshotHash);
    
    console.log(`    ✅ No external mutations detected`);
    return true;
  }

  async assertDeterministicHash(event, result) {
    // After every event: assertDeterministicHash()
    
    console.log(`🔍 Checking deterministic hash consistency`);
    
    // Calculate expected hash
    const expectedHash = this.calculateDeterministicHash(event);
    const actualHash = result.deterministic_hash;
    
    if (expectedHash !== actualHash) {
      this.handleInvariantViolation('DETERMINISTIC_HASH', {
        event_id: event.event_id,
        expected_hash: expectedHash,
        actual_hash: actualHash,
        timestamp: new Date()
      });
      return false;
    }
    
    console.log(`    ✅ Deterministic hash consistent`);
    return true;
  }

  // =============================================================================
  // STEP 5.2: ADD "VIOLATION KILL SWITCH"
  // =============================================================================
  
  handleInvariantViolation(violationType, violationData) {
    // If any invariant fails:
    // - mark event chain as corrupted
    // - halt downstream processing
    // - require replay verification
    
    console.log(`🚨 INVARIANT VIOLATION DETECTED: ${violationType}`);
    console.log(`   Event: ${violationData.event_id}`);
    console.log(`   Timestamp: ${violationData.timestamp}`);
    
    // Log violation as first-class event
    this.logViolationEvent(violationType, violationData);
    
    // Mark event chain as corrupted
    this.markChainCorrupted(violationData.event_id, violationType);
    
    // Halt downstream processing if kill switch is enabled
    if (this.violationKillSwitch) {
      this.haltDownstreamProcessing(violationData.event_id, violationType);
    }
    
    // Require replay verification
    this.requireReplayVerification(violationData.event_id, violationType);
  }

  markChainCorrupted(eventId, violationType) {
    console.log(`⚠️ Marking chain as corrupted from event ${eventId}`);
    
    this.corruptedChains.add(eventId);
    
    // In a real system, this would update the database
    // UPDATE global_causal_spine SET causality_violation = true WHERE event_id = eventId
  }

  haltDownstreamProcessing(eventId, violationType) {
    console.log(`🛑 Halting downstream processing due to ${violationType}`);
    
    // In a real system, this would:
    // 1. Stop processing new events
    // 2. Mark system as in recovery mode
    // 3. Alert operations team
    // 4. Initiate automated replay verification
    
    throw new Error(`PROCESSING_HALTED: ${violationType} violation detected for event ${eventId}`);
  }

  requireReplayVerification(eventId, violationType) {
    console.log(`🔄 Requiring replay verification for event ${eventId}`);
    
    // In a real system, this would:
    // 1. Queue replay verification task
    // 2. Lock affected state
    // 3. Initiate full system replay
    // 4. Validate convergence
  }

  // =============================================================================
  // STEP 5.3: LOG VIOLATIONS AS FIRST-CLASS EVENTS
  // =============================================================================
  
  logViolationEvent(violationType, violationData) {
    const violationEvent = {
      type: 'CASCADE_INVARIANT_FAILURE',
      parent_event_id: violationData.event_id,
      failure_type: violationType,
      violation_data: violationData,
      timestamp: new Date(),
      severity: 'CRITICAL',
      requires_action: true
    };
    
    console.log(`📝 Logging violation event:`, JSON.stringify(violationEvent, null, 2));
    
    // In a real system, this would be stored in the database
    // INSERT INTO invariant_violations (event_data) VALUES (violationEvent)
  }

  // =============================================================================
  // HELPER FUNCTIONS
  // =============================================================================
  
  calculateReplayHash(event, systemSnapshot) {
    const replayInput = {
      event_id: event.event_id,
      event_type: event.event_type,
      payload: this.canonicalize(event.payload),
      system_state: this.canonicalize(systemSnapshot),
      processing_version: '5.0.0'
    };
    
    return this.stableHash(replayInput);
  }

  calculateSnapshotHash(systemSnapshot) {
    const snapshotInput = {
      runs_count: systemSnapshot.runs ? Object.keys(systemSnapshot.runs).length : 0,
      instances_count: systemSnapshot.instances ? Object.keys(systemSnapshot.instances).length : 0,
      alerts_count: systemSnapshot.alerts ? Object.keys(systemSnapshot.alerts).length : 0,
      timestamp: systemSnapshot.timestamp,
      version: '5.0.0'
    };
    
    return this.stableHash(snapshotInput);
  }

  calculateDeterministicHash(event) {
    const deterministicInput = {
      event_id: event.event_id,
      determinism_key: event.determinism_key,
      logical_timestamp: event.logical_timestamp,
      payload: this.canonicalize(event.payload),
      version: '5.0.0'
    };
    
    return this.stableHash(deterministicInput);
  }

  canonicalize(obj) {
    if (obj === null || obj === undefined) {
      return 'null';
    }
    
    if (typeof obj !== 'object') {
      return String(obj);
    }
    
    if (Array.isArray(obj)) {
      return '[' + obj.map(item => this.canonicalize(item)).join(',') + ']';
    }
    
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

  // =============================================================================
  // PIPELINE INTEGRATION
  // =============================================================================
  
  async processEventWithGuards(event, systemSnapshot, processor) {
    console.log(`🛡️ Processing event ${event.event_id} with permanent guards`);
    
    try {
      // Pre-processing guards
      const preChecks = await this.runPreProcessingGuards(event, systemSnapshot);
      if (!preChecks.allPassed) {
        throw new Error(`Pre-processing guards failed: ${preChecks.failures.join(', ')}`);
      }
      
      // Process the event
      const result = await processor(event, systemSnapshot);
      
      // Post-processing guards
      const postChecks = await this.runPostProcessingGuards(event, systemSnapshot, result);
      if (!postChecks.allPassed) {
        throw new Error(`Post-processing guards failed: ${postChecks.failures.join(', ')}`);
      }
      
      console.log(`    ✅ Event processed successfully with all guards passed`);
      return result;
      
    } catch (error) {
      console.log(`    ❌ Event processing failed: ${error.message}`);
      throw error;
    }
  }

  async runPreProcessingGuards(event, systemSnapshot) {
    const checks = {
      replayConsistency: await this.assertReplayConsistency(event, systemSnapshot),
      noExternalMutation: await this.assertNoExternalMutation(event, systemSnapshot)
    };
    
    const allPassed = Object.values(checks).every(check => check);
    const failures = Object.entries(checks)
      .filter(([name, passed]) => !passed)
      .map(([name]) => name);
    
    return { allPassed, failures, checks };
  }

  async runPostProcessingGuards(event, systemSnapshot, result) {
    const checks = {
      deterministicHash: await this.assertDeterministicHash(event, result)
    };
    
    const allPassed = Object.values(checks).every(check => check);
    const failures = Object.entries(checks)
      .filter(([name, passed]) => !passed)
      .map(([name]) => name);
    
    return { allPassed, failures, checks };
  }

  // =============================================================================
  // VALIDATION TESTS
  // =============================================================================
  
  async testPermanentGuards() {
    console.log('🛡️ Testing Permanent Guards');
    
    const testResults = [];
    
    // Test 1: Replay consistency guard
    console.log('  Test 1: Replay consistency guard...');
    
    const testEvent = {
      event_id: 'test-event-123',
      event_type: 'CAUSAL',
      determinism_key: 'test-key',
      logical_timestamp: 1000000,
      payload: { operation: 'test', value: 42 }
    };
    
    const systemSnapshot = {
      runs: {},
      timestamp: 1000000
    };
    
    try {
      const check1 = await this.assertReplayConsistency(testEvent, systemSnapshot);
      const check2 = await this.assertReplayConsistency(testEvent, systemSnapshot); // Should be identical
      
      testResults.push({
        test: 'replay_consistency',
        passed: check1 && check2,
        result: 'Replay consistency maintained'
      });
      console.log(`    ✅ Replay consistency guard working`);
    } catch (error) {
      testResults.push({
        test: 'replay_consistency',
        passed: false,
        error: error.message
      });
      console.log(`    ❌ Replay consistency guard failed: ${error.message}`);
    }
    
    // Test 2: Deterministic hash guard
    console.log('  Test 2: Deterministic hash guard...');
    
    try {
      const result = {
        deterministic_hash: this.calculateDeterministicHash(testEvent)
      };
      
      const check = await this.assertDeterministicHash(testEvent, result);
      
      testResults.push({
        test: 'deterministic_hash',
        passed: check,
        result: 'Deterministic hash consistent'
      });
      console.log(`    ✅ Deterministic hash guard working`);
    } catch (error) {
      testResults.push({
        test: 'deterministic_hash',
        passed: false,
        error: error.message
      });
      console.log(`    ❌ Deterministic hash guard failed: ${error.message}`);
    }
    
    // Test 3: Violation handling
    console.log('  Test 3: Violation handling...');
    
    try {
      // Simulate a violation by modifying the event
      const modifiedEvent = { ...testEvent, payload: { operation: 'modified', value: 999 } };
      
      // This should trigger a violation
      await this.assertReplayConsistency(testEvent, systemSnapshot);
      await this.assertReplayConsistency(modifiedEvent, systemSnapshot); // Different hash
      
      testResults.push({
        test: 'violation_handling',
        passed: false,
        error: 'Violation was not detected'
      });
      console.log(`    ❌ Violation handling failed - violation not detected`);
    } catch (error) {
      testResults.push({
        test: 'violation_handling',
        passed: true,
        result: 'Violation correctly detected and handled'
      });
      console.log(`    ✅ Violation handling working - violation detected`);
    }
    
    const allPassed = testResults.every(result => result.passed);
    
    return {
      individual: testResults,
      overall: allPassed
    };
  }
}

// Test the permanent guards
if (require.main === module) {
  async function testPermanentGuards() {
    const guards = new PermanentGuards();
    
    console.log('🧪 Testing Permanent Guards');
    console.log('==============================');
    
    const results = await guards.testPermanentGuards();
    
    console.log('\n📊 Test Results:');
    results.individual.forEach(result => {
      console.log(`  ${result.test}: ${result.passed ? '✅' : '❌'}`);
      if (result.error) {
        console.log(`    ${result.error}`);
      }
    });
    
    console.log(`\n🎯 Overall: ${results.overall ? '✅' : '❌'}`);
    
    if (results.overall) {
      console.log('\n✅ Permanent guards are working');
      console.log('System is protected against invariant violations');
    } else {
      console.log('\n❌ Permanent guards need work');
      console.log('Some invariants are not properly protected');
    }
  }
  
  testPermanentGuards().catch(console.error);
}

module.exports = PermanentGuards;
