// Test script for Cascade Validation Gate
// Tests malformed input validation as specified in the mission

const { CascadeValidator } = require('./modules/cascade');

async function testCascadeValidation() {
  console.log('=== CASCADE VALIDATION GATE TEST ===\n');
  
  const cascade = new CascadeValidator();
  
  // Track test results
  const results = {
    accepted_count: 0,
    rejected_count: 0,
    failure_reasons: []
  };
  
  // Test cases for invalid events
  const testEvents = [
    {
      name: 'Missing timestamp',
      event: {
        event_id: '123e4567-e89b-12d3-a456-426614174000',
        type: 'test_event',
        source: 'test_source',
        payload: { test: 'data' }
        // Missing timestamp
      },
      shouldBeRejected: true
    },
    {
      name: 'Non-UUID event_id',
      event: {
        event_id: '12345', // Not a valid UUID
        type: 'test_event',
        source: 'test_source',
        timestamp: new Date().toISOString(),
        payload: { test: 'data' }
      },
      shouldBeRejected: true
    },
    {
      name: 'Missing payload',
      event: {
        event_id: '123e4567-e89b-12d3-a456-426614174000',
        type: 'test_event',
        source: 'test_source',
        timestamp: new Date().toISOString()
        // Missing payload
      },
      shouldBeRejected: true
    },
    {
      name: 'Unknown event type (empty string)',
      event: {
        event_id: '123e4567-e89b-12d3-a456-426614174000',
        type: '', // Empty string
        source: 'test_source',
        timestamp: new Date().toISOString(),
        payload: { test: 'data' }
      },
      shouldBeRejected: true
    },
    {
      name: 'Valid event (control)',
      event: {
        event_id: '123e4567-e89b-12d3-a456-426614174000',
        type: 'test_event',
        source: 'test_source',
        timestamp: new Date().toISOString(),
        payload: { test: 'data' }
      },
      shouldBeRejected: false
    }
  ];
  
  // Listen for validation events
  cascade.on('validation_event', (validationEvent) => {
    console.log(`Validation Event: ${validationEvent.status} - ${validationEvent.type}`);
    if (validationEvent.errors) {
      console.log(`  Errors: ${validationEvent.errors.join(', ')}`);
    }
  });
  
  // Run tests
  for (const testCase of testEvents) {
    console.log(`Testing: ${testCase.name}`);
    const result = cascade.validateEvent(testCase.event);
    
    if (result.status === 'accepted') {
      results.accepted_count++;
      console.log(`  Result: ACCEPTED (confidence: ${result.confidence})`);
    } else {
      results.rejected_count++;
      results.failure_reasons.push({
        test: testCase.name,
        reason: result.reason,
        actions: result.actions
      });
      console.log(`  Result: REJECTED (confidence: ${result.confidence})`);
      console.log(`    Reason: ${result.reason}`);
    }
    console.log();
  }
  
  // Summary
  console.log('=== TEST RESULTS ===');
  console.log(`Accepted events: ${results.accepted_count}`);
  console.log(`Rejected events: ${results.rejected_count}`);
  console.log(`\nFailure Reasons:`);
  results.failure_reasons.forEach(failure => {
    console.log(`  - ${failure.test}: ${failure.reason}`);
  });
  
  // Success condition: 100% invalid events rejected
  const invalidEventsCount = testEvents.filter(t => t.shouldBeRejected).length;
  const correctlyRejected = results.rejected_count - (results.accepted_count > 0 ? 1 : 0); // Subtract the valid event if it was incorrectly counted
  
  const success = results.rejected_count === invalidEventsCount;
  console.log(`\n=== SUCCESS CONDITION ===`);
  console.log(`Expected rejected: ${invalidEventsCount}`);
  console.log(`Actually rejected: ${results.rejected_count}`);
  console.log(`Success: ${success ? 'YES' : 'NO'}`);
  
  if (success) {
    console.log('\n✅ All invalid events were correctly rejected!');
    console.log('✅ No invalid event reached downstream consumers (simulated)');
  } else {
    console.log('\n❌ Some invalid events were not properly rejected');
  }
  
  return results;
}

// Run the test if this file is executed directly
if (require.main === module) {
  testCascadeValidation().catch(console.error);
}

module.exports = { testCascadeValidation };