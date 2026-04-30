// CAUSAL EXECUTOR - SINGLE MUTATION INTERFACE
// All state mutations must go through this interface
// Direct database writes are impossible or rejected

const { v4: uuidv4 } = require('uuid');

class CausalExecutor {
  constructor() {
    this.currentEventId = null;
    this.mutationQueue = [];
    this.isProcessing = false;
  }

  // =============================================================================
  // SINGLE MUTATION INTERFACE - THE ONLY WAY TO MUTATE STATE
  // =============================================================================
  
  async mutateState(event, mutationFn) {
    if (!event || !event.event_id) {
      throw new Error('CAUSAL_CAPUTRE_VIOLATION: Event required for state mutation');
    }
    
    if (!this.isValidEvent(event)) {
      throw new Error('CAUSAL_CAPUTRE_VIOLATION: Invalid event for state mutation');
    }
    
    // Set causal context for this operation
    this.currentEventId = event.event_id;
    
    try {
      // Execute the mutation function with causal context
      const result = await this.executeWithCausalContext(event, mutationFn);
      
      // Validate the mutation didn't violate causality
      this.validateMutationResult(result);
      
      return result;
      
    } finally {
      // Clear causal context
      this.currentEventId = null;
    }
  }

  // =============================================================================
  // CAUSAL CONTEXT MANAGEMENT
  // =============================================================================
  
  isValidEvent(event) {
    return event && 
           event.event_id && 
           event.event_type === 'CAUSAL' &&
           event.processing_status === 'committed' &&
           !event.causality_violation;
  }

  async executeWithCausalContext(event, mutationFn) {
    // Create execution context with event
    const context = {
      event_id: event.event_id,
      logical_timestamp: event.logical_clock || event.decision_time,
      determinism_key: event.determinism_key,
      causal_parent_id: event.causal_parent_id,
      causality_chain_id: event.causality_chain_id
    };
    
    // Execute mutation with causal context
    return await mutationFn(context);
  }

  validateMutationResult(result) {
    // Ensure the mutation result references the current event
    if (result && typeof result === 'object') {
      if (!result.causal_event_id) {
        result.causal_event_id = this.currentEventId;
      }
      
      if (result.causal_event_id !== this.currentEventId) {
        throw new Error('CAUSAL_CAPTURE_VIOLATION: Mutation result references wrong event');
      }
    }
  }

  // =============================================================================
  // DATABASE OPERATIONS - ALL GO THROUGH CAUSAL INTERFACE
  // =============================================================================
  
  async insert(table, data) {
    this.ensureCausalContext();
    
    const mutation = {
      operation: 'INSERT',
      table: table,
      data: {
        ...data,
        causal_event_id: this.currentEventId,
        created_at: new Date()
      }
    };
    
    return await this.executeMutation(mutation);
  }

  async update(table, filter, data) {
    this.ensureCausalContext();
    
    const mutation = {
      operation: 'UPDATE',
      table: table,
      filter: filter,
      data: {
        ...data,
        causal_event_id: this.currentEventId,
        updated_at: new Date()
      }
    };
    
    return await this.executeMutation(mutation);
  }

  async delete(table, filter) {
    this.ensureCausalContext();
    
    const mutation = {
      operation: 'DELETE',
      table: table,
      filter: filter
    };
    
    return await this.executeMutation(mutation);
  }

  ensureCausalContext() {
    if (!this.currentEventId) {
      throw new Error('CAUSAL_CAPTURE_VIOLATION: Database operation attempted without causal context');
    }
  }

  async executeMutation(mutation) {
    // In a real implementation, this would call the database
    // through the single mutation interface function we created
    console.log(`Executing mutation: ${mutation.operation} on ${mutation.table}`);
    console.log(`Causal event ID: ${this.currentEventId}`);
    
    // Simulate database call
    const result = {
      success: true,
      records_affected: 1,
      operation: mutation.operation,
      table: mutation.table,
      causal_event_id: this.currentEventId
    };
    
    return result;
  }

  // =============================================================================
  // VALIDATION TESTS
  // =============================================================================
  
  async testCausalCaptureEnforcement() {
    console.log('🔒 Testing Causal Capture Enforcement');
    
    const results = [];
    
    // Test 1: Direct mutation without event -> MUST fail
    try {
      this.currentEventId = null; // No causal context
      await this.insert('chaos_runs', { name: 'Test_Run_Direct', status: 'running' });
      
      results.push({
        test: 'direct_mutation_without_event',
        expected: false,
        actual: false, // Should have failed
        passed: false,
        error: 'Direct mutation was NOT rejected'
      });
      
    } catch (error) {
      results.push({
        test: 'direct_mutation_without_event',
        expected: false,
        actual: false, // Failed as expected
        passed: true,
        error: 'Correctly rejected: ' + error.message
      });
    }
    
    // Test 2: Valid event mutation -> MUST pass
    try {
      const validEvent = {
        event_id: uuidv4(),
        event_type: 'CAUSAL',
        processing_status: 'committed',
        causality_violation: false,
        logical_clock: 1,
        determinism_key: 'test_key'
      };
      
      const result = await this.mutateState(validEvent, async (context) => {
        return await this.insert('chaos_runs', { name: 'Test_Run_Valid', status: 'running' });
      });
      
      results.push({
        test: 'valid_event_mutation',
        expected: true,
        actual: result.success,
        passed: result.success,
        error: result.success ? null : 'Valid event mutation failed'
      });
      
    } catch (error) {
      results.push({
        test: 'valid_event_mutation',
        expected: true,
        actual: false,
        passed: false,
        error: 'Valid event mutation failed: ' + error.message
      });
    }
    
    // Test 3: Invalid event mutation -> MUST fail
    try {
      const invalidEvent = {
        event_id: uuidv4(),
        event_type: 'CAUSAL',
        processing_status: 'failed', // Invalid status
        causality_violation: true, // Violation flag
        logical_clock: 1,
        determinism_key: 'test_key'
      };
      
      await this.mutateState(invalidEvent, async (context) => {
        return await this.insert('chaos_runs', { name: 'Test_Run_Invalid', status: 'running' });
      });
      
      results.push({
        test: 'invalid_event_mutation',
        expected: false,
        actual: false, // Should have failed
        passed: false,
        error: 'Invalid event mutation was NOT rejected'
      });
      
    } catch (error) {
      results.push({
        test: 'invalid_event_mutation',
        expected: false,
        actual: false, // Failed as expected
        passed: true,
        error: 'Correctly rejected: ' + error.message
      });
    }
    
    return results;
  }

  // =============================================================================
  // HELPER FUNCTIONS
  // =============================================================================
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export for use in other modules
module.exports = CausalExecutor;

// Test the executor
if (require.main === module) {
  async function testCausalExecutor() {
    const executor = new CausalExecutor();
    
    console.log('🧪 Testing Causal Executor');
    console.log('==========================');
    
    const results = await executor.testCausalCaptureEnforcement();
    
    console.log('\n📊 Test Results:');
    results.forEach(result => {
      console.log(`  ${result.test}: ${result.passed ? '✅ PASSED' : '❌ FAILED'}`);
      if (result.error) {
        console.log(`    ${result.error}`);
      }
    });
    
    const passedTests = results.filter(r => r.passed).length;
    const totalTests = results.length;
    
    console.log(`\n🎯 Overall: ${passedTests}/${totalTests} tests passed`);
    
    if (passedTests === totalTests) {
      console.log('✅ Causal capture enforcement is working');
    } else {
      console.log('❌ Causal capture enforcement needs work');
    }
  }
  
  testCausalExecutor().catch(console.error);
}
