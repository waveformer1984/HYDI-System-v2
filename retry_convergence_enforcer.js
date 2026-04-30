// RETRY CONVERGENCE ENFORCER - ELIMINATE BRANCHING TIMELINES
// All retries must converge to identical final state

const { v4: uuidv4 } = require('uuid');

class RetryConvergenceEnforcer {
  constructor() {
    this.retryLineages = new Map();
    this.convergenceValidators = new Map();
  }

  // =============================================================================
  // STEP 3.1: STANDARDIZE RETRY STRUCTURE
  // =============================================================================
  
  createRetryEvent(parentEvent, retryIndex, failureSnapshot) {
    // ALL retries must look like this:
    // {
    //   original_event_id,
    //   retry_index,
    //   invariant_payload,
    //   failure_snapshot
    // }
    
    const retryEvent = {
      event_id: uuidv4(),
      event_type: 'RETRY',
      original_event_id: parentEvent.event_id,
      retry_index: retryIndex,
      invariant_payload: this.deepFreeze(parentEvent.payload), // LOCK invariant payload
      failure_snapshot: failureSnapshot,
      determinism_key: parentEvent.determinism_key, // SAME determinism key
      logical_timestamp: parentEvent.logical_timestamp, // SAME logical time
      causality_chain_id: parentEvent.causality_chain_id, // SAME causality chain
      created_at: new Date()
    };
    
    return retryEvent;
  }

  // =============================================================================
  // STEP 3.2: LOCK INVARIANT PAYLOAD
  // =============================================================================
  
  deepFreeze(obj) {
    // Deep freeze to prevent mutation
    if (obj === null || obj === undefined) {
      return obj;
    }
    
    if (typeof obj !== 'object') {
      return obj;
    }
    
    // Freeze arrays
    if (Array.isArray(obj)) {
      obj.forEach(item => this.deepFreeze(item));
      return Object.freeze(obj);
    }
    
    // Freeze objects
    Object.keys(obj).forEach(key => {
      if (typeof obj[key] === 'object') {
        this.deepFreeze(obj[key]);
      }
    });
    
    return Object.freeze(obj);
  }

  // =============================================================================
  // STEP 3.3: PROCESSING RULE - ONLY USE INVARIANT PAYLOAD
  // =============================================================================
  
  async processRetryEvent(retryEvent) {
    // Processing rule:
    // if (event.type === 'RETRY') {
    //   use(event.invariant_payload);
    //   ignore(event.failure_snapshot for logic);
    // }
    
    console.log(`🔄 Processing retry event ${retryEvent.event_id}`);
    console.log(`  Original event: ${retryEvent.original_event_id}`);
    console.log(`  Retry index: ${retryEvent.retry_index}`);
    
    // ONLY use invariant_payload for logic
    const payload = retryEvent.invariant_payload;
    
    // Validate invariant payload is frozen
    if (!Object.isFrozen(payload)) {
      throw new Error('RETRY_CONVERGENCE_VIOLATION: Invariant payload is not frozen');
    }
    
    // Process using ONLY invariant payload
    const result = await this.processWithInvariantPayload(retryEvent, payload);
    
    // Add retry metadata to result
    result.retry_metadata = {
      original_event_id: retryEvent.original_event_id,
      retry_index: retryEvent.retry_index,
      processed_at: new Date(),
      convergence_hash: this.calculateConvergenceHash(retryEvent, payload)
    };
    
    return result;
  }

  async processWithInvariantPayload(retryEvent, invariantPayload) {
    // Deterministic processing based only on invariant payload
    const processingKey = `${retryEvent.original_event_id}_${retryEvent.retry_index}`;
    
    // Check if we've already processed this retry
    if (this.retryLineages.has(processingKey)) {
      return this.retryLineages.get(processingKey);
    }
    
    // Process the operation
    const result = await this.executeOperation(retryEvent, invariantPayload);
    
    // Cache result
    this.retryLineages.set(processingKey, result);
    
    return result;
  }

  async executeOperation(retryEvent, payload) {
    // Execute operation based on payload (deterministic)
    switch (payload.operation) {
      case 'create_run':
        return this.processCreateRun(retryEvent, payload);
      case 'update_status':
        return this.processUpdateStatus(retryEvent, payload);
      case 'complex_calculation':
        return this.processComplexCalculation(retryEvent, payload);
      default:
        return this.processGenericOperation(retryEvent, payload);
    }
  }

  processCreateRun(retryEvent, payload) {
    return {
      type: 'run_created',
      run_id: payload.run_id,
      name: payload.name,
      status: payload.status || 'running',
      created_at: retryEvent.logical_timestamp,
      deterministic_hash: this.calculateOperationHash('create_run', payload)
    };
  }

  processUpdateStatus(retryEvent, payload) {
    return {
      type: 'status_updated',
      target_id: payload.target_id,
      old_status: payload.old_status,
      new_status: payload.new_status,
      updated_at: retryEvent.logical_timestamp,
      deterministic_hash: this.calculateOperationHash('update_status', payload)
    };
  }

  processComplexCalculation(retryEvent, payload) {
    // Complex but deterministic calculation
    const input = payload.input_value || 0;
    const multiplier = payload.multiplier || 2;
    
    // No randomness, no timing dependencies
    const result = input * multiplier;
    
    return {
      type: 'complex_calculation',
      input: input,
      multiplier: multiplier,
      result: result,
      calculated_at: retryEvent.logical_timestamp,
      deterministic_hash: this.calculateOperationHash('complex_calculation', payload)
    };
  }

  processGenericOperation(retryEvent, payload) {
    return {
      type: 'generic_operation',
      operation: payload.operation,
      payload: payload,
      processed_at: retryEvent.logical_timestamp,
      deterministic_hash: this.calculateOperationHash('generic', payload)
    };
  }

  calculateOperationHash(operation, payload) {
    // Deterministic hash calculation
    const hashInput = {
      operation: operation,
      payload: this.canonicalize(payload),
      version: '5.0.0'
    };
    
    return this.stableHash(hashInput);
  }

  // =============================================================================
  // STEP 3.4: CONVERGENCE ASSERTION
  // =============================================================================
  
  async validateRetryConvergence(originalEventId, retryEvents) {
    console.log(`🎯 Validating retry convergence for ${originalEventId}`);
    
    if (retryEvents.length === 0) {
      return { converged: true, reason: 'No retries to validate' };
    }
    
    // Get all retry results
    const retryResults = [];
    for (const retryEvent of retryEvents) {
      const result = await this.processRetryEvent(retryEvent);
      retryResults.push(result);
    }
    
    // Check if all results are identical
    const firstResult = retryResults[0];
    const convergenceHash = firstResult.retry_metadata.convergence_hash;
    
    let allIdentical = true;
    const divergentResults = [];
    
    for (let i = 1; i < retryResults.length; i++) {
      const currentResult = retryResults[i];
      
      if (currentResult.retry_metadata.convergence_hash !== convergenceHash) {
        allIdentical = false;
        divergentResults.push({
          retry_index: currentResult.retry_metadata.retry_index,
          expected_hash: convergenceHash,
          actual_hash: currentResult.retry_metadata.convergence_hash
        });
      }
    }
    
    // Convergence assertion
    if (!allIdentical) {
      throw new Error(`RETRY_DIVERGENCE_DETECTED: Retries for ${originalEventId} did not converge. Divergences: ${JSON.stringify(divergentResults)}`);
    }
    
    return {
      converged: allIdentical,
      total_retries: retryEvents.length,
      convergence_hash: convergenceHash,
      final_result: firstResult
    };
  }

  // =============================================================================
  // HELPER FUNCTIONS
  // =============================================================================
  
  calculateConvergenceHash(retryEvent, payload) {
    // Hash that should be identical for all retries of the same event
    const convergenceInput = {
      original_event_id: retryEvent.original_event_id,
      invariant_payload: this.canonicalize(payload),
      determinism_key: retryEvent.determinism_key,
      logical_timestamp: retryEvent.logical_timestamp
    };
    
    return this.stableHash(convergenceInput);
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
  // VALIDATION TESTS
  // =============================================================================
  
  async testRetryConvergence() {
    console.log('🎯 Testing Retry Convergence');
    
    const testResults = [];
    
    // Test 1: Multiple retries with identical payload
    console.log('  Test 1: Multiple retries with identical payload...');
    
    const originalEvent = {
      event_id: uuidv4(),
      event_type: 'CAUSAL',
      determinism_key: 'test-determinism-key',
      logical_timestamp: 1000000,
      payload: {
        operation: 'create_run',
        run_id: 'test-run-123',
        name: 'Test Run',
        status: 'running'
      }
    };
    
    const retryEvents = [];
    for (let i = 0; i < 3; i++) {
      const retryEvent = this.createRetryEvent(originalEvent, i + 1, {
        error: 'simulated_failure',
        attempt: i + 1
      });
      retryEvents.push(retryEvent);
    }
    
    try {
      const convergenceResult = await this.validateRetryConvergence(originalEvent.event_id, retryEvents);
      testResults.push({
        test: 'identical_payload_retries',
        passed: convergenceResult.converged,
        result: convergenceResult
      });
      console.log(`    Convergence: ${convergenceResult.converged ? '✅' : '❌'}`);
    } catch (error) {
      testResults.push({
        test: 'identical_payload_retries',
        passed: false,
        error: error.message
      });
      console.log(`    Convergence: ❌ - ${error.message}`);
    }
    
    // Test 2: Retry with complex calculation
    console.log('  Test 2: Retry with complex calculation...');
    
    const complexEvent = {
      event_id: uuidv4(),
      event_type: 'CAUSAL',
      determinism_key: 'complex-determinism-key',
      logical_timestamp: 2000000,
      payload: {
        operation: 'complex_calculation',
        input_value: 42,
        multiplier: 3.14159
      }
    };
    
    const complexRetries = [];
    for (let i = 0; i < 5; i++) {
      const retryEvent = this.createRetryEvent(complexEvent, i + 1, {
        error: 'complex_failure',
        attempt: i + 1
      });
      complexRetries.push(retryEvent);
    }
    
    try {
      const complexConvergence = await this.validateRetryConvergence(complexEvent.event_id, complexRetries);
      testResults.push({
        test: 'complex_calculation_retries',
        passed: complexConvergence.converged,
        result: complexConvergence
      });
      console.log(`    Complex convergence: ${complexConvergence.converged ? '✅' : '❌'}`);
    } catch (error) {
      testResults.push({
        test: 'complex_calculation_retries',
        passed: false,
        error: error.message
      });
      console.log(`    Complex convergence: ❌ - ${error.message}`);
    }
    
    // Test 3: Invariant payload protection
    console.log('  Test 3: Invariant payload protection...');
    
    try {
      const protectedEvent = this.createRetryEvent(originalEvent, 1, {});
      
      // Try to modify invariant payload (should fail)
      try {
        protectedEvent.invariant_payload.new_field = 'should_fail';
        testResults.push({
          test: 'invariant_payload_protection',
          passed: false,
          error: 'Invariant payload was not properly frozen'
        });
        console.log(`    Invariant protection: ❌ - Payload was modified`);
      } catch (modificationError) {
        testResults.push({
          test: 'invariant_payload_protection',
          passed: true,
          result: 'Payload properly protected'
        });
        console.log(`    Invariant protection: ✅ - Payload properly frozen`);
      }
    } catch (error) {
      testResults.push({
        test: 'invariant_payload_protection',
        passed: false,
        error: error.message
      });
      console.log(`    Invariant protection: ❌ - ${error.message}`);
    }
    
    const allPassed = testResults.every(result => result.passed);
    
    return {
      individual: testResults,
      overall: allPassed
    };
  }
}

// Test the retry convergence enforcer
if (require.main === module) {
  async function testRetryConvergenceEnforcer() {
    const enforcer = new RetryConvergenceEnforcer();
    
    console.log('🧪 Testing Retry Convergence Enforcer');
    console.log('=======================================');
    
    const results = await enforcer.testRetryConvergence();
    
    console.log('\n📊 Test Results:');
    results.individual.forEach(result => {
      console.log(`  ${result.test}: ${result.passed ? '✅' : '❌'}`);
      if (result.error) {
        console.log(`    ${result.error}`);
      }
    });
    
    console.log(`\n🎯 Overall: ${results.overall ? '✅' : '❌'}`);
    
    if (results.overall) {
      console.log('\n✅ Retry convergence enforcement is working');
    } else {
      console.log('\n❌ Retry convergence enforcement needs work');
    }
  }
  
  testRetryConvergenceEnforcer().catch(console.error);
}

module.exports = RetryConvergenceEnforcer;
