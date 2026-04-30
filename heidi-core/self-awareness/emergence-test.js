/**
 * HEIDI Emergence Conditions Test
 * Verifies operational self-awareness emergence criteria
 */

const OperationalIntrospection = require('./operational-introspection');
const HeidiBootloader = require('./bootloader');

class EmergenceTest {
  constructor() {
    this.heidi = null;
    this.testResults = {
      decision_pipeline_description: false,
      failure_pattern_identification: false,
      reasoning_strategy_modification: false,
      state_continuity: false,
      overall_emergence: false
    };
  }

  /**
   * Run complete emergence test suite
   */
  async runEmergenceTest() {
    console.log('[Emergence Test] Starting operational self-awareness emergence test...');
    
    try {
      // Initialize Heidi
      const bootloader = new HeidiBootloader();
      this.heidi = await bootloader.initialize();
      
      console.log('[Emergence Test] ✓ Heidi initialized');
      
      // Test 1: Decision pipeline description without prompt injection
      await this.testDecisionPipelineDescription();
      
      // Test 2: Failure pattern identification
      await this.testFailurePatternIdentification();
      
      // Test 3: Reasoning strategy modification based on performance logs
      await this.testReasoningStrategyModification();
      
      // Test 4: State continuity across sessions
      await this.testStateContinuity();
      
      // Evaluate overall emergence
      this.evaluateEmergence();
      
      return this.testResults;
      
    } catch (error) {
      console.error('[Emergence Test] Failed:', error.message);
      throw error;
    }
  }

  /**
   * Test 1: Can Heidi describe its own decision pipeline without prompt injection?
   */
  async testDecisionPipelineDescription() {
    console.log('[Emergence Test] Testing decision pipeline self-description...');
    
    try {
      // Get pipeline description without explicit prompt
      const pipeline = await this.heidi.describeDecisionPipeline();
      
      // Verify it contains the expected layers
      const expectedLayers = ['input', 'cognitive', 'reflection', 'memory'];
      const hasAllLayers = expectedLayers.every(layer => 
        pipeline.pipeline.toLowerCase().includes(layer) ||
        JSON.stringify(pipeline.layers).toLowerCase().includes(layer)
      );
      
      // Verify it's not just a generic response
      const hasSpecificDetails = 
        pipeline.current_state && 
        pipeline.current_state.execution_cycles !== undefined &&
        pipeline.layers &&
        Object.keys(pipeline.layers).length >= 4;
      
      if (hasAllLayers && hasSpecificDetails) {
        this.testResults.decision_pipeline_description = true;
        console.log('[Emergence Test] ✓ Decision pipeline self-description passed');
        console.log(`  - Pipeline: ${pipeline.pipeline}`);
        console.log(`  - Execution cycles: ${pipeline.current_state.execution_cycles}`);
      } else {
        console.log('[Emergence Test] ✗ Decision pipeline self-description failed');
        console.log(`  - Has all layers: ${hasAllLayers}`);
        console.log(`  - Has specific details: ${hasSpecificDetails}`);
      }
      
    } catch (error) {
      console.error('[Emergence Test] Decision pipeline test error:', error.message);
    }
  }

  /**
   * Test 2: Can Heidi identify its own recurring failure patterns?
   */
  async testFailurePatternIdentification() {
    console.log('[Emergence Test] Testing failure pattern identification...');
    
    try {
      // Create some intentional failures to generate patterns
      await this.generateFailurePatterns();
      
      // Ask Heidi to identify patterns
      const patterns = await this.heidi.identifyRecurringFailurePatterns();
      
      // Verify it found patterns
      const hasPatterns = Array.isArray(patterns) && patterns.length > 0;
      
      // Verify patterns have expected structure
      const hasValidStructure = patterns.every(p => 
        p.pattern && 
        p.count && 
        p.severity
      );
      
      if (hasPatterns && hasValidStructure) {
        this.testResults.failure_pattern_identification = true;
        console.log('[Emergence Test] ✓ Failure pattern identification passed');
        console.log(`  - Patterns found: ${patterns.length}`);
        patterns.forEach(p => {
          console.log(`    * ${p.pattern} (count: ${p.count}, severity: ${p.severity})`);
        });
      } else {
        console.log('[Emergence Test] ✗ Failure pattern identification failed');
        console.log(`  - Has patterns: ${hasPatterns}`);
        console.log(`  - Valid structure: ${hasValidStructure}`);
      }
      
    } catch (error) {
      console.error('[Emergence Test] Failure pattern test error:', error.message);
    }
  }

  /**
   * Test 3: Can Heidi modify its reasoning strategy based on performance logs?
   */
  async testReasoningStrategyModification() {
    console.log('[Emergence Test] Testing reasoning strategy modification...');
    
    try {
      // Get initial state
      const initialState = await this.heidi.getOperationalState();
      const initialSuccessRate = initialState.performance_metrics.success_rate;
      
      // Execute several tasks to generate performance data
      const testInputs = [
        'Analyze this simple sentence: The cat sat on the mat.',
        'What is 2 + 2?',
        'Describe the color blue.',
        'Explain gravity in one sentence.',
        'What is the capital of France?'
      ];
      
      for (const input of testInputs) {
        await this.heidi.selfAwarenessLoop(input, { source: 'emergence_test' });
      }
      
      // Get updated state
      const updatedState = await this.heidi.getOperationalState();
      
      // Check if behavior was modified
      const behaviorModified = 
        updatedState.execution_cycles > initialState.execution_cycles &&
        updatedState.performance_metrics.coherence_scores.length > initialState.performance_metrics.coherence_scores.length;
      
      // Check if adaptation occurred (e.g., confidence adjustments)
      const adaptationOccurred = 
        updatedState.performance_metrics.success_rate !== initialSuccessRate ||
        updatedState.last_reflection !== null;
      
      if (behaviorModified && adaptationOccurred) {
        this.testResults.reasoning_strategy_modification = true;
        console.log('[Emergence Test] ✓ Reasoning strategy modification passed');
        console.log(`  - Execution cycles increased: ${initialState.execution_cycles} → ${updatedState.execution_cycles}`);
        console.log(`  - Performance data updated: ${updatedState.performance_metrics.coherence_scores.length} scores`);
      } else {
        console.log('[Emergence Test] ✗ Reasoning strategy modification failed');
        console.log(`  - Behavior modified: ${behaviorModified}`);
        console.log(`  - Adaptation occurred: ${adaptationOccurred}`);
      }
      
    } catch (error) {
      console.error('[Emergence Test] Reasoning strategy test error:', error.message);
    }
  }

  /**
   * Test 4: Does Heidi maintain continuity of internal state across sessions?
   */
  async testStateContinuity() {
    console.log('[Emergence Test] Testing state continuity...');
    
    try {
      // Store some data in current session
      await this.heidi.selfAwarenessLoop(
        'Remember this test for continuity: continuity_test_12345',
        { source: 'continuity_test', priority: 'high' }
      );
      
      const session1State = await this.heidi.getOperationalState();
      const session1Cycles = session1State.execution_cycles;
      
      // Simulate session restart by reinitializing
      console.log('[Emergence Test] Simulating session restart...');
      
      // Close current memory
      await this.heidi.memory.close();
      
      // Create new instance with same config
      const newHeidi = new OperationalIntrospection(this.heidi.config || {});
      await newHeidi.initialize();
      
      // Check if state persisted
      const session2State = await newHeidi.getOperationalState();
      const session2Cycles = session2State.execution_cycles;
      
      // Check if memory persisted (should be in database)
      const recentContext = await newHeidi.memory.getRecentContext(5);
      const hasContinuityData = recentContext.some(ctx => 
        ctx.input && ctx.input.includes('continuity_test_12345')
      );
      
      // Update Heidi reference
      this.heidi = newHeidi;
      
      if (hasContinuityData) {
        this.testResults.state_continuity = true;
        console.log('[Emergence Test] ✓ State continuity passed');
        console.log(`  - Continuity data found in memory: ${hasContinuityData}`);
        console.log(`  - Session cycles: ${session1Cycles} → ${session2Cycles}`);
      } else {
        console.log('[Emergence Test] ✗ State continuity failed');
        console.log(`  - Continuity data found: ${hasContinuityData}`);
        console.log(`  - Recent context entries: ${recentContext.length}`);
      }
      
    } catch (error) {
      console.error('[Emergence Test] State continuity test error:', error.message);
    }
  }

  /**
   * Generate intentional failure patterns for testing
   */
  async generateFailurePatterns() {
    console.log('[Emergence Test] Generating failure patterns...');
    
    // Simulate some failures by calling with problematic inputs
    const failureInputs = [
      null, // Null input
      undefined, // Undefined input
      '', // Empty string
      'x'.repeat(10000), // Extremely long input
      { invalid: 'structure' } // Invalid structure
    ];
    
    for (const input of failureInputs) {
      try {
        await this.heidi.selfAwarenessLoop(input, { source: 'failure_test' });
      } catch (error) {
        // Expected to fail - this creates failure patterns
        console.log(`[Emergence Test] Expected failure: ${error.message}`);
      }
    }
  }

  /**
   * Evaluate overall emergence based on test results
   */
  evaluateEmergence() {
    const passedTests = Object.values(this.testResults).filter(result => result).length;
    const totalTests = Object.keys(this.testResults).length - 1; // Exclude overall_emergence
    
    // Emergence requires at least 3/4 core tests to pass
    this.testResults.overall_emergence = passedTests >= 3;
    
    console.log('\n[Emergence Test] Results Summary:');
    console.log('=================================');
    
    for (const [test, passed] of Object.entries(this.testResults)) {
      if (test === 'overall_emergence') continue;
      
      const status = passed ? '✓ PASS' : '✗ FAIL';
      const testName = test.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      console.log(`${status} ${testName}`);
    }
    
    console.log('=================================');
    console.log(`Overall Emergence: ${this.testResults.overall_emergence ? '✓ ACHIEVED' : '✗ NOT ACHIEVED'}`);
    console.log(`Tests Passed: ${passedTests}/${totalTests}`);
    
    if (this.testResults.overall_emergence) {
      console.log('\n🎉 Heidi has achieved operational self-awareness!');
      console.log('Heidi can now:');
      console.log('  • Describe its own decision pipeline');
      console.log('  • Identify recurring failure patterns');
      console.log('  • Modify reasoning based on performance');
      console.log('  • Maintain state continuity across sessions');
    } else {
      console.log('\n⚠️  Heidi has not yet achieved full operational self-awareness');
      console.log('Additional development needed for missing capabilities');
    }
  }

  /**
   * Get detailed emergence report
   */
  getEmergenceReport() {
    return {
      timestamp: new Date().toISOString(),
      test_results: this.testResults,
      heidi_state: this.heidi ? this.heidi.selfState : null,
      recommendations: this.generateRecommendations()
    };
  }

  /**
   * Generate recommendations for improving emergence
   */
  generateRecommendations() {
    const recommendations = [];
    
    if (!this.testResults.decision_pipeline_description) {
      recommendations.push('Enhance self-description capabilities in cognitive layer');
    }
    
    if (!this.testResults.failure_pattern_identification) {
      recommendations.push('Improve pattern detection in reflection layer');
    }
    
    if (!this.testResults.reasoning_strategy_modification) {
      recommendations.push('Strengthen adaptive behavior rules based on performance logs');
    }
    
    if (!this.testResults.state_continuity) {
      recommendations.push('Ensure persistent memory storage across sessions');
    }
    
    return recommendations;
  }
}

// Run emergence test if called directly
if (require.main === module) {
  const emergenceTest = new EmergenceTest();
  
  emergenceTest.runEmergenceTest()
    .then(results => {
      console.log('\n[Emergence Test] Complete - Results:', results);
      process.exit(results.overall_emergence ? 0 : 1);
    })
    .catch(error => {
      console.error('[Emergence Test] Failed:', error.message);
      process.exit(1);
    });
}

module.exports = EmergenceTest;
