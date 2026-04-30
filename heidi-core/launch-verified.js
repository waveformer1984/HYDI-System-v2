#!/usr/bin/env node

/**
 * VERIFIED LAUNCH SEQUENCE
 * 
 * Launches Heidi with mandatory baseline verification
 * and strict integrity requirements.
 * 
 * This is the CASCADER protocol implementation.
 */

const HeidiSelfLaunchProtocol = require('./HeidiSelfLaunchProtocol');
const BaselineInitializer = require('./baseline-initializer');

class VerifiedLaunchSequence {
  constructor() {
    this.protocol = new HeidiSelfLaunchProtocol();
    this.baselineInitializer = new BaselineInitializer();
  }

  async executeCascaderProtocol() {
    console.log('🚀 CASCADER PROTOCOL - HYDI SYSTEM LAUNCH');
    console.log('==========================================');
    
    try {
      // STEP 1: PRE-FLIGHT VALIDATION
      console.log('\n📋 STEP 1: PRE-FLIGHT VALIDATION');
      console.log('----------------------------------');
      
      const preflightValid = await this.preFlightValidation();
      if (!preflightValid.success) {
        console.error('❌ PRE-FLIGHT FAILED - HALTING');
        return { success: false, reason: 'preflight_failed', details: preflightValid.errors };
      }
      
      // STEP 2: STATE RECONCILIATION
      console.log('\n🔄 STEP 2: STATE RECONCILIATION');
      console.log('--------------------------------');
      
      const reconciliationValid = await this.stateReconciliation();
      if (!reconciliationValid.success) {
        console.error('❌ STATE RECONCILIATION FAILED - ENTERING STABILIZATION MODE');
        return { success: false, reason: 'reconciliation_failed', details: reconciliationValid.errors };
      }
      
      // STEP 3: MODULE INITIALIZATION
      console.log('\n⚙️  STEP 3: MODULE INITIALIZATION');
      console.log('----------------------------------');
      
      const moduleInitValid = await this.moduleInitialization();
      if (!moduleInitValid.success) {
        console.error('❌ MODULE INITIALIZATION FAILED - DEGRADED MODE ONLY');
        return { success: false, reason: 'module_init_failed', details: moduleInitValid.errors };
      }
      
      // STEP 4: INTEGRITY GATE
      console.log('\n🛡️  STEP 4: INTEGRITY GATE');
      console.log('--------------------------');
      
      const integrityValid = await this.integrityGate();
      if (!integrityValid.success) {
        console.error('❌ INTEGRITY GATE FAILED - BLOCKING FULL LAUNCH');
        return { success: false, reason: 'integrity_gate_failed', details: integrityValid.errors };
      }
      
      // STEP 5: LAUNCH AUTHORIZATION
      console.log('\n🎯 STEP 5: LAUNCH AUTHORIZATION');
      console.log('--------------------------------');
      
      const launchAuth = await this.launchAuthorization();
      if (!launchAuth.success) {
        console.error('❌ LAUNCH AUTHORIZATION FAILED');
        return { success: false, reason: 'launch_auth_failed', details: launchAuth.errors };
      }
      
      // STEP 6: POST-LAUNCH MONITORING
      console.log('\n📊 STEP 6: POST-LAUNCH MONITORING');
      console.log('-----------------------------------');
      
      await this.postLaunchMonitoring();
      
      console.log('\n🎉 HYDI SYSTEM ACTIVE — VERIFIED OPERATIONAL STATE');
      console.log('==================================================');
      
      return {
        success: true,
        status: this.protocol.state.HEIDI_STATUS,
        mode: this.protocol.state.MODE,
        integrity_score: this.protocol.state.integrity_score,
        drift_score: this.protocol.state.drift_score,
        launch_time: this.protocol.state.launch_time,
        verified_state: true
      };
      
    } catch (error) {
      console.error('💥 CASCADER PROTOCOL FAILED:', error.message);
      await this.protocol.emergencyShutdown('Cascader protocol failure');
      return { success: false, reason: 'protocol_exception', error: error.message };
    }
  }

  async preFlightValidation() {
    console.log('🔍 Verifying environment integrity...');
    
    const errors = [];
    
    // Verify baseline exists
    const baselineExists = await this.baselineInitializer.verifyBaselineIntegrity();
    if (!baselineExists) {
      errors.push('Baseline missing or corrupted - run baseline-initializer.js create');
    }
    
    // Verify environment
    const envValid = await this.protocol.environmentSanityCheck();
    if (!envValid) {
      errors.push('Environment sanity check failed');
    }
    
    // Verify dependencies
    const depsValid = await this.protocol.dependencyAlignmentLayer();
    if (!depsValid) {
      errors.push('Dependency alignment failed');
    }
    
    return {
      success: errors.length === 0,
      errors: errors
    };
  }

  async stateReconciliation() {
    console.log('🔄 Loading and reconciling state...');
    
    const errors = [];
    
    // Load baseline
    const baselineLoaded = await this.baselineInitializer.loadBaselineIntoProtocol();
    if (!baselineLoaded) {
      errors.push('Failed to load baseline');
    }
    
    // Initialize identity
    const identityValid = await this.protocol.identityStateInitialization();
    if (!identityValid) {
      errors.push('Identity initialization failed');
    }
    
    // Check for drift
    if (this.protocol.state.drift_score > 0) {
      console.warn(`⚠️  Drift detected: ${this.protocol.state.drift_score}`);
      console.warn(`🔍 Source: ${this.protocol.state.drift_classification?.source || 'unknown'}`);
      
      if (this.protocol.state.drift_score > this.protocol.config.DRIFT_THRESHOLD) {
        errors.push(`Drift ${this.protocol.state.drift_score} exceeds threshold ${this.protocol.config.DRIFT_THRESHOLD}`);
      }
    }
    
    return {
      success: errors.length === 0,
      errors: errors
    };
  }

  async moduleInitialization() {
    console.log('⚙️  Initializing core modules...');
    
    const errors = [];
    
    // Ordered module initialization
    const modules = ['Logger', 'TaskEngine', 'DriftMonitor', 'Scheduler', 'AdaptationExecutor'];
    
    for (const module of modules) {
      console.log(`🔄 Starting ${module}...`);
      
      try {
        const started = await this.protocol.startSystem(module);
        if (!started) {
          errors.push(`Failed to start ${module}`);
        } else {
          console.log(`✅ ${module} online`);
        }
      } catch (error) {
        errors.push(`Exception starting ${module}: ${error.message}`);
      }
    }
    
    return {
      success: errors.length === 0,
      errors: errors,
      degraded_mode: errors.length > 0 && errors.length < modules.length
    };
  }

  async integrityGate() {
    console.log('🛡️  Running adversarial integrity scan...');
    
    const errors = [];
    
    // Run comprehensive integrity validation
    const integrityValid = await this.protocol.integrityDriftValidationGate();
    if (!integrityValid) {
      errors.push('Integrity validation failed');
    }
    
    // Verify system integrity
    const integrityStatus = await this.protocol.getHealthStatus();
    // During integrity gate, we focus on integrity score rather than full health
    // Health will be verified in launch authorization phase
    
    // Check integrity score - lower threshold for integrity gate (pre-launch)
    const integrityThreshold = 0.8; // 80% required for integrity gate
    if (integrityStatus.integrity_score < integrityThreshold) {
      errors.push(`Integrity score ${integrityStatus.integrity_score} below ${integrityThreshold} threshold`);
    }
    
    return {
      success: errors.length === 0,
      errors: errors,
      integrity_score: integrityStatus.integrity_score,
      system_state: integrityStatus.system_state
    };
  }

  async launchAuthorization() {
    console.log('🎯 Authorizing launch...');
    
    const errors = [];
    
    // Check all critical conditions
    const criticalViolations = this.protocol.state.error_log.filter(e => e.severity === 'CRITICAL');
    if (criticalViolations.length > 0) {
      errors.push(`Critical violations: ${criticalViolations.length}`);
    }
    
    // Check drift
    if (this.protocol.state.drift_score > 0) {
      errors.push(`Non-zero drift score: ${this.protocol.state.drift_score}`);
    }
    
    // Check module readiness
    const integrityStatus = await this.protocol.getHealthStatus();
    const criticalFailedChecks = integrityStatus.failed_checks.filter(check => 
      check !== 'heartbeat_ready' // Heartbeat activates during launch declaration
    );
    
    if (criticalFailedChecks.length > 0) {
      errors.push(`Unresolved issues: ${criticalFailedChecks.length}`);
      errors.push(`Failed checks: ${criticalFailedChecks.join(', ')}`);
    }
    
    if (errors.length === 0) {
      // Authorize launch
      const launchSuccess = await this.protocol.selfLaunchDeclaration();
      if (!launchSuccess) {
        errors.push('Launch declaration failed');
      }
    }
    
    return {
      success: errors.length === 0,
      errors: errors
    };
  }

  async postLaunchMonitoring() {
    console.log('📊 Starting post-launch monitoring...');
    
    // Start self-maintenance loops
    await this.protocol.startSelfMaintenanceLoop();
    
    // Setup emergency shutdown handlers
    this.protocol.setupEmergencyShutdown();
    
    // Start continuous monitoring
    console.log('🔄 Continuous drift evaluation active');
    console.log('🔍 Anomaly detection active');
    console.log('🛡️  Containment mode armed');
    console.log('💾 Rollback snapshot locked');
    
    // Display final status - NO STATE REWRITE AFTER EVALUATION
    const status = await this.protocol.getHealthStatus();
    console.log(`\n📊 Final Status:`);
    console.log(`   System: ${status.HEIDI_STATUS}`);
    console.log(`   Mode: ${status.MODE}`);
    
    // DISPLAY ORIGINAL LAUNCH EVALUATION - NO REWRITE
    console.log(`   Launch Integrity: ${this.protocol.state.launch_integrity_score?.toFixed(3) || 'N/A'} (EVALUATION)`);
    console.log(`   Launch Failed Checks: ${this.protocol.state.launch_failed_checks?.join(', ') || 'NONE'}`);
    
    // Current runtime state (separate from launch evaluation)
    console.log(`   Current Integrity: ${status.integrity_score.toFixed(3)} (RUNTIME)`);
    console.log(`   Current Drift: ${status.drift_score.toFixed(3)} (RUNTIME)`);
    console.log(`   System State: ${status.system_state}`);
    
    // Truth consistency check - compare evaluation vs runtime
    if (this.protocol.state.launch_integrity_score < 1.0 && status.HEIDI_STATUS === 'ACTIVE') {
      console.log(`   ⚠️  TRUTH ALERT: ACTIVE status with launch integrity < 1.0`);
      console.log(`   🔍 Launch evaluation: ${this.protocol.state.launch_integrity_score?.toFixed(3)}`);
      console.log(`   🔍 Runtime integrity: ${status.integrity_score.toFixed(3)}`);
    }
  }
}

// Execute if run directly
if (require.main === module) {
  const cascader = new VerifiedLaunchSequence();
  cascader.executeCascaderProtocol().then(result => {
    if (result.success) {
      console.log('\n✅ CASCADER PROTOCOL COMPLETED SUCCESSFULLY');
      process.exit(0);
    } else {
      console.log('\n❌ CASCADER PROTOCOL FAILED');
      console.log(`Reason: ${result.reason}`);
      if (result.details) {
        console.log('Details:', result.details);
      }
      process.exit(1);
    }
  }).catch(error => {
    console.error('💥 CASCADER PROTOCOL EXCEPTION:', error);
    process.exit(1);
  });
}

module.exports = VerifiedLaunchSequence;
