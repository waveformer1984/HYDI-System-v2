// STRICT IDENTITY VALIDATION TEST
// Validate that identity collision is fixed and proper separation is maintained

const StrictIdentityProcessor = require('./strict_identity_processor');

class StrictIdentityValidationTest {
  constructor() {
    this.processor = new StrictIdentityProcessor();
    this.testResults = {
      deliveryIdentityTests: [],
      contentIdentityTests: [],
      weakIngressTests: [],
      collisionDetectionTests: [],
      causalMappingTests: [],
      sanityCheckResults: []
    };
  }

  async runValidation() {
    console.log('🔍 STRICT IDENTITY VALIDATION TEST');
    console.log('====================================');
    console.log('Testing proper identity separation and collision detection\n');
    
    try {
      await this.testDeliveryIdentity();
      await this.testContentIdentity();
      await this.testWeakIngressQuarantine();
      await this.testCollisionDetection();
      await this.testCausalMappingLimits();
      await this.runSanityCheck();
      
      this.reportResults();
      
    } catch (error) {
      console.log('\n💥 VALIDATION TEST CRASHED');
      console.log('Error:', error.message);
    }
  }

  async testDeliveryIdentity() {
    console.log('🎯 Testing Delivery Identity Separation');
    
    // Test 1: Same external ID, different payload (should detect delivery collision)
    try {
      await this.processor.insertWebhookEventStrict(
        'stripe',
        'evt_123456',
        { amount: 1000, currency: 'usd' }
      );
      
      // This should throw a delivery collision
      try {
        await this.processor.insertWebhookEventStrict(
          'stripe',
          'evt_123456', // Same external ID
          { amount: 2000, currency: 'usd' } // Different payload
        );
        
        this.testResults.deliveryIdentityTests.push({
          test: 'Same external ID, different payload',
          result: 'FAILED',
          reason: 'Should have detected delivery collision'
        });
        
      } catch (error) {
        if (error.message.includes('DELIVERY_COLLISION')) {
          this.testResults.deliveryIdentityTests.push({
            test: 'Same external ID, different payload',
            result: 'PASSED',
            reason: 'Correctly detected delivery collision'
          });
        } else {
          this.testResults.deliveryIdentityTests.push({
            test: 'Same external ID, different payload',
            result: 'FAILED',
            reason: `Wrong error type: ${error.message}`
          });
        }
      }
      
    } catch (error) {
      this.testResults.deliveryIdentityTests.push({
        test: 'Same external ID, different payload',
        result: 'FAILED',
        reason: `Unexpected error: ${error.message}`
      });
    }
    
    // Test 2: Same external ID, same payload (should be legitimate duplicate)
    try {
      const result1 = await this.processor.insertWebhookEventStrict(
        'github',
        'push_789',
        { repository: 'myrepo', branch: 'main' }
      );
      
      const result2 = await this.processor.insertWebhookEventStrict(
        'github',
        'push_789', // Same external ID
        { repository: 'myrepo', branch: 'main' } // Same payload
      );
      
      if (result2.isDuplicate && result2.status === 'duplicate') {
        this.testResults.deliveryIdentityTests.push({
          test: 'Same external ID, same payload',
          result: 'PASSED',
          reason: 'Correctly identified as legitimate duplicate'
        });
      } else {
        this.testResults.deliveryIdentityTests.push({
          test: 'Same external ID, same payload',
          result: 'FAILED',
          reason: 'Should have been identified as legitimate duplicate'
        });
      }
      
    } catch (error) {
      this.testResults.deliveryIdentityTests.push({
        test: 'Same external ID, same payload',
        result: 'FAILED',
        reason: `Unexpected error: ${error.message}`
      });
    }
  }

  async testContentIdentity() {
    console.log('🎯 Testing Content Identity Separation');
    
    // Test 1: Same payload hash, different delivery identity (should detect content collision)
    try {
      await this.processor.insertWebhookEventStrict(
        'stripe',
        'evt_111',
        { amount: 1000, currency: 'usd', type: 'payment' }
      );
      
      // This should throw a content collision (same canonical payload, different delivery)
      try {
        await this.processor.insertWebhookEventStrict(
          'github', // Different provider
          'push_222', // Different external ID
          { amount: 1000, currency: 'usd', type: 'payment' } // Same content
        );
        
        this.testResults.contentIdentityTests.push({
          test: 'Same payload, different delivery',
          result: 'FAILED',
          reason: 'Should have detected content collision'
        });
        
      } catch (error) {
        if (error.message.includes('CONTENT_COLLISION')) {
          this.testResults.contentIdentityTests.push({
            test: 'Same payload, different delivery',
            result: 'PASSED',
            reason: 'Correctly detected content collision'
          });
        } else {
          this.testResults.contentIdentityTests.push({
            test: 'Same payload, different delivery',
            result: 'FAILED',
            reason: `Wrong error type: ${error.message}`
          });
        }
      }
      
    } catch (error) {
      this.testResults.contentIdentityTests.push({
        test: 'Same payload, different delivery',
        result: 'FAILED',
        reason: `Unexpected error: ${error.message}`
      });
    }
    
    // Test 2: Different payloads, different delivery (should be allowed)
    try {
      const result1 = await this.processor.insertWebhookEventStrict(
        'slack',
        'msg_333',
        { text: 'Hello', channel: 'general' }
      );
      
      const result2 = await this.processor.insertWebhookEventStrict(
        'slack',
        'msg_444',
        { text: 'World', channel: 'general' }
      );
      
      if (result1.status === 'received' && result2.status === 'received') {
        this.testResults.contentIdentityTests.push({
          test: 'Different payloads, different delivery',
          result: 'PASSED',
          reason: 'Both events accepted as expected'
        });
      } else {
        this.testResults.contentIdentityTests.push({
          test: 'Different payloads, different delivery',
          result: 'FAILED',
          reason: 'One or both events were not accepted'
        });
      }
      
    } catch (error) {
      this.testResults.contentIdentityTests.push({
        test: 'Different payloads, different delivery',
        result: 'FAILED',
        reason: `Unexpected error: ${error.message}`
      });
    }
  }

  async testWeakIngressQuarantine() {
    console.log('🎯 Testing Weak Ingress Quarantine');
    
    // Test 1: Unknown provider, no external ID (should be quarantined)
    try {
      const result = await this.processor.insertWebhookEventStrict(
        'unknown', // Unknown provider
        null, // No external ID
        { some: 'data' }
      );
      
      if (result.status === 'quarantined') {
        this.testResults.weakIngressTests.push({
          test: 'Unknown provider, no external ID',
          result: 'PASSED',
          reason: 'Correctly quarantined weak ingress'
        });
      } else {
        this.testResults.weakIngressTests.push({
          test: 'Unknown provider, no external ID',
          result: 'FAILED',
          reason: 'Should have been quarantined'
        });
      }
      
    } catch (error) {
      this.testResults.weakIngressTests.push({
        test: 'Unknown provider, no external ID',
        result: 'FAILED',
        reason: `Unexpected error: ${error.message}`
      });
    }
    
    // Test 2: Unknown provider, but has external ID (should be allowed)
    try {
      const result = await this.processor.insertWebhookEventStrict(
        'unknown', // Unknown provider
        'ext_123', // Has external ID
        { some: 'data' }
      );
      
      if (result.status === 'received') {
        this.testResults.weakIngressTests.push({
          test: 'Unknown provider, has external ID',
          result: 'PASSED',
          reason: 'Correctly allowed with external ID'
        });
      } else {
        this.testResults.weakIngressTests.push({
          test: 'Unknown provider, has external ID',
          result: 'FAILED',
          reason: 'Should have been allowed with external ID'
        });
      }
      
    } catch (error) {
      this.testResults.weakIngressTests.push({
        test: 'Unknown provider, has external ID',
        result: 'FAILED',
        reason: `Unexpected error: ${error.message}`
      });
    }
    
    // Test 3: Trustworthy provider, no external ID (should be quarantined)
    try {
      const result = await this.processor.insertWebhookEventStrict(
        'stripe', // Trustworthy provider
        null, // No external ID
        { amount: 1000 }
      );
      
      if (result.status === 'quarantined') {
        this.testResults.weakIngressTests.push({
          test: 'Trustworthy provider, no external ID',
          result: 'PASSED',
          reason: 'Correctly quarantined - even trustworthy providers need external ID'
        });
      } else {
        this.testResults.weakIngressTests.push({
          test: 'Trustworthy provider, no external ID',
          result: 'FAILED',
          reason: 'Should have been quarantined'
        });
      }
      
    } catch (error) {
      this.testResults.weakIngressTests.push({
        test: 'Trustworthy provider, no external ID',
        result: 'FAILED',
        reason: `Unexpected error: ${error.message}`
      });
    }
  }

  async testCollisionDetection() {
    console.log('🎯 Testing Collision Detection');
    
    // Test collision detection metrics
    const metrics = this.processor.getMetrics();
    
    if (metrics.deliveryCollisions > 0) {
      this.testResults.collisionDetectionTests.push({
        test: 'Delivery collision detection',
        result: 'PASSED',
        reason: `Detected ${metrics.deliveryCollisions} delivery collisions`
      });
    } else {
      this.testResults.collisionDetectionTests.push({
        test: 'Delivery collision detection',
        result: 'FAILED',
        reason: 'No delivery collisions detected'
      });
    }
    
    if (metrics.contentCollisions > 0) {
      this.testResults.collisionDetectionTests.push({
        test: 'Content collision detection',
        result: 'PASSED',
        reason: `Detected ${metrics.contentCollisions} content collisions`
      });
    } else {
      this.testResults.collisionDetectionTests.push({
        test: 'Content collision detection',
        result: 'FAILED',
        reason: 'No content collisions detected'
      });
    }
    
    if (metrics.eventsQuarantined > 0) {
      this.testResults.collisionDetectionTests.push({
        test: 'Weak ingress quarantine',
        result: 'PASSED',
        reason: `Quarantined ${metrics.eventsQuarantined} weak ingress events`
      });
    } else {
      this.testResults.collisionDetectionTests.push({
        test: 'Weak ingress quarantine',
        result: 'FAILED',
        reason: 'No weak ingress events quarantined'
      });
    }
  }

  async testCausalMappingLimits() {
    console.log('🎯 Testing Causal Mapping Limits');
    
    // Test that different content identities create different causal events
    const testCases = [
      { provider: 'stripe', externalId: 'evt_a1', payload: { type: 'payment', amount: 100 } },
      { provider: 'stripe', externalId: 'evt_a2', payload: { type: 'payment', amount: 200 } },
      { provider: 'github', externalId: 'push_b1', payload: { repo: 'test', branch: 'main' } }
    ];
    
    const causalEventIds = new Set();
    
    for (const testCase of testCases) {
      try {
        const result = await this.processor.processExternalEventStrict(
          testCase.provider,
          testCase.externalId,
          testCase.payload
        );
        
        if (result.status === 'processed' && result.causalEventId) {
          causalEventIds.add(result.causalEventId);
        }
        
      } catch (error) {
        // Expected for some collision cases
      }
    }
    
    // Should have multiple distinct causal event IDs
    if (causalEventIds.size >= 2) {
      this.testResults.causalMappingTests.push({
        test: 'Distinct causal events for distinct content',
        result: 'PASSED',
        reason: `Created ${causalEventIds.size} distinct causal event IDs`
      });
    } else {
      this.testResults.causalMappingTests.push({
        test: 'Distinct causal events for distinct content',
        result: 'FAILED',
        reason: `Only ${causalEventIds.size} distinct causal event IDs created`
      });
    }
    
    // Test causal mapping violations
    const metrics = this.processor.getMetrics();
    if (metrics.causalMappingViolations === 0) {
      this.testResults.causalMappingTests.push({
        test: 'Causal mapping violation prevention',
        result: 'PASSED',
        reason: 'No causal mapping violations detected'
      });
    } else {
      this.testResults.causalMappingTests.push({
        test: 'Causal mapping violation prevention',
        result: 'FAILED',
        reason: `Detected ${metrics.causalMappingViolations} causal mapping violations`
      });
    }
  }

  async runSanityCheck() {
    console.log('🎯 Running Sanity Check');
    
    const violations = this.processor.runSanityCheck();
    this.testResults.sanityCheckResults = violations;
    
    if (violations.length === 0) {
      console.log('  ✅ No causal mapping violations detected');
    } else {
      console.log(`  💥 Found ${violations.length} causal mapping violations`);
    }
  }

  reportResults() {
    console.log('\n📊 STRICT IDENTITY VALIDATION RESULTS');
    console.log('=====================================');
    
    const reportSection = (title, tests) => {
      console.log(`\n${title}:`);
      tests.forEach(test => {
        const icon = test.result === 'PASSED' ? '✅' : '❌';
        console.log(`  ${icon} ${test.test}: ${test.reason}`);
      });
    };
    
    reportSection('🎯 Delivery Identity Tests', this.testResults.deliveryIdentityTests);
    reportSection('🎯 Content Identity Tests', this.testResults.contentIdentityTests);
    reportSection('🎯 Weak Ingress Tests', this.testResults.weakIngressTests);
    reportSection('🎯 Collision Detection Tests', this.testResults.collisionDetectionTests);
    reportSection('🎯 Causal Mapping Tests', this.testResults.causalMappingTests);
    
    // Summary
    const allTests = [
      ...this.testResults.deliveryIdentityTests,
      ...this.testResults.contentIdentityTests,
      ...this.testResults.weakIngressTests,
      ...this.testResults.collisionDetectionTests,
      ...this.testResults.causalMappingTests
    ];
    
    const passedTests = allTests.filter(test => test.result === 'PASSED').length;
    const totalTests = allTests.length;
    
    console.log(`\n🏁 SUMMARY: ${passedTests}/${totalTests} tests passed`);
    
    if (passedTests === totalTests) {
      console.log('🎉 ALL TESTS PASSED - IDENTITY COLLISION FIXED');
    } else {
      console.log('💥 SOME TESTS FAILED - IDENTITY ISSUES REMAIN');
    }
    
    // Final metrics
    const metrics = this.processor.getMetrics();
    console.log('\n📈 FINAL METRICS:');
    console.log(`  Events Received: ${metrics.eventsReceived}`);
    console.log(`  Events Quarantined: ${metrics.eventsQuarantined}`);
    console.log(`  Events Processed: ${metrics.eventsProcessed}`);
    console.log(`  Delivery Collisions: ${metrics.deliveryCollisions}`);
    console.log(`  Content Collisions: ${metrics.contentCollisions}`);
    console.log(`  Causal Mapping Violations: ${metrics.causalMappingViolations}`);
  }
}

// Run the validation test
if (require.main === module) {
  const test = new StrictIdentityValidationTest();
  test.runValidation().catch(console.error);
}

module.exports = StrictIdentityValidationTest;
