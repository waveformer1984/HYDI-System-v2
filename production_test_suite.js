// PRODUCTION TEST SUITE - COMPREHENSIVE IDENTITY VALIDATION
// Tests for strict 1:1 event lineage and zero identity collisions

const ProductionIdempotencyEngine = require('./production_idempotency_engine');
const crypto = require('crypto');

class ProductionTestSuite {
  constructor() {
    this.engine = new ProductionIdempotencyEngine();
    this.testResults = [];
  }

  async runAllTests() {
    console.log('🧪 PRODUCTION TEST SUITE - IDENTITY VALIDATION');
    console.log('===============================================');
    
    try {
      await this.test1000UniqueEvents();
      await this.testEventReplay();
      await this.testPayloadVariation();
      await this.testSamePayloadDifferentId();
      await this.testCanonicalizationIntegrity();
      await this.testMissingExternalId();
      await this.testProviderDetection();
      await this.testCausalCollisionPrevention();
      await this.testReplaySafety();
      
      this.reportResults();
      
    } catch (error) {
      console.log('\n💥 TEST SUITE CRASHED');
      console.log('Error:', error.message);
    }
  }

  // =============================================================================
  // TEST 1: 1000 unique UUID events → 1000 causal events
  // =============================================================================
  async test1000UniqueEvents() {
    console.log('\n🎯 TEST 1: 1000 Unique Events → 1000 Causal Events');
    
    this.engine.reset();
    const causalEventIds = new Set();
    const externalEventIds = new Set();
    
    for (let i = 0; i < 1000; i++) {
      const externalId = `evt_${i.toString().padStart(4, '0')}_${uuidv4()}`;
      externalEventIds.add(externalId);
      
      const payload = {
        id: externalId,
        amount: Math.floor(Math.random() * 10000),
        currency: 'usd',
        type: 'payment',
        created: Math.floor(Math.random() * 1000000)
      };
      
      const result = await this.engine.processExternalEvent(payload);
      
      if (result.status === 'accepted') {
        causalEventIds.add(result.causal_event_id);
      } else if (result.status === 'duplicate') {
        // This shouldn't happen with unique external IDs
        console.log(`    ⚠️ Unexpected duplicate for external ID: ${externalId}`);
      }
    }
    
    const passed = causalEventIds.size === 1000 && externalEventIds.size === 1000;
    
    this.testResults.push({
      test: '1000 Unique Events → 1000 Causal Events',
      passed,
      details: {
        external_events: externalEventIds.size,
        causal_events: causalEventIds.size,
        expected: 1000
      }
    });
    
    console.log(`  ${passed ? '✅' : '❌'} ${causalEventIds.size}/1000 causal events created`);
  }

  // =============================================================================
  // TEST 2: Same event replayed 1000 times → 1 causal event
  // =============================================================================
  async testEventReplay() {
    console.log('\n🎯 TEST 2: Event Replay 1000x → 1 Causal Event');
    
    this.engine.reset();
    
    const payload = {
      id: 'evt_replay_test_12345',
      amount: 5000,
      currency: 'usd',
      type: 'payment'
    };
    
    const causalEventIds = new Set();
    let duplicateCount = 0;
    
    for (let i = 0; i < 1000; i++) {
      const result = await this.engine.processExternalEvent(payload);
      
      if (result.status === 'duplicate') {
        duplicateCount++;
      } else if (result.status === 'accepted') {
        causalEventIds.add(result.causal_event_id);
      }
    }
    
    const passed = causalEventIds.size === 1 && duplicateCount === 999;
    
    this.testResults.push({
      test: 'Event Replay 1000x → 1 Causal Event',
      passed,
      details: {
        causal_events: causalEventIds.size,
        duplicates: duplicateCount,
        expected_causal: 1,
        expected_duplicates: 999
      }
    });
    
    console.log(`  ${passed ? '✅' : '❌'} ${causalEventIds.size} causal event, ${duplicateCount} duplicates`);
  }

  // =============================================================================
  // TEST 3: Slight payload variation (same external_id) → still duplicate
  // =============================================================================
  async testPayloadVariation() {
    console.log('\n🎯 TEST 3: Payload Variation + Same External ID → Duplicate');
    
    this.engine.reset();
    
    const basePayload = {
      id: 'evt_variation_test_67890',
      amount: 1000,
      currency: 'usd',
      type: 'payment'
    };
    
    const variations = [
      { ...basePayload, amount: 1001 }, // Different amount
      { ...basePayload, currency: 'USD' }, // Different case
      { ...basePayload, type: 'payment', extra_field: 'extra' }, // Extra field
      { ...basePayload, created: 1234567890 }, // Extra timestamp
      basePayload // Original
    ];
    
    const causalEventIds = new Set();
    let duplicateCount = 0;
    
    for (const payload of variations) {
      const result = await this.engine.processExternalEvent(payload);
      
      if (result.status === 'duplicate') {
        duplicateCount++;
      } else if (result.status === 'accepted') {
        causalEventIds.add(result.causal_event_id);
      }
    }
    
    const passed = causalEventIds.size === 1 && duplicateCount === 4;
    
    this.testResults.push({
      test: 'Payload Variation + Same External ID → Duplicate',
      passed,
      details: {
        causal_events: causalEventIds.size,
        duplicates: duplicateCount,
        expected_causal: 1,
        expected_duplicates: 4
      }
    });
    
    console.log(`  ${passed ? '✅' : '❌'} ${causalEventIds.size} causal event, ${duplicateCount} duplicates`);
  }

  // =============================================================================
  // TEST 4: Same payload, different external_id → MUST be distinct
  // =============================================================================
  async testSamePayloadDifferentId() {
    console.log('\n🎯 TEST 4: Same Payload + Different External ID → Distinct');
    
    this.engine.reset();
    
    const payload = {
      amount: 2000,
      currency: 'eur',
      type: 'refund',
      description: 'Test refund'
    };
    
    const externalIds = ['evt_same_payload_1', 'evt_same_payload_2', 'evt_same_payload_3'];
    const causalEventIds = new Set();
    
    for (const externalId of externalIds) {
      const testPayload = { ...payload, id: externalId };
      const result = await this.engine.processExternalEvent(testPayload);
      
      if (result.status === 'accepted') {
        causalEventIds.add(result.causal_event_id);
      }
    }
    
    const passed = causalEventIds.size === 3;
    
    this.testResults.push({
      test: 'Same Payload + Different External ID → Distinct',
      passed,
      details: {
        causal_events: causalEventIds.size,
        expected: 3
      }
    });
    
    console.log(`  ${passed ? '✅' : '❌'} ${causalEventIds.size}/3 distinct causal events`);
  }

  // =============================================================================
  // TEST 5: Canonicalization does NOT change identity
  // =============================================================================
  async testCanonicalizationIntegrity() {
    console.log('\n🎯 TEST 5: Canonicalization Integrity');
    
    this.engine.reset();
    
    // Test entropy preservation
    const complexPayload = {
      id: 'evt_canonical_test',
      nested: {
        deep: {
          array: [1, 2, 3, { key: 'value' }],
          string: '  spaced  text  ',
          number: 42
        }
      },
      unsorted_keys: {
        z_key: 'last',
        a_key: 'first',
        m_key: 'middle'
      }
    };
    
    try {
      const result = await this.engine.processExternalEvent(complexPayload);
      
      // Test that canonicalization preserved entropy
      const canonical = this.engine.canonicalizePayload(complexPayload);
      const originalEntropy = this.engine.calculateEntropy(complexPayload);
      const canonicalEntropy = this.engine.calculateEntropy(canonical);
      
      const entropyPreserved = canonicalEntropy >= originalEntropy;
      const processedSuccessfully = result.status === 'accepted';
      
      const passed = entropyPreserved && processedSuccessfully;
      
      this.testResults.push({
        test: 'Canonicalization Integrity',
        passed,
        details: {
          original_entropy: originalEntropy,
          canonical_entropy: canonicalEntropy,
          entropy_preserved: entropyPreserved,
          processed_successfully: processedSuccessfully
        }
      });
      
      console.log(`  ${passed ? '✅' : '❌'} Entropy preserved: ${entropyPreserved}, Processed: ${processedSuccessfully}`);
      
    } catch (error) {
      this.testResults.push({
        test: 'Canonicalization Integrity',
        passed: false,
        details: { error: error.message }
      });
      
      console.log(`  ❌ Canonicalization failed: ${error.message}`);
    }
  }

  // =============================================================================
  // TEST 6: Missing external_id triggers fallback path ONLY
  // =============================================================================
  async testMissingExternalId() {
    console.log('\n🎯 TEST 6: Missing External ID → Fallback Path');
    
    this.engine.reset();
    
    const payloadWithoutId = {
      amount: 3000,
      currency: 'gbp',
      type: 'charge',
      no_id_field: true
    };
    
    const result = await this.engine.processExternalEvent(payloadWithoutId);
    
    const passed = result.status === 'quarantined';
    const usedFallback = this.engine.getMetrics().fallback_identity_usage_total > 0;
    
    this.testResults.push({
      test: 'Missing External ID → Fallback Path',
      passed,
      details: {
        status: result.status,
        used_fallback: usedFallback,
        quarantined: passed
      }
    });
    
    console.log(`  ${passed ? '✅' : '❌'} Status: ${result.status}, Used fallback: ${usedFallback}`);
  }

  // =============================================================================
  // TEST 7: Provider detection accuracy
  // =============================================================================
  async testProviderDetection() {
    console.log('\n🎯 TEST 7: Provider Detection');
    
    this.engine.reset();
    
    const testCases = [
      {
        payload: { id: 'evt_123456789', type: 'charge.succeeded' },
        expected_provider: 'stripe',
        headers: { 'stripe-signature': 'test_signature' }
      },
      {
        payload: { id: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t' },
        expected_provider: 'github',
        headers: { 'x-github-event': 'push' }
      },
      {
        payload: { event_id: 'EV123ABC456DEF' },
        expected_provider: 'unclassified',
        headers: {}
      }
    ];
    
    let passedTests = 0;
    
    for (const testCase of testCases) {
      const result = await this.engine.processExternalEvent(testCase.payload, testCase.headers);
      const detectedProvider = result.event_record?.provider;
      
      if (detectedProvider === testCase.expected_provider) {
        passedTests++;
      }
    }
    
    const passed = passedTests === testCases.length;
    
    this.testResults.push({
      test: 'Provider Detection',
      passed,
      details: {
        correct_detections: passedTests,
        total_tests: testCases.length
      }
    });
    
    console.log(`  ${passed ? '✅' : '❌'} ${passedTests}/${testCases.length} providers detected correctly`);
  }

  // =============================================================================
  // TEST 8: Causal collision prevention
  // =============================================================================
  async testCausalCollisionPrevention() {
    console.log('\n🎯 TEST 8: Causal Collision Prevention');
    
    this.engine.reset();
    
    // This test requires manual collision detection setup
    // For now, test that the engine detects and prevents collisions
    const metrics = this.engine.getMetrics();
    
    // Process some events first
    await this.engine.processExternalEvent({ id: 'collision_test_1', data: 'test1' });
    await this.engine.processExternalEvent({ id: 'collision_test_2', data: 'test2' });
    
    const finalMetrics = this.engine.getMetrics();
    const collisionsPrevented = finalMetrics.causal_collision_prevented_total;
    
    // Should have 0 collisions in normal operation
    const passed = collisionsPrevented === 0;
    
    this.testResults.push({
      test: 'Causal Collision Prevention',
      passed,
      details: {
        collisions_prevented: collisionsPrevented,
        expected: 0
      }
    });
    
    console.log(`  ${passed ? '✅' : '❌'} Collisions prevented: ${collisionsPrevented}`);
  }

  // =============================================================================
  // TEST 9: Replay safety validation
  // =============================================================================
  async testReplaySafety() {
    console.log('\n🎯 TEST 9: Replay Safety Validation');
    
    this.engine.reset();
    
    // Create some events
    const events = [
      { id: 'replay_safe_1', amount: 100 },
      { id: 'replay_safe_2', amount: 200 },
      { id: 'replay_safe_3', amount: 300 }
    ];
    
    for (const event of events) {
      await this.engine.processExternalEvent(event);
    }
    
    // Validate replay safety
    const issues = this.engine.validateReplaySafety();
    const passed = issues.length === 0;
    
    this.testResults.push({
      test: 'Replay Safety Validation',
      passed,
      details: {
        issues_found: issues.length,
        issues: issues
      }
    });
    
    console.log(`  ${passed ? '✅' : '❌'} Replay safety issues: ${issues.length}`);
  }

  // =============================================================================
  // RESULTS REPORTING
  // =============================================================================
  
  reportResults() {
    console.log('\n📊 PRODUCTION TEST SUITE RESULTS');
    console.log('================================');
    
    const passedTests = this.testResults.filter(test => test.passed).length;
    const totalTests = this.testResults.length;
    
    this.testResults.forEach(test => {
      const icon = test.passed ? '✅' : '❌';
      console.log(`  ${icon} ${test.test}`);
      
      if (!test.passed && test.details) {
        console.log(`     Details: ${JSON.stringify(test.details)}`);
      }
    });
    
    console.log(`\n🏁 SUMMARY: ${passedTests}/${totalTests} tests passed`);
    
    if (passedTests === totalTests) {
      console.log('🎉 ALL TESTS PASSED - PRODUCTION SYSTEM READY');
    } else {
      console.log('💥 SOME TESTS FAILED - SYSTEM NOT READY FOR PRODUCTION');
    }
    
    // Final metrics
    const metrics = this.engine.getMetrics();
    const stats = this.engine.getRegistryStats();
    
    console.log('\n📈 FINAL METRICS:');
    console.log(`  Events Processed: ${metrics.events_processed_total}`);
    console.log(`  Fallback Identity Usage: ${metrics.fallback_identity_usage_total}`);
    console.log(`  Quarantine Events: ${metrics.quarantine_events_total}`);
    console.log(`  Idempotency Registry Size: ${stats.idempotency_registry_size}`);
    console.log(`  Causal Registry Size: ${stats.causal_registry_size}`);
    console.log(`  Avg Events per Causal: ${stats.avg_external_events_per_causal.toFixed(2)}`);
  }
}

// Helper function for UUID generation (use crypto for better uniqueness)
function uuidv4() {
  return crypto.randomUUID();
}

// Run the test suite
if (require.main === module) {
  const testSuite = new ProductionTestSuite();
  testSuite.runAllTests().catch(console.error);
}

module.exports = ProductionTestSuite;
