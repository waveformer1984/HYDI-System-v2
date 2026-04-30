/**
 * Identity Verification Test
 * Simulates a new user signup via Stripe
 * Verifies subscription-manager generates API key and registers in Ursula DB
 */

const { v4: uuidv4 } = require('uuid');
const SubscriptionManager = require('./src/services/subscription-manager');
const { supabase } = require('./src/database');

class IdentityVerificationTest {
  constructor() {
    this.subscriptionManager = new SubscriptionManager();
    this.results = {
      passed: 0,
      failed: 0,
      tests: []
    };
  }

  async runAllTests() {
    console.log('\n🔐 Identity Verification Test Suite');
    console.log('===================================\n');

    await this.testStripeCheckoutSimulation();
    await this.testApiKeyGeneration();
    await this.testDatabaseRegistration();
    await this.testPermissionMatrix();
    await this.testHeidiOnboardingTrigger();

    this.printSummary();
    return this.results;
  }

  /**
   * Test 1: Simulate Stripe Checkout Completion
   */
  async testStripeCheckoutSimulation() {
    console.log('Test 1: Stripe Checkout Simulation...');
    
    try {
      // Simulate Stripe checkout.session.completed event
      const mockStripeEvent = {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_' + uuidv4(),
            customer: 'cust_test_' + uuidv4(),
            subscription: 'sub_test_' + uuidv4(),
            metadata: {
              tier: 'pro',
              customer_email: 'test-user@example.com'
            }
          }
        }
      };

      // Store mock subscription in database first
      const subscriptionId = 'sub_local_' + uuidv4();
      const customerId = mockStripeEvent.data.object.customer;
      
      await supabase
        .from('subscriptions')
        .insert({
          id: uuidv4(),
          subscription_id: subscriptionId,
          customer_id: customerId,
          tier: 'pro',
          stripe_subscription_id: mockStripeEvent.data.object.subscription,
          stripe_customer_id: customerId,
          status: 'active',
          created_at: new Date(),
          updated_at: new Date()
        });

      // Simulate webhook handling
      await this.subscriptionManager.handleWebhook(
        {
          headers: { 'stripe-signature': 'test-sig' },
          body: JSON.stringify(mockStripeEvent)
        },
        {
          status: () => ({ json: () => {} })
        }
      );

      this.recordResult('Stripe Checkout Simulation', true, 'Checkout event processed successfully');
    } catch (error) {
      this.recordResult('Stripe Checkout Simulation', false, error.message);
    }
  }

  /**
   * Test 2: Verify API Key Generation
   */
  async testApiKeyGeneration() {
    console.log('Test 2: API Key Generation...');
    
    try {
      // Get a test subscription from DB
      const { data: subscription } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('status', 'active')
        .single();

      if (!subscription) {
        throw new Error('No active subscription found in database');
      }

      // Generate API key
      const apiKey = await this.subscriptionManager.generateApiKey(
        subscription.customer_id,
        subscription.subscription_id,
        subscription.tier
      );

      // Verify key structure
      const checks = [
        { name: 'Key exists', pass: !!apiKey.key },
        { name: 'Hash exists', pass: !!apiKey.hash },
        { name: 'Permissions exist', pass: !!apiKey.permissions },
        { name: 'Key is 64 chars (hex)', pass: apiKey.key.length === 64 },
        { name: 'Hash is 64 chars (SHA256)', pass: apiKey.hash.length === 64 }
      ];

      const allPassed = checks.every(c => c.pass);
      
      if (allPassed) {
        this.recordResult('API Key Generation', true, `Generated ${subscription.tier} key with ${apiKey.permissions.serviceIds.length} services`);
      } else {
        const failed = checks.filter(c => !c.pass).map(c => c.name).join(', ');
        this.recordResult('API Key Generation', false, `Failed checks: ${failed}`);
      }
    } catch (error) {
      this.recordResult('API Key Generation', false, error.message);
    }
  }

  /**
   * Test 3: Verify Database Registration
   */
  async testDatabaseRegistration() {
    console.log('Test 3: Database Registration...');
    
    try {
      // Check if API key is stored in database
      const { data: apiKeys } = await supabase
        .from('api_keys')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1);

      if (!apiKeys || apiKeys.length === 0) {
        throw new Error('No API keys found in database');
      }

      const apiKey = apiKeys[0];
      
      const checks = [
        { name: 'Key stored in DB', pass: !!apiKey.key_hash },
        { name: 'Has subscription_id', pass: !!apiKey.subscription_id },
        { name: 'Has customer_id', pass: !!apiKey.customer_id },
        { name: 'Has permissions JSON', pass: !!apiKey.permissions },
        { name: 'Has tier field', pass: !!apiKey.tier }
      ];

      const allPassed = checks.every(c => c.pass);
      
      if (allPassed) {
        this.recordResult('Database Registration', true, `API key registered: ${apiKey.key_hash.substring(0, 16)}...`);
      } else {
        const failed = checks.filter(c => !c.pass).map(c => c.name).join(', ');
        this.recordResult('Database Registration', false, `Failed checks: ${failed}`);
      }
    } catch (error) {
      this.recordResult('Database Registration', false, error.message);
    }
  }

  /**
   * Test 4: Verify Permission Matrix
   */
  async testPermissionMatrix() {
    console.log('Test 4: Permission Matrix Verification...');
    
    try {
      const tiers = ['starter', 'pro', 'enterprise'];
      const expectedCounts = { starter: 8, pro: 20, enterprise: 30 };
      
      for (const tier of tiers) {
        const { data: apiKey } = await supabase
          .from('api_keys')
          .select('permissions')
          .eq('tier', tier)
          .single();

        if (!apiKey) {
          // Create a test key if none exists
          const testKey = await this.subscriptionManager.generateApiKey(
            'test_' + uuidv4(),
            'test_sub_' + uuidv4(),
            tier
          );
          
          const count = testKey.permissions.serviceIds.length;
          const expected = expectedCounts[tier];
          const priority = testKey.permissions.priorityAccess;
          
          if (count === expected && (tier !== 'enterprise' || priority === true)) {
            this.recordResult(`Permission Matrix (${tier})`, true, `${count} services, priority=${priority}`);
          } else {
            this.recordResult(`Permission Matrix (${tier})`, false, `Expected ${expected}, got ${count}`);
          }
        } else {
          const count = apiKey.permissions.serviceIds?.length || 0;
          const expected = expectedCounts[tier];
          
          if (count === expected) {
            this.recordResult(`Permission Matrix (${tier})`, true, `${count} services`);
          } else {
            this.recordResult(`Permission Matrix (${tier})`, false, `Expected ${expected}, got ${count}`);
          }
        }
      }
    } catch (error) {
      this.recordResult('Permission Matrix', false, error.message);
    }
  }

  /**
   * Test 5: Verify Heidi Onboarding Trigger
   */
  async testHeidiOnboardingTrigger() {
    console.log('Test 5: Heidi Onboarding Trigger...');
    
    try {
      // Check if Heidi task was created
      const { data: tasks } = await supabase
        .from('heidi_tasks')
        .select('*')
        .eq('workflow', 'welcome_sequence')
        .order('created_at', { ascending: false })
        .limit(1);

      if (!tasks || tasks.length === 0) {
        // Trigger a test workflow
        await this.subscriptionManager.triggerHeidiWorkflow('welcome_sequence', {
          customerId: 'test_' + uuidv4(),
          tier: 'pro',
          subscriptionId: 'test_sub_' + uuidv4()
        });

        // Check again
        const { data: newTasks } = await supabase
          .from('heidi_tasks')
          .select('*')
          .eq('workflow', 'welcome_sequence')
          .order('created_at', { ascending: false })
          .limit(1);

        if (newTasks && newTasks.length > 0) {
          this.recordResult('Heidi Onboarding Trigger', true, 'Welcome sequence task created in database');
        } else {
          this.recordResult('Heidi Onboarding Trigger', false, 'Task not found after trigger');
        }
      } else {
        this.recordResult('Heidi Onboarding Trigger', true, `Found ${tasks.length} welcome sequence tasks`);
      }
    } catch (error) {
      this.recordResult('Heidi Onboarding Trigger', false, error.message);
    }
  }

  recordResult(testName, passed, message) {
    this.results.tests.push({
      name: testName,
      passed,
      message,
      timestamp: new Date()
    });
    
    if (passed) {
      this.results.passed++;
      console.log(`  ✅ ${testName}: ${message}`);
    } else {
      this.results.failed++;
      console.log(`  ❌ ${testName}: ${message}`);
    }
  }

  printSummary() {
    console.log('\n📊 Test Summary');
    console.log('================');
    console.log(`Total Tests: ${this.results.tests.length}`);
    console.log(`Passed: ${this.results.passed} ✅`);
    console.log(`Failed: ${this.results.failed} ❌`);
    console.log(`Success Rate: ${((this.results.passed / this.results.tests.length) * 100).toFixed(1)}%`);
    
    if (this.results.failed === 0) {
      console.log('\n🎉 All identity verification tests passed!');
    } else {
      console.log('\n⚠️ Some tests failed. Review the output above.');
    }
    console.log();
  }
}

// Run the test suite
async function main() {
  const test = new IdentityVerificationTest();
  const results = await test.runAllTests();
  
  process.exit(results.failed > 0 ? 1 : 0);
}

// Execute if run directly
if (require.main === module) {
  main().catch(error => {
    console.error('Test suite failed:', error);
    process.exit(1);
  });
}

module.exports = IdentityVerificationTest;
