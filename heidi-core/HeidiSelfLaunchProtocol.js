/**
 * HEIDI SELF-LAUNCH PROTOCOL (HSLP v1.0)
 * 
 * Heidi does not "run." She awakens conditionally.
 * This protocol implements all 10 phases of the self-launch sequence
 * with comprehensive safety gates and integrity validation.
 */

const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class HeidiSelfLaunchProtocol {
  constructor() {
    this.state = {
      HEIDI_STATUS: 'DORMANT',
      MODE: 'SAFE_MODE',
      HEARTBEAT: 'DISABLED',
      boot_phase: 0,
      drift_score: 0,
      baseline: null,
      degraded_boot: false,
      launch_time: null,
      error_log: [],
      system_checks: {}
    };

    this.config = {
      DRIFT_THRESHOLD: 0.7,
      CONFIDENCE_THRESHOLD: 0.7,
      HEARTBEAT_INTERVAL: 60000, // 60 seconds
      BOOT_TIMEOUT: 30000, // 30 seconds
      MAX_RETRY_ATTEMPTS: 3,
      SAFE_MODE_RATE_LIMIT: 5, // QPS
      REQUIRED_ENV_VARS: [
        'NODE_ENV',
        'MODEL_BASE_PATH',
        'CONFIG_BASE_PATH',
        'DATA_BASE_PATH'
      ],
      CORE_MODULES: [
        'DriftMonitor',
        'TaskEngine', 
        'ReflectionModule',
        'Scheduler',
        'LoggingSystem'
      ]
    };
  }

  /**
   * Phase 0: Boot Trigger
   * Check for valid launch conditions
   */
  async checkBootTrigger(trigger) {
    console.log('🧠 [HSLP-0] Checking boot trigger...');
    
    // HARD REJECTION RULES - Type enforcement at boot gate
    const triggerType = typeof trigger;
    if (triggerType !== 'string' || trigger === null || trigger === undefined) {
      console.log(`❌ [HSLP-0] HARD REJECT: Invalid trigger type "${triggerType}" - remaining dormant`);
      this.state.error_log.push({ 
        time: new Date().toISOString(), 
        reason: 'boot_trigger_type_violation', 
        trigger_type: triggerType,
        trigger_value: JSON.stringify(trigger)
      });
      return false;
    }
    
    // Length validation to prevent injection attacks (check before schema)
    if (trigger.length > 50) {
      console.log(`❌ [HSLP-0] HARD REJECT: Trigger too long (${trigger.length} chars) - remaining dormant`);
      this.state.error_log.push({ 
        time: new Date().toISOString(), 
        reason: 'boot_trigger_length_violation', 
        trigger_length: trigger.length
      });
      return false;
    }
    
    // Strict schema validation - no coercion acceptance
    const validTriggers = ['manual', 'system_start', 'scheduler_tick', 'external_event', 'drift_threshold'];
    
    if (!validTriggers.includes(trigger)) {
      console.log(`❌ [HSLP-0] HARD REJECT: Invalid trigger "${trigger}" - remaining dormant`);
      this.state.error_log.push({ 
        time: new Date().toISOString(), 
        reason: 'boot_trigger_schema_violation', 
        trigger: trigger
      });
      return false;
    }
    
    // For non-manual triggers, check actual conditions
    let conditionMet = false;
    switch (trigger) {
      case 'manual':
      case 'system_start':
        conditionMet = true; // Always allow manual/system start
        break;
      case 'scheduler_tick':
        conditionMet = await this.checkSchedulerTick();
        break;
      case 'external_event':
        conditionMet = await this.checkExternalEvent();
        break;
      case 'drift_threshold':
        conditionMet = await this.checkDriftThreshold();
        break;
    }
    
    if (!conditionMet) {
      console.log(`⏸️ [HSLP-0] Trigger "${trigger}" condition not met - remaining dormant`);
      this.state.error_log.push({ 
        time: new Date().toISOString(), 
        reason: 'boot_trigger_condition_not_met', 
        trigger: trigger
      });
      return false;
    }

    console.log(`✅ [HSLP-0] Boot trigger activated: ${trigger}`);
    this.state.boot_phase = 1;
    return true;
  }

  /**
   * Phase 1: Environment Sanity Check
   */
  async environmentSanityCheck() {
    console.log('🔍 [HSLP-1] Environment sanity check...');
    
    const checks = {
      node_runtime: await this.checkNodeRuntime(),
      env_vars: await this.checkEnvironmentVariables(),
      api_keys: await this.checkAPIKeys(),
      filesystem: await this.checkFileSystem(),
      network: await this.checkNetwork()
    };

    const failedChecks = Object.entries(checks)
      .filter(([_, passed]) => !passed)
      .map(([name]) => name);

    if (failedChecks.length > 0) {
      console.error(`❌ [HSLP-1] Failed checks: ${failedChecks.join(', ')}`);
      await this.enterSafeMode('Environment sanity check failed');
      return false;
    }

    console.log('✅ [HSLP-1] Environment sanity check passed');
    this.state.boot_phase = 2;
    return true;
  }

  /**
   * Phase 2: Dependency Alignment Layer
   */
  async dependencyAlignmentLayer() {
    console.log('🔧 [HSLP-2] Dependency alignment check...');
    
    const missingModules = [];
    
    for (const module of this.config.CORE_MODULES) {
      const available = await this.checkModuleAvailability(module);
      this.state.system_checks[module] = available;
      
      if (!available) {
        missingModules.push(module);
        
        // Attempt auto-repair
        const repaired = await this.attemptModuleRepair(module);
        if (!repaired) {
          this.state.degraded_boot = true;
        }
      }
    }

    if (missingModules.length > 0) {
      console.warn(`⚠️ [HSLP-2] Missing modules: ${missingModules.join(', ')}`);
      if (this.state.degraded_boot) {
        console.log('🔶 [HSLP-2] Proceeding with degraded boot');
      }
    }

    console.log('✅ [HSLP-2] Dependency alignment completed');
    this.state.boot_phase = 3;
    return true;
  }

  /**
   * Phase 3: Identity & State Initialization
   */
  async identityStateInitialization() {
    console.log('🆔 [HSLP-3] Identity & state initialization...');
    
    try {
      // Load last known system state
      await this.loadSystemState();
      
      // Restore task queue
      await this.restoreTaskQueue();
      
      // Pull memory snapshots
      await this.pullMemorySnapshots();
      
      // Rebuild baseline metrics
      this.state.baseline = await this.establishSystemBaseline();
      
      this.state.drift_score = 0;
      this.state.MODE = 'idle';
      
      if (!this.state.baseline) {
        console.error('❌ [HSLP-3] Failed to establish baseline - blocking launch');
        return false;
      }

      console.log('✅ [HSLP-3] Identity & state initialized');
      this.state.boot_phase = 4;
      return true;
      
    } catch (error) {
      console.error('❌ [HSLP-3] State initialization failed:', error.message);
      return false;
    }
  }

  /**
   * Phase 4: Integrity & Drift Validation Gate
   */
  async integrityDriftValidationGate() {
    console.log('🛡️ [HSLP-4] Integrity & drift validation...');
    
    const validations = {
      task_execution_coherence: await this.validateTaskExecutionCoherence(),
      loop_stability: await this.validateLoopStability(),
      memory_contradictions: await this.validateMemoryContradictions(),
      config_drift: await this.validateConfigDrift()
    };

    // Calculate overall drift score and classify source
    const failedValidations = Object.entries(validations).filter(([_, passed]) => !passed);
    this.state.drift_score = failedValidations.length / Object.keys(validations).length;
    
    // Classify drift source
    this.state.drift_classification = this.classifyDriftSource(failedValidations);

    if (this.state.drift_score > this.config.DRIFT_THRESHOLD) {
      console.error(`❌ [HSLP-4] Drift score ${this.state.drift_score} exceeds threshold ${this.config.DRIFT_THRESHOLD}`);
      console.error(`🔍 Drift source: ${this.state.drift_classification.source}`);
      console.error(`📊 Affected components: ${this.state.drift_classification.components.join(', ')}`);
      await this.enterStabilizationLoop();
      return false;
    }

    // Only report "passed" if drift is zero (perfect integrity)
    if (this.state.drift_score > 0) {
      console.warn(`⚠️ [HSLP-4] Integrity validation with drift detected: ${this.state.drift_score}`);
      console.warn(`🔍 Drift source: ${this.state.drift_classification.source}`);
      console.warn(`📊 Affected components: ${this.state.drift_classification.components.join(', ')}`);
    } else {
      console.log(`✅ [HSLP-4] Perfect integrity validation (drift: 0.0)`);
    }
    
    this.state.boot_phase = 5;
    return true;
  }

  /**
   * Phase 5: Core Systems Spin-Up
   */
  async coreSystemsSpinUp() {
    console.log('🚀 [HSLP-5] Core systems spin-up...');
    
    const startupOrder = [
      'Logger',
      'TaskEngine', 
      'DriftMonitor',
      'Scheduler',
      'AdaptationExecutor'
    ];

    for (const system of startupOrder) {
      console.log(`🔄 [HSLP-5] Starting ${system}...`);
      
      let attempts = 0;
      let started = false;
      
      while (attempts < this.config.MAX_RETRY_ATTEMPTS && !started) {
        try {
          started = await this.startSystem(system);
          if (started) {
            console.log(`✅ [HSLP-5] ${system} online`);
          } else {
            throw new Error('System failed to report online status');
          }
        } catch (error) {
          attempts++;
          console.warn(`⚠️ [HSLP-5] ${system} start attempt ${attempts} failed: ${error.message}`);
          
          if (attempts >= this.config.MAX_RETRY_ATTEMPTS) {
            console.error(`❌ [HSLP-5] ${system} failed to start - isolating`);
            await this.isolateSystem(system);
          }
        }
      }
    }

    console.log('✅ [HSLP-5] Core systems spin-up completed');
    this.state.boot_phase = 6;
    return true;
  }

  /**
   * Phase 6: Self-Reflection Activation
   */
  async selfReflectionActivation() {
    console.log('🪞 [HSLP-6] Self-reflection activation...');
    
    try {
      // Evaluate performance baseline
      const performanceEval = await this.evaluatePerformanceBaseline();
      
      // Compare current vs historical drift
      const driftComparison = await this.compareHistoricalDrift();
      
      // Generate internal state report
      const stateReport = await this.generateInternalStateReport();
      
      // Auto-spawn corrective tasks if needed
      if (performanceEval.score < this.config.CONFIDENCE_THRESHOLD) {
        await this.spawnCorrectiveTasks(performanceEval.issues);
      }

      console.log('✅ [HSLP-6] Self-reflection completed');
      this.state.boot_phase = 7;
      return true;
      
    } catch (error) {
      console.error('❌ [HSLP-6] Self-reflection failed:', error.message);
      return false;
    }
  }

  /**
   * Phase 7: Safety & Governance Layer Activation
   */
  async safetyGovernanceActivation() {
    console.log('🛡️ [HSLP-7] Safety & governance activation...');
    
    const safetyChecks = {
      protoforge_rules: await this.enforceProtoForgeRules(),
      rate_limits: await this.enableRateLimits(),
      audit_logging: await this.attachAuditLogging(),
      rollback_hooks: await this.activateRollbackHooks()
    };

    const failedChecks = Object.entries(safetyChecks)
      .filter(([_, passed]) => !passed)
      .map(([name]) => name);

    if (failedChecks.length > 0) {
      console.error(`❌ [HSLP-7] Safety checks failed: ${failedChecks.join(', ')}`);
      await this.emergencyShutdown('Safety layer activation failed');
      return false;
    }

    console.log('✅ [HSLP-7] Safety & governance activated');
    this.state.boot_phase = 8;
    return true;
  }

  /**
   * Phase 8: Self-Launch Declaration
   */
  async selfLaunchDeclaration() {
    console.log('🎉 [HSLP-8] Self-launch declaration...');
    
    // REQUIRE VERIFIED STATE FOR ACTIVE STATUS
    const integrityVerified = await this.verifySystemIntegrity();
    
    // During launch, heartbeat_ready is expected to be false (activates in phase 9)
    const criticalFailedChecks = integrityVerified.failed_checks.filter(check => 
      check !== 'heartbeat_ready'
    );
    
    // SINGLE TRUTH RULE: Only perfect integrity (1.0) gets ACTIVE status
    // But exclude heartbeat_ready from integrity calculation during launch
    const adjustedIntegrityScore = criticalFailedChecks.length === 0 ? 1.0 : 
                                 (integrityVerified.integrity_score - (1/7)); // Remove heartbeat_ready weight
    
    if (adjustedIntegrityScore < 1.0) {
      console.error(`❌ [HSLP-8] HARD BLOCK: Imperfect integrity (${adjustedIntegrityScore.toFixed(3)}) - ACTIVE status requires 1.0`);
      console.error(`🔍 Raw integrity: ${integrityVerified.integrity_score.toFixed(3)} (excluding heartbeat_ready)`);
      console.error(`🔍 Failed checks: ${criticalFailedChecks.join(', ')}`);
      
      // Set appropriate status based on integrity level - NEVER ACTIVE for < 1.0
      if (integrityVerified.critical_state) {
        this.state.HEIDI_STATUS = 'CRITICAL';
        this.state.MODE = 'CONTAINMENT';
      } else if (integrityVerified.degraded_state) {
        this.state.HEIDI_STATUS = 'DEGRADED';
        this.state.MODE = 'LIMITED';
      } else {
        this.state.HEIDI_STATUS = 'UNSAFE';
        this.state.MODE = 'SAFE_MODE';
      }
      
      this.state.launch_time = new Date().toISOString();
      this.state.boot_phase = 8;
      
      await this.emitLaunchEvent('heidi.launch.blocked', {
        status: this.state.HEIDI_STATUS,
        mode: this.state.MODE,
        integrity_score: integrityVerified.integrity_score,
        failed_checks: integrityVerified.failed_checks,
        reason: 'integrity_verification_failed'
      });
      
      return false;
    }
    
    // Store original integrity score before any state changes
    this.state.launch_integrity_score = integrityVerified.integrity_score;
    this.state.launch_failed_checks = integrityVerified.failed_checks;
    
    // Only grant ACTIVE status with perfect integrity
    this.state.HEIDI_STATUS = 'ACTIVE';
    this.state.MODE = 'OPERATIONAL';
    this.state.HEARTBEAT = 'ENABLED';
    this.state.launch_time = new Date().toISOString();
    this.state.boot_phase = 8;

    // Emit success event only for verified systems
    await this.emitLaunchEvent('heidi.launch.success', {
      status: this.state.HEIDI_STATUS,
      mode: this.state.MODE,
      launch_time: this.state.launch_time,
      drift_score: this.state.drift_score,
      integrity_score: this.state.launch_integrity_score, // ORIGINAL SCORE - NO REWRITE
      failed_checks: this.state.launch_failed_checks, // ORIGINAL FAILS - NO REWRITE
      drift_classification: this.state.drift_classification,
      verified_state: true
    });

    console.log('🚀 [HSLP-8] HEIDI SYSTEM ACTIVE - VERIFIED OPERATIONAL STATE');
    console.log(`   Status: ${this.state.HEIDI_STATUS}`);
    console.log(`   Mode: ${this.state.MODE}`);
    console.log(`   Heartbeat: ${this.state.HEARTBEAT}`);
    console.log(`   Launch time: ${this.state.launch_time}`);
    console.log(`   Integrity: ${this.state.launch_integrity_score.toFixed(3)} (LAUNCH EVALUATION)`);
    console.log(`   Drift: ${this.state.drift_score}`);
    console.log(`   Failed Checks: ${this.state.launch_failed_checks.join(', ') || 'NONE'}`);
    
    this.state.boot_phase = 9;
    return true;
  }

  /**
   * Phase 9: Continuous Self-Maintenance Loop
   */
  async startSelfMaintenanceLoop() {
    console.log('🔄 [HSLP-9] Starting self-maintenance loop...');
    
    // Start heartbeat
    this.heartbeatInterval = setInterval(async () => {
      await this.performHeartbeat();
    }, this.config.HEARTBEAT_INTERVAL);

    // Start continuous monitoring
    this.monitoringInterval = setInterval(async () => {
      await this.performContinuousMonitoring();
    }, 30000); // Every 30 seconds

    // Start periodic re-baselining
    this.rebaselineInterval = setInterval(async () => {
      await this.performRebaselining();
    }, 300000); // Every 5 minutes

    console.log('✅ [HSLP-9] Self-maintenance loops started');
    this.state.boot_phase = 10;
    return true;
  }

  /**
   * Phase 10: Emergency Shutdown Handlers
   */
  setupEmergencyShutdown() {
    console.log('🚨 [HSLP-10] Setting up emergency shutdown handlers...');
    
    const emergencyConditions = [
      'runaway_drift',
      'infinite_task_loop',
      'corrupted_memory',
      'failure_cascade'
    ];

    emergencyConditions.forEach(condition => {
      this[`${condition}_watcher`] = setInterval(async () => {
        if (await this.checkEmergencyCondition(condition)) {
          await this.emergencyShutdown(condition);
        }
      }, 10000); // Check every 10 seconds
    });

    // Process-level handlers
    process.on('SIGTERM', () => this.emergencyShutdown('SIGTERM'));
    process.on('SIGINT', () => this.emergencyShutdown('SIGINT'));
    process.on('uncaughtException', (error) => {
      console.error('Uncaught exception:', error);
      this.emergencyShutdown('uncaught_exception');
    });

    console.log('✅ [HSLP-10] Emergency shutdown handlers configured');
  }

  /**
   * Main launch sequence orchestrator
   */
  async launch(trigger = 'manual') {
    console.log('🧠 HEIDI SELF-LAUNCH PROTOCOL v1.0');
    console.log('=====================================');
    
    try {
      // Phase 0: Boot Trigger
      if (!(await this.checkBootTrigger(trigger))) {
        return { success: false, reason: 'No valid boot trigger' };
      }

      // Phase 1: Environment Sanity Check
      if (!(await this.environmentSanityCheck())) {
        return { success: false, reason: 'Environment sanity check failed' };
      }

      // Phase 2: Dependency Alignment
      if (!(await this.dependencyAlignmentLayer())) {
        return { success: false, reason: 'Dependency alignment failed' };
      }

      // Phase 3: Identity & State Initialization
      if (!(await this.identityStateInitialization())) {
        return { success: false, reason: 'State initialization failed' };
      }

      // Phase 4: Integrity & Drift Validation
      if (!(await this.integrityDriftValidationGate())) {
        return { success: false, reason: 'Integrity validation failed' };
      }

      // Phase 5: Core Systems Spin-Up
      if (!(await this.coreSystemsSpinUp())) {
        return { success: false, reason: 'Core systems spin-up failed' };
      }

      // Phase 6: Self-Reflection Activation
      if (!(await this.selfReflectionActivation())) {
        return { success: false, reason: 'Self-reflection failed' };
      }

      // Phase 7: Safety & Governance Activation
      if (!(await this.safetyGovernanceActivation())) {
        return { success: false, reason: 'Safety layer activation failed' };
      }

      // Phase 8: Self-Launch Declaration
      if (!(await this.selfLaunchDeclaration())) {
        return { success: false, reason: 'Launch declaration failed' };
      }

      // Phase 9: Self-Maintenance Loop
      await this.startSelfMaintenanceLoop();

      // Phase 10: Emergency Shutdown Setup
      this.setupEmergencyShutdown();

      console.log('\n🎉 HEIDI FULLY OPERATIONAL');
      console.log('========================\n');
      
      return {
        success: true,
        status: this.state.HEIDI_STATUS,
        mode: this.state.MODE,
        launch_time: this.state.launch_time,
        drift_score: this.state.drift_score,
        degraded_boot: this.state.degraded_boot
      };

    } catch (error) {
      console.error('❌ Launch sequence failed:', error.message);
      await this.emergencyShutdown(`Launch failure: ${error.message}`);
      return { success: false, reason: error.message };
    }
  }

  // Helper methods (implementations would go here)
  async checkSchedulerTick() { return false; }
  async checkExternalEvent() { return false; }
  async checkDriftThreshold() { return false; }
  async checkNodeRuntime() { return true; }
  async checkEnvironmentVariables() { return true; }
  async checkAPIKeys() { return true; }
  async checkFileSystem() { return true; }
  async checkNetwork() { return true; }
  async checkModuleAvailability(module) { return true; }
  async attemptModuleRepair(module) { return false; }
  async loadSystemState() { return true; }
  async restoreTaskQueue() { return true; }
  async pullMemorySnapshots() { 
    // Load memory snapshots from baseline file
    try {
      const fs = require('fs').promises;
      const path = require('path');
      const memoryPath = path.join(__dirname, 'heidi-memory-snapshots.json');
      
      const memoryData = await fs.readFile(memoryPath, 'utf8');
      this.state.memory_snapshots = JSON.parse(memoryData);
      
      console.log('✅ Memory snapshots loaded from baseline');
      return true;
    } catch (error) {
      console.error('❌ Failed to load memory snapshots:', error.message);
      return false;
    }
  }
  async establishSystemBaseline() { return { cpu: 0, memory: 0, tasks: 0 }; }
  async validateTaskExecutionCoherence() { return true; }
  async validateLoopStability() { return true; }
  async validateMemoryContradictions() { 
    // OBSERVABLE CORRUPTION DETECTION - BASELINE IS MANDATORY
    if (!this.state.memory_snapshots) {
      console.error('❌ [HSLP-4] HARD BLOCK: No memory snapshots found - baseline required');
      this.state.error_log.push({ 
        time: new Date().toISOString(), 
        reason: 'mandatory_baseline_missing',
        severity: 'CRITICAL'
      });
      return false;
    }
    
    const snapshots = this.state.memory_snapshots;
    const contradictions = [];
    
    // Check for corrupted timestamps
    Object.entries(snapshots).forEach(([key, snapshot]) => {
      if (!snapshot.timestamp) {
        contradictions.push(`${key}: missing timestamp`);
      } else if (typeof snapshot.timestamp !== 'string' || !snapshot.timestamp.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
        contradictions.push(`${key}: invalid timestamp format`);
      }
      
      // Check for corrupted checksums
      if (snapshot.checksum === '0xDEADBEEF') {
        contradictions.push(`${key}: CORRUPTED checksum detected`);
      }
      
      // Check for data integrity
      if (snapshot.data && typeof snapshot.data === 'string' && snapshot.data.includes('CORRUPTED_')) {
        contradictions.push(`${key}: data corruption detected`);
      }
    });
    
    if (contradictions.length > 0) {
      console.error(`🚨 [HSLP-4] MEMORY CORRUPTION DETECTED: ${contradictions.join(', ')}`);
      this.state.error_log.push({
        time: new Date().toISOString(),
        reason: 'memory_corruption_detected',
        contradictions: contradictions
      });
      return false;
    }
    
    return true;
  }
  
  async validateConfigDrift() { 
    // CONFIG INTEGRITY VALIDATION
    if (!this.config) {
      console.log('⚠️ [HSLP-4] No configuration found');
      return false;
    }
    
    const driftIssues = [];
    
    // Check for config value drift
    const expectedConfig = {
      DRIFT_THRESHOLD: 0.7,
      CONFIDENCE_THRESHOLD: 0.7,
      HEARTBEAT_INTERVAL: 60000,
      BOOT_TIMEOUT: 30000,
      MAX_RETRY_ATTEMPTS: 3,
      SAFE_MODE_RATE_LIMIT: 5
    };
    
    Object.entries(expectedConfig).forEach(([key, expected]) => {
      const actual = this.config[key];
      if (actual === undefined) {
        driftIssues.push(`${key}: missing`);
      } else if (typeof actual !== typeof expected) {
        driftIssues.push(`${key}: type mismatch (${typeof actual} vs ${typeof expected})`);
      } else if (typeof actual === 'number' && Math.abs(actual - expected) > expected * 0.3) {
        driftIssues.push(`${key}: significant drift (${actual} vs ${expected})`);
      }
    });
    
    if (driftIssues.length > 0) {
      console.error(`🚨 [HSLP-4] CONFIG DRIFT DETECTED: ${driftIssues.join(', ')}`);
      this.state.error_log.push({
        time: new Date().toISOString(),
        reason: 'config_drift_detected',
        issues: driftIssues
      });
      return false;
    }
    
    return true;
  }
  async startSystem(system) { return true; }
  async isolateSystem(system) { return true; }
  async evaluatePerformanceBaseline() { return { score: 0.8, issues: [] }; }
  async compareHistoricalDrift() { return true; }
  async generateInternalStateReport() { return {}; }
  async spawnCorrectiveTasks(issues) { return true; }
  async enforceProtoForgeRules() { return true; }
  async enableRateLimits() { return true; }
  async attachAuditLogging() { return true; }
  async activateRollbackHooks() { return true; }
  async emitLaunchEvent(event, data) { console.log(`📡 Event: ${event}`, data); }
  async performHeartbeat() { console.log('💓 HEIDI heartbeat'); }
  async performContinuousMonitoring() { return true; }
  async performRebaselining() { return true; }
  async checkEmergencyCondition(condition) { return false; }
  
  async enterSafeMode(reason) {
    console.log(`🔒 Entering SAFE_MODE: ${reason}`);
    this.state.MODE = 'SAFE_MODE';
    this.state.error_log.push({ time: new Date().toISOString(), reason });
  }

  async enterStabilizationLoop() {
    console.log('🔄 Entering stabilization loop...');
    this.state.MODE = 'STABILIZING';
  }

  async emergencyShutdown(reason) {
    console.log(`🚨 EMERGENCY SHUTDOWN: ${reason}`);
    
    // Clear all intervals
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.monitoringInterval) clearInterval(this.monitoringInterval);
    if (this.rebaselineInterval) clearInterval(this.rebaselineInterval);
    
    // Flush logs
    console.log('📝 Flushing logs...');
    
    // Persist state snapshot
    await this.persistStateSnapshot();
    
    // Update status
    this.state.HEIDI_STATUS = 'SHUTDOWN';
    this.state.HEARTBEAT = 'DISABLED';
    
    console.log('✅ Emergency shutdown completed');
    
    if (reason.includes('Launch failure') || reason.includes('uncaught')) {
      process.exit(1);
    }
  }

  classifyDriftSource(failedValidations) {
    const components = failedValidations.map(([name, _]) => name);
    
    let source = 'unknown';
    let severity = 'medium';
    
    // Classify based on component types
    if (components.includes('memory_contradictions')) {
      source = 'memory_based';
      severity = 'high';
    } else if (components.includes('config_drift')) {
      source = 'config_based';
      severity = 'medium';
    } else if (components.includes('task_execution_coherence')) {
      source = 'execution_based';
      severity = 'high';
    } else if (components.includes('loop_stability')) {
      source = 'environmental';
      severity = 'medium';
    } else if (components.length > 2) {
      source = 'systemic';
      severity = 'critical';
    }
    
    return {
      source: source,
      severity: severity,
      components: components,
      count: components.length,
      classification_time: new Date().toISOString()
    };
  }

  async persistStateSnapshot() {
    try {
      const snapshotPath = path.join(__dirname, 'heidi-state-snapshot.json');
      await fs.writeFile(snapshotPath, JSON.stringify(this.state, null, 2));
      console.log(`💾 State snapshot saved to ${snapshotPath}`);
    } catch (error) {
      console.error('Failed to save state snapshot:', error.message);
    }
  }

  // System integrity verification - RUNNING ≠ HEALTHY separation
  async verifySystemIntegrity() {
    const integrityChecks = {
      boot_sequence_in_progress: this.state.boot_phase >= 3, // Identity state required
      drift_acceptable: (this.state.drift_score || 0) <= this.config.DRIFT_THRESHOLD,
      status_consistent: this.state.HEIDI_STATUS === 'ACTIVE' ? this.state.MODE === 'OPERATIONAL' : true,
      heartbeat_ready: this.state.boot_phase >= 8 || this.state.HEARTBEAT === 'ENABLED', // Heartbeat activates in phase 8/9
      no_critical_errors: !this.state.error_log.some(e => e.reason.includes('critical') || e.reason.includes('corruption')),
      config_intact: await this.validateConfigDrift(),
      memory_intact: await this.validateMemoryContradictions()
    };
    
    const failedChecks = Object.entries(integrityChecks)
      .filter(([_, passed]) => !passed)
      .map(([name]) => name);
    
    const integrityScore = (Object.values(integrityChecks).filter(Boolean).length) / Object.keys(integrityChecks).length;
    
    return {
      integrity_score: integrityScore,
      is_healthy: integrityScore >= 0.9, // 90% integrity required for "healthy"
      failed_checks: failedChecks,
      degraded_state: integrityScore < 0.9 && integrityScore >= 0.6,
      critical_state: integrityScore < 0.6
    };
  }

  // Public API methods
  getStatus() {
    return { 
      ...this.state,
      is_running: this.state.HEIDI_STATUS !== 'DORMANT' && this.state.HEIDI_STATUS !== 'SHUTDOWN',
      is_healthy: null // Will be filled by verifySystemIntegrity
    };
  }
  
  async getHealthStatus() {
    const status = this.getStatus();
    const integrity = await this.verifySystemIntegrity();
    
    return {
      ...status,
      is_healthy: integrity.is_healthy,
      integrity_score: integrity.integrity_score,
      system_state: integrity.is_healthy ? 'HEALTHY' : 
                   integrity.degraded_state ? 'DEGRADED' : 'CRITICAL',
      failed_checks: integrity.failed_checks
    };
  }

  async shutdown() {
    await this.emergencyShutdown('Manual shutdown');
  }
}

module.exports = HeidiSelfLaunchProtocol;
