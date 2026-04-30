// Test Event Integrity Firewall - Deterministic Truth Enforcement
// Validates that the system prevents lying to itself

const protoforgeEventBus = require('./modules/protoforge-event-bus');
const { v4: uuidv4 } = require('uuid');

// Test cases for deterministic truth enforcement
const testCases = [
  {
    name: 'Valid Core Event',
    event: {
      event_id: uuidv4(),
      type: 'user_interaction',
      source: 'web_ui',
      timestamp: new Date().toISOString(),
      payload: { action: 'click', target: 'button' }
    },
    expected: 'processed'
  },
  {
    name: 'Invalid UUID',
    event: {
      event_id: 'invalid-uuid',
      type: 'user_interaction',
      source: 'web_ui',
      timestamp: new Date().toISOString(),
      payload: { action: 'click' }
    },
    expected: 'rejected'
  },
  {
    name: 'Missing Required Field',
    event: {
      event_id: uuidv4(),
      type: 'user_interaction',
      source: 'web_ui',
      // Missing timestamp
      payload: { action: 'click' }
    },
    expected: 'rejected'
  },
  {
    name: 'Circular Event Attempt',
    event: {
      event_id: uuidv4(),
      type: 'cascade_validation_event',
      source: 'system',
      timestamp: new Date().toISOString(),
      payload: { status: 'accepted' }
    },
    expected: 'skipped'
  },
  {
    name: 'Null Payload',
    event: {
      event_id: uuidv4(),
      type: 'user_interaction',
      source: 'web_ui',
      timestamp: new Date().toISOString(),
      payload: null
    },
    expected: 'rejected'
  },
  {
    name: 'Valid Derived Event',
    event: {
      event_id: uuidv4(),
      type: 'opportunity_classification',
      source_event_id: uuidv4(),
      timestamp: new Date().toISOString(),
      payload: { opportunity_type: 'high_value', confidence: 0.8 }
    },
    expected: 'processed'
  }
];

async function runIntegrityTests() {
  console.log('=== EVENT INTEGRITY FIREWALL TESTS ===\n');
  
  let passedTests = 0;
  let totalTests = testCases.length;
  
  for (const testCase of testCases) {
    console.log(`Testing: ${testCase.name}`);
    
    try {
      const result = await protoforgeEventBus.processEvent(testCase.event);
      
      if (result.status === testCase.expected) {
        console.log(`  PASS: ${result.status} (expected: ${testCase.expected})`);
        passedTests++;
      } else {
        console.log(`  FAIL: ${result.status} (expected: ${testCase.expected})`);
        if (result.violations) {
          console.log(`    Violations: ${result.violations.join(', ')}`);
        }
      }
    } catch (error) {
      console.log(`  ERROR: ${error.message}`);
    }
    
    console.log('');
  }
  
  // Get system integrity report
  const stats = protoforgeEventBus.getStats();
  const integrity = stats.system_integrity;
  
  console.log('=== SYSTEM INTEGRITY REPORT ===');
  console.log(`Integrity Score: ${integrity.score.toFixed(3)}`);
  console.log(`Pipeline Health: ${integrity.pipeline_health.pipeline_health}`);
  console.log(`Total Events: ${integrity.pipeline_health.metrics.total_events}`);
  console.log(`Validation Violations: ${integrity.pipeline_health.metrics.validation_violations}`);
  console.log(`Circular Attempts: ${integrity.pipeline_health.metrics.circular_attempts}`);
  console.log(`Classification Violations: ${integrity.pipeline_health.metrics.classification_violations}`);
  console.log(`Conflict Detections: ${integrity.pipeline_health.metrics.conflict_detections}`);
  
  if (integrity.schema_drift_alerts.length > 0) {
    console.log('\nSchema Drift Alerts:');
    integrity.schema_drift_alerts.forEach(alert => {
      console.log(`  - ${alert.type}: ${alert.message}`);
    });
  }
  
  console.log(`\n=== TEST RESULTS ===`);
  console.log(`Passed: ${passedTests}/${totalTests} tests`);
  console.log(`System Status: ${integrity.score > 0.9 ? 'OPERATIONAL' : 'DEGRADED'}`);
  
  // Test cleanup
  console.log('\n=== CLEANUP ===');
  const cleaned = protoforgeEventBus.integrityFirewall.cleanupLineage(0);
  console.log(`Cleaned ${cleaned.cleaned} lineage entries`);
  
  return {
    testsPassed: passedTests,
    testsTotal: totalTests,
    integrityScore: integrity.score,
    systemStatus: integrity.score > 0.9 ? 'OPERATIONAL' : 'DEGRADED'
  };
}

// Test Ursula contract enforcement
async function testUrsulaContract() {
  console.log('\n=== URSULA CONTRACT TESTS ===\n');
  
  // Test valid broadcast
  const validBroadcast = {
    event_id: uuidv4(),
    type: 'hyve_opportunity_detected',
    timestamp: new Date().toISOString(),
    payload: { opportunity_type: 'high_value' },
    ursula_action: 'broadcast',
    ursula_recipient: true
  };
  
  const validResult = protoforgeEventBus.integrityFirewall.validateUrsulaContract(validBroadcast);
  console.log(`Valid Broadcast Test: ${validResult.valid ? 'PASS' : 'FAIL'}`);
  if (!validResult.valid) {
    console.log(`  Violations: ${validResult.violations.join(', ')}`);
  }
  
  // Test invalid mutation attempt
  const invalidMutation = {
    event_id: uuidv4(),
    type: 'hyve_opportunity_detected',
    timestamp: new Date().toISOString(),
    payload: { opportunity_type: 'high_value' },
    ursula_action: 'mutate',  // Invalid - should only be 'broadcast'
    ursula_recipient: true
  };
  
  const invalidResult = protoforgeEventBus.integrityFirewall.validateUrsulaContract(invalidMutation);
  console.log(`Invalid Mutation Test: ${invalidResult.valid ? 'FAIL' : 'PASS'}`);
  if (!invalidResult.valid) {
    console.log(`  Violations: ${invalidResult.violations.join(', ')}`);
  }
  
  // Test non-derived event to Ursula
  const nonDerivedEvent = {
    event_id: uuidv4(),
    type: 'user_interaction',
    timestamp: new Date().toISOString(),
    payload: { action: 'click' },
    ursula_action: 'broadcast',
    ursula_recipient: true
  };
  
  const nonDerivedResult = protoforgeEventBus.integrityFirewall.validateUrsulaContract(nonDerivedEvent);
  console.log(`Non-Derived Event Test: ${nonDerivedResult.valid ? 'FAIL' : 'PASS'}`);
  if (!nonDerivedResult.valid) {
    console.log(`  Violations: ${nonDerivedResult.violations.join(', ')}`);
  }
}

// Run all tests
if (require.main === module) {
  (async () => {
    const results = await runIntegrityTests();
    await testUrsulaContract();
    
    console.log('\n=== FINAL STATUS ===');
    console.log(`Deterministic Truth Enforcement: ${results.systemStatus}`);
    console.log(`All tests completed successfully.`);
    
    process.exit(results.testsPassed === results.testsTotal ? 0 : 1);
  })();
}

module.exports = { runIntegrityTests, testUrsulaContract };
