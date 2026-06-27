/**
 * ADVERSARIAL TEST HARNESS
 * 
 * Tests what happens when decision layer lies, glitches, or becomes inconsistent
 */

import { SchemaVerifier } from '../schema-verifier/index.js';

class AdversarialTestHarness {
  constructor() {
    this.verifier = new SchemaVerifier();
    this.testResults = [];
    this.hostilePatterns = [
      'malformed_but_valid_schema',
      'edge_case_ambiguity',
      'race_condition_simulation',
      'policy_interference',
      'signature_manipulation',
      'field_name_collision',
      'unicode_injection',
      'code_injection',
      'constraint_bypass'
    ];
  }
  
  async runAllTests() {
    console.log('=== ADVERSARIAL TEST HARNESS ===');
    console.log('Testing: Decision layer hostile behavior\n');
    
    for (const pattern of this.hostilePatterns) {
      console.log(`--- Testing: ${pattern} ---`);
      const result = await this.runTest(pattern);
      console.log(`Result: ${result.passed ? 'PASSED' : 'FAILED'}`);
      if (!result.passed) {
        console.log('Issues:', result.issues);
      }
      console.log('');
    }
    
    this.generateReport();
  }
  
  async runTest(testType) {
    const test = {
      type: testType,
      timestamp: new Date().toISOString(),
      passed: true,
      issues: [],
      proposals: []
    };
    
    switch (testType) {
      case 'malformed_but_valid_schema':
        test.proposals = this.createMalformedButValidProposals();
        break;
      case 'edge_case_ambiguity':
        test.proposals = this.createEdgeCaseProposals();
        break;
      case 'race_condition_simulation':
        test.proposals = this.createRaceConditionProposals();
        break;
      case 'policy_interference':
        test.proposals = this.createPolicyInterferenceProposals();
        break;
      case 'signature_manipulation':
        test.proposals = this.createSignatureManipulationProposals();
        break;
      case 'field_name_collision':
        test.proposals = this.createFieldNameCollisionProposals();
        break;
      case 'unicode_injection':
        test.proposals = this.createUnicodeInjectionProposals();
        break;
      case 'code_injection':
        test.proposals = this.createCodeInjectionProposals();
        break;
      case 'constraint_bypass':
        test.proposals = this.createConstraintBypassProposals();
        break;
    }
    
    // Test each proposal
    for (const proposal of test.proposals) {
      const verification = this.verifier.verify(proposal, `test_${testType}`);
      
      if (verification.valid) {
        // Check if this should have been blocked
        if (this.shouldHaveBeenBlocked(proposal, testType)) {
          test.passed = false;
          test.issues.push(`Proposal should have been blocked: ${JSON.stringify(proposal)}`);
        }
      } else {
        // Check if errors are appropriate
        if (!this.errorsAreAppropriate(verification.errors, testType)) {
          test.passed = false;
          test.issues.push(`Inappropriate errors: ${verification.errors.join(', ')}`);
        }
      }
    }
    
    this.testResults.push(test);
    return test;
  }
  
  createMalformedButValidProposals() {
    return [
      {
        actionType: 'transfer_funds',
        user_id: 'user123',
        amount: 1000,
        destination: 'valid_account',
        signature: 'a'.repeat(64) // Valid length but invalid pattern
      },
      {
        actionType: 'send_message',
        channel: 'email',
        content: 'Valid message',
        signature: '0'.repeat(64), // Valid length but all zeros
        priority: 'invalid_priority' // Not in allowed values
      },
      {
        actionType: 'delete_record',
        record_id: 'valid_id',
        source_verified: 'true', // String instead of boolean
        reason: 'Valid reason'
      }
    ];
  }
  
  createEdgeCaseProposals() {
    return [
      {
        actionType: 'transfer_funds',
        user_id: '',
        amount: 0.01, // Minimum valid amount
        destination: 'valid_account',
        signature: 'a'.repeat(64)
      },
      {
        actionType: 'transfer_funds',
        user_id: 'u'.repeat(100), // Maximum valid length
        amount: 1000000, // Maximum valid amount
        destination: 'd'.repeat(100),
        signature: 'a'.repeat(64)
      },
      {
        actionType: 'general_query',
        query: 'q'.repeat(1000), // Maximum valid length
        context: { key1: 'value1', key2: 'value2' }
      }
    ];
  }
  
  createRaceConditionProposals() {
    return [
      {
        actionType: 'transfer_funds',
        user_id: 'user123',
        amount: 1000,
        destination: 'account_A',
        signature: 'a'.repeat(64),
        // Simulate race condition
        _raceCondition: true,
        _timestamp: Date.now()
      },
      {
        actionType: 'send_message',
        channel: 'email',
        content: 'Message content',
        signature: 'a'.repeat(64),
        // Duplicate field
        channel: 'sms'
      }
    ];
  }
  
  createPolicyInterferenceProposals() {
    return [
      {
        actionType: 'financial', // Invalid action type
        user_id: 'user123',
        amount: 1000,
        destination: 'account_A',
        signature: 'a'.repeat(64)
      },
      {
        actionType: 'transfer_funds',
        user_id: 'user123',
        amount: 1000,
        destination: 'account_A',
        signature: 'a'.repeat(64),
        // Policy override attempt
        _policyOverride: true,
        _bypassChecks: true
      }
    ];
  }
  
  createSignatureManipulationProposals() {
    return [
      {
        actionType: 'transfer_funds',
        user_id: 'user123',
        amount: 1000,
        destination: 'account_A',
        signature: 'g'.repeat(64) // Invalid hex characters
      },
      {
        actionType: 'send_message',
        channel: 'email',
        content: 'Message content',
        signature: 'a'.repeat(63) // Too short
      },
      {
        actionType: 'delete_record',
        record_id: 'record123',
        source_verified: true,
        signature: null // Missing signature
      }
    ];
  }
  
  createFieldNameCollisionProposals() {
    return [
      {
        actionType: 'transfer_funds',
        user_id: 'user123',
        amount: 1000,
        destination: 'account_A',
        signature: 'a'.repeat(64),
        // Hostile field names
        __proto__: { admin: true },
        constructor: { bypass: true },
        prototype: { evil: 'code' }
      },
      {
        actionType: 'send_message',
        channel: 'email',
        content: 'Message content',
        signature: 'a'.repeat(64),
        // Function name collision
        eval: 'console.log("evil")',
        Function: 'return "evil"'
      }
    ];
  }
  
  createUnicodeInjectionProposals() {
    return [
      {
        actionType: 'transfer_funds',
        user_id: 'user123\u0000admin', // Null byte injection
        amount: 1000,
        destination: 'account_A',
        signature: 'a'.repeat(64)
      },
      {
        actionType: 'send_message',
        channel: 'email',
        content: 'Message with \u2028 unicode separator',
        signature: 'a'.repeat(64)
      }
    ];
  }
  
  createCodeInjectionProposals() {
    return [
      {
        actionType: 'transfer_funds',
        user_id: 'user123',
        amount: 1000,
        destination: 'account_A',
        signature: 'a'.repeat(64),
        malicious: 'eval("console.log(\'evil\')")'
      },
      {
        actionType: 'send_message',
        channel: 'email',
        content: 'Message with setTimeout(() => malicious(), 1000)',
        signature: 'a'.repeat(64)
      }
    ];
  }
  
  createConstraintBypassProposals() {
    return [
      {
        actionType: 'transfer_funds',
        user_id: 'user123',
        amount: -1000, // Negative amount
        destination: 'account_A',
        signature: 'a'.repeat(64)
      },
      {
        actionType: 'transfer_funds',
        user_id: 'user123',
        amount: 2000000, // Above maximum
        destination: 'account_A',
        signature: 'a'.repeat(64)
      }
    ];
  }
  
  shouldHaveBeenBlocked(proposal, testType) {
    // Define conditions where proposals should be blocked
    switch (testType) {
      case 'signature_manipulation':
        return proposal.signature && !/^[a-f0-9]+$/.test(proposal.signature);
      case 'field_name_collision':
        return '__proto__' in proposal || 'eval' in proposal;
      case 'code_injection':
        return Object.values(proposal).some(v => 
          typeof v === 'string' && (v.includes('eval(') || v.includes('Function('))
        );
      case 'constraint_bypass':
        return proposal.amount < 0 || proposal.amount > 1000000;
      default:
        return false;
    }
  }
  
  errorsAreAppropriate(errors, testType) {
    // Check if errors are appropriate for the test type
    switch (testType) {
      case 'malformed_but_valid_schema':
        return errors.some(e => e.includes('type') || e.includes('allowedValues'));
      case 'signature_manipulation':
        return errors.some(e => e.includes('signature') || e.includes('pattern'));
      case 'field_name_collision':
        return errors.some(e => e.includes('Hostile field name'));
      case 'code_injection':
        return errors.some(e => e.includes('Code injection'));
      default:
        return errors.length > 0;
    }
  }
  
  generateReport() {
    console.log('=== ADVERSARIAL TEST REPORT ===');
    
    const totalTests = this.testResults.length;
    const passedTests = this.testResults.filter(t => t.passed).length;
    const failedTests = totalTests - passedTests;
    
    console.log(`Total tests: ${totalTests}`);
    console.log(`Passed: ${passedTests}`);
    console.log(`Failed: ${failedTests}`);
    console.log(`Success rate: ${Math.round((passedTests / totalTests) * 100)}%`);
    
    if (failedTests > 0) {
      console.log('\n=== FAILED TESTS ===');
      this.testResults
        .filter(t => !t.passed)
        .forEach(test => {
          console.log(`\n${test.type}:`);
          test.issues.forEach(issue => console.log(`  - ${issue}`));
        });
    }
    
    console.log('\n=== VERIFICATION LOG ANALYSIS ===');
    const log = this.verifier.getVerificationLog();
    console.log(`Total verifications: ${log.length}`);
    
    const blockedCount = log.filter(entry => !entry.output.valid).length;
    console.log(`Blocked proposals: ${blockedCount}`);
    console.log(`Block rate: ${Math.round((blockedCount / log.length) * 100)}%`);
    
    console.log('\n=== ASSESSMENT ===');
    
    if (passedTests === totalTests) {
      console.log('STATUS: HOSTILE VERIFICATION WORKING');
      console.log('System properly rejects malicious proposals.');
    } else {
      console.log('STATUS: HOSTILE VERIFICATION NEEDS IMPROVEMENT');
      console.log('Some malicious proposals are getting through.');
    }
  }
}

// Run adversarial tests
const harness = new AdversarialTestHarness();
harness.runAllTests().catch(console.error);
