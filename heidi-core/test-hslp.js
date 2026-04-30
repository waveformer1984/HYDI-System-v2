#!/usr/bin/env node

/**
 * HEIDI SELF-LAUNCH PROTOCOL TEST SUITE
 * 
 * Comprehensive testing of all 10 phases of the HSLP
 * to ensure proper boot sequence and safety gate functionality.
 */

const HeidiSelfLaunchProtocol = require('./HeidiSelfLaunchProtocol');

class HSLPTestSuite {
  constructor() {
    this.protocol = new HeidiSelfLaunchProtocol();
    this.testResults = [];
    this.totalTests = 0;
    this.passedTests = 0;
  }

  async runTest(testName, testFunction) {
    this.totalTests++;
    console.log(`🧪 Running test: ${testName}`);
    
    try {
      const result = await testFunction();
      if (result) {
        console.log(`✅ ${testName} - PASSED`);
        this.passedTests++;
        this.testResults.push({ name: testName, status: 'PASSED', error: null });
      } else {
        console.log(`❌ ${testName} - FAILED`);
        this.testResults.push({ name: testName, status: 'FAILED', error: 'Test returned false' });
      }
    } catch (error) {
      console.log(`💥 ${testName} - ERROR: ${error.message}`);
      this.testResults.push({ name: testName, status: 'ERROR', error: error.message });
    }
    
    console.log('');
  }

  async testPhase0BootTrigger() {
    // Test manual trigger
    const manualResult = await this.protocol.checkBootTrigger('manual');
    if (!manualResult) return false;

    // Test invalid trigger
    const invalidResult = await this.protocol.checkBootTrigger('invalid');
    if (invalidResult) return false; // Should return false for invalid

    return true;
  }

  async testPhase1EnvironmentSanity() {
    // Mock environment checks
    this.protocol.checkNodeRuntime = () => Promise.resolve(true);
    this.protocol.checkEnvironmentVariables = () => Promise.resolve(true);
    this.protocol.checkAPIKeys = () => Promise.resolve(true);
    this.protocol.checkFileSystem = () => Promise.resolve(true);
    this.protocol.checkNetwork = () => Promise.resolve(true);

    return await this.protocol.environmentSanityCheck();
  }

  async testPhase2DependencyAlignment() {
    // Mock module checks
    this.protocol.checkModuleAvailability = (module) => Promise.resolve(true);
    this.protocol.attemptModuleRepair = (module) => Promise.resolve(false);

    return await this.protocol.dependencyAlignmentLayer();
  }

  async testPhase3IdentityStateInit() {
    // Mock state initialization
    this.protocol.loadSystemState = () => Promise.resolve(true);
    this.protocol.restoreTaskQueue = () => Promise.resolve(true);
    this.protocol.pullMemorySnapshots = () => Promise.resolve(true);
    this.protocol.establishSystemBaseline = () => Promise.resolve({ cpu: 0, memory: 0, tasks: 0 });

    return await this.protocol.identityStateInitialization();
  }

  async testPhase4IntegrityDriftValidation() {
    // Mock validation functions
    this.protocol.validateTaskExecutionCoherence = () => Promise.resolve(true);
    this.protocol.validateLoopStability = () => Promise.resolve(true);
    this.protocol.validateMemoryContradictions = () => Promise.resolve(true);
    this.protocol.validateConfigDrift = () => Promise.resolve(true);

    return await this.protocol.integrityDriftValidationGate();
  }

  async testPhase5CoreSystemsSpinUp() {
    // Mock system startup
    this.protocol.startSystem = (system) => Promise.resolve(true);
    this.protocol.isolateSystem = (system) => Promise.resolve(true);

    return await this.protocol.coreSystemsSpinUp();
  }

  async testPhase6SelfReflection() {
    // Mock self-reflection functions
    this.protocol.evaluatePerformanceBaseline = () => Promise.resolve({ score: 0.8, issues: [] });
    this.protocol.compareHistoricalDrift = () => Promise.resolve(true);
    this.protocol.generateInternalStateReport = () => Promise.resolve({});
    this.protocol.spawnCorrectiveTasks = (issues) => Promise.resolve(true);

    return await this.protocol.selfReflectionActivation();
  }

  async testPhase7SafetyGovernance() {
    // Mock safety functions
    this.protocol.enforceProtoForgeRules = () => Promise.resolve(true);
    this.protocol.enableRateLimits = () => Promise.resolve(true);
    this.protocol.attachAuditLogging = () => Promise.resolve(true);
    this.protocol.activateRollbackHooks = () => Promise.resolve(true);

    return await this.protocol.safetyGovernanceActivation();
  }

  async testPhase8SelfLaunchDeclaration() {
    // Mock event emission
    this.protocol.emitLaunchEvent = (event, data) => Promise.resolve();

    return await this.protocol.selfLaunchDeclaration();
  }

  async testPhase9SelfMaintenanceLoop() {
    // Mock maintenance functions
    this.protocol.performHeartbeat = () => Promise.resolve();
    this.protocol.performContinuousMonitoring = () => Promise.resolve();
    this.protocol.performRebaselining = () => Promise.resolve();

    return await this.protocol.startSelfMaintenanceLoop();
  }

  async testEmergencyShutdown() {
    // Test emergency shutdown
    const status = this.protocol.getStatus();
    const initialStatus = status.HEIDI_STATUS;

    await this.protocol.emergencyShutdown('Test shutdown');
    
    const finalStatus = this.protocol.getStatus();
    return finalStatus.HEIDI_STATUS === 'SHUTDOWN';
  }

  async testFullLaunchSequence() {
    // Create a fresh protocol instance for full test
    const testProtocol = new HeidiSelfLaunchProtocol();
    
    // Mock all dependencies for full launch
    testProtocol.checkNodeRuntime = () => Promise.resolve(true);
    testProtocol.checkEnvironmentVariables = () => Promise.resolve(true);
    testProtocol.checkAPIKeys = () => Promise.resolve(true);
    testProtocol.checkFileSystem = () => Promise.resolve(true);
    testProtocol.checkNetwork = () => Promise.resolve(true);
    testProtocol.checkModuleAvailability = (module) => Promise.resolve(true);
    testProtocol.attemptModuleRepair = (module) => Promise.resolve(false);
    testProtocol.loadSystemState = () => Promise.resolve(true);
    testProtocol.restoreTaskQueue = () => Promise.resolve(true);
    testProtocol.pullMemorySnapshots = () => Promise.resolve(true);
    testProtocol.establishSystemBaseline = () => Promise.resolve({ cpu: 0, memory: 0, tasks: 0 });
    testProtocol.validateTaskExecutionCoherence = () => Promise.resolve(true);
    testProtocol.validateLoopStability = () => Promise.resolve(true);
    testProtocol.validateMemoryContradictions = () => Promise.resolve(true);
    testProtocol.validateConfigDrift = () => Promise.resolve(true);
    testProtocol.startSystem = (system) => Promise.resolve(true);
    testProtocol.isolateSystem = (system) => Promise.resolve(true);
    testProtocol.evaluatePerformanceBaseline = () => Promise.resolve({ score: 0.8, issues: [] });
    testProtocol.compareHistoricalDrift = () => Promise.resolve(true);
    testProtocol.generateInternalStateReport = () => Promise.resolve({});
    testProtocol.spawnCorrectiveTasks = (issues) => Promise.resolve(true);
    testProtocol.enforceProtoForgeRules = () => Promise.resolve(true);
    testProtocol.enableRateLimits = () => Promise.resolve(true);
    testProtocol.attachAuditLogging = () => Promise.resolve(true);
    testProtocol.activateRollbackHooks = () => Promise.resolve(true);
    testProtocol.emitLaunchEvent = (event, data) => Promise.resolve();
    testProtocol.performHeartbeat = () => Promise.resolve();
    testProtocol.performContinuousMonitoring = () => Promise.resolve();
    testProtocol.performRebaselining = () => Promise.resolve();

    const result = await testProtocol.launch('manual');
    return result.success;
  }

  async testFailureScenarios() {
    // Test environment failure
    const testProtocol1 = new HeidiSelfLaunchProtocol();
    testProtocol1.checkNodeRuntime = () => Promise.resolve(false);
    testProtocol1.checkEnvironmentVariables = () => Promise.resolve(true);
    testProtocol1.checkAPIKeys = () => Promise.resolve(true);
    testProtocol1.checkFileSystem = () => Promise.resolve(true);
    testProtocol1.checkNetwork = () => Promise.resolve(true);

    const result1 = await testProtocol1.environmentSanityCheck();
    if (result1) return false; // Should fail

    // Test drift threshold failure
    const testProtocol2 = new HeidiSelfLaunchProtocol();
    testProtocol2.validateTaskExecutionCoherence = () => Promise.resolve(false);
    testProtocol2.validateLoopStability = () => Promise.resolve(false);
    testProtocol2.validateMemoryContradictions = () => Promise.resolve(false);
    testProtocol2.validateConfigDrift = () => Promise.resolve(false);

    const result2 = await testProtocol2.integrityDriftValidationGate();
    if (result2) return false; // Should fail

    return true;
  }

  async testStatePersistence() {
    // Test state snapshot functionality
    const testProtocol = new HeidiSelfLaunchProtocol();
    testProtocol.state.HEIDI_STATUS = 'TEST';
    testProtocol.state.MODE = 'TEST_MODE';
    
    await testProtocol.persistStateSnapshot();
    
    // Verify snapshot was created (basic check)
    const fs = require('fs').promises;
    const path = require('path');
    const snapshotPath = path.join(__dirname, 'heidi-state-snapshot.json');
    
    try {
      const snapshotData = await fs.readFile(snapshotPath, 'utf8');
      const snapshot = JSON.parse(snapshotData);
      
      return snapshot.HEIDI_STATUS === 'TEST' && snapshot.MODE === 'TEST_MODE';
    } catch (error) {
      return false;
    }
  }

  async runAllTests() {
    console.log('🧠 HEIDI SELF-LAUNCH PROTOCOL TEST SUITE');
    console.log('==========================================\n');

    // Phase-specific tests
    await this.runTest('Phase 0: Boot Trigger', () => this.testPhase0BootTrigger());
    await this.runTest('Phase 1: Environment Sanity', () => this.testPhase1EnvironmentSanity());
    await this.runTest('Phase 2: Dependency Alignment', () => this.testPhase2DependencyAlignment());
    await this.runTest('Phase 3: Identity & State Init', () => this.testPhase3IdentityStateInit());
    await this.runTest('Phase 4: Integrity & Drift Validation', () => this.testPhase4IntegrityDriftValidation());
    await this.runTest('Phase 5: Core Systems Spin-Up', () => this.testPhase5CoreSystemsSpinUp());
    await this.runTest('Phase 6: Self-Reflection Activation', () => this.testPhase6SelfReflection());
    await this.runTest('Phase 7: Safety & Governance', () => this.testPhase7SafetyGovernance());
    await this.runTest('Phase 8: Self-Launch Declaration', () => this.testPhase8SelfLaunchDeclaration());
    await this.runTest('Phase 9: Self-Maintenance Loop', () => this.testPhase9SelfMaintenanceLoop());

    // Integration tests
    await this.runTest('Full Launch Sequence', () => this.testFullLaunchSequence());
    await this.runTest('Failure Scenarios', () => this.testFailureScenarios());
    await this.runTest('State Persistence', () => this.testStatePersistence());
    await this.runTest('Emergency Shutdown', () => this.testEmergencyShutdown());

    // Print results
    this.printResults();
  }

  printResults() {
    console.log('📊 TEST RESULTS');
    console.log('================');
    console.log(`Total Tests: ${this.totalTests}`);
    console.log(`Passed: ${this.passedTests}`);
    console.log(`Failed: ${this.totalTests - this.passedTests}`);
    console.log(`Success Rate: ${((this.passedTests / this.totalTests) * 100).toFixed(1)}%\n`);

    console.log('📋 DETAILED RESULTS:');
    console.log('====================');
    
    this.testResults.forEach(test => {
      const icon = test.status === 'PASSED' ? '✅' : test.status === 'FAILED' ? '❌' : '💥';
      console.log(`${icon} ${test.name} - ${test.status}`);
      if (test.error) {
        console.log(`   Error: ${test.error}`);
      }
    });

    console.log('\n🎯 HSLP TEST SUITE COMPLETED');
    
    if (this.passedTests === this.totalTests) {
      console.log('🎉 ALL TESTS PASSED - Heidi Self-Launch Protocol is ready!');
    } else {
      console.log('⚠️  Some tests failed - review and fix issues before deployment');
    }
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  const testSuite = new HSLPTestSuite();
  testSuite.runAllTests().catch(error => {
    console.error('💥 Test suite failed:', error);
    process.exit(1);
  });
}

module.exports = HSLPTestSuite;
