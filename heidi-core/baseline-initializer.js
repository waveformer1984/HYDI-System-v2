#!/usr/bin/env node

/**
 * BASELINE INITIALIZER
 * 
 * Creates the required memory snapshots and baseline state
 * that Heidi needs to operate with verified integrity.
 * 
 * Without this, Heidi is "flying blind" - operational but untrustworthy.
 */

const HeidiSelfLaunchProtocol = require('./HeidiSelfLaunchProtocol');
const fs = require('fs').promises;
const path = require('path');

class BaselineInitializer {
  constructor() {
    this.protocol = new HeidiSelfLaunchProtocol();
    this.baselinePath = path.join(__dirname, 'heidi-baseline.json');
    this.memoryPath = path.join(__dirname, 'heidi-memory-snapshots.json');
  }

  async createVerifiedBaseline() {
    console.log('🏗️  CREATING VERIFIED BASELINE');
    console.log('==============================');
    
    try {
      // Step 1: Create baseline configuration snapshot
      const baselineConfig = await this.createBaselineConfig();
      
      // Step 2: Initialize memory snapshots
      const memorySnapshots = await this.initializeMemorySnapshots();
      
      // Step 3: Create integrity checksums
      const integrityChecksums = await this.createIntegrityChecksums(baselineConfig, memorySnapshots);
      
      // Step 4: Persist baseline
      const baseline = {
        created_at: new Date().toISOString(),
        version: '1.0',
        config: baselineConfig,
        memory_snapshots: memorySnapshots,
        integrity_checksums: integrityChecksums,
        system_state: {
          drift_score: 0.0,
          boot_phase: 0,
          HEIDI_STATUS: 'BASELINE_ESTABLISHED',
          MODE: 'VERIFIED'
        }
      };
      
      await this.persistBaseline(baseline);
      
      console.log('✅ VERIFIED BASELINE CREATED');
      console.log(`📍 Baseline saved: ${this.baselinePath}`);
      console.log(`📍 Memory snapshots: ${this.memoryPath}`);
      
      return true;
      
    } catch (error) {
      console.error('❌ BASELINE CREATION FAILED:', error.message);
      return false;
    }
  }

  async createBaselineConfig() {
    console.log('⚙️  Creating baseline configuration...');
    
    // Expected configuration values with strict validation
    const baselineConfig = {
      DRIFT_THRESHOLD: 0.7,
      CONFIDENCE_THRESHOLD: 0.7,
      HEARTBEAT_INTERVAL: 60000,
      BOOT_TIMEOUT: 30000,
      MAX_RETRY_ATTEMPTS: 3,
      SAFE_MODE_RATE_LIMIT: 5,
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
    
    // Create checksum for config integrity
    const configChecksum = this.calculateChecksum(JSON.stringify(baselineConfig));
    baselineConfig._checksum = configChecksum;
    baselineConfig._created_at = new Date().toISOString();
    
    return baselineConfig;
  }

  async initializeMemorySnapshots() {
    console.log('🧠 Initializing memory snapshots...');
    
    const memorySnapshots = {
      'system_identity': {
        timestamp: new Date().toISOString(),
        data: JSON.stringify({
          system_name: 'HEIDI',
          version: '1.0',
          architecture: '4-layer-self-awareness',
          launch_protocol: 'HSLP-v1.0'
        }),
        checksum: null,
        type: 'identity'
      },
      'performance_baseline': {
        timestamp: new Date().toISOString(),
        data: JSON.stringify({
          cpu_usage: 0.0,
          memory_usage: 0.0,
          task_completion_rate: 1.0,
          response_time_baseline: 100,
          error_rate: 0.0
        }),
        checksum: null,
        type: 'performance'
      },
      'integrity_baseline': {
        timestamp: new Date().toISOString(),
        data: JSON.stringify({
          drift_score: 0.0,
          integrity_score: 1.0,
          last_validation: new Date().toISOString(),
          validation_history: []
        }),
        checksum: null,
        type: 'integrity'
      },
      'state_machine_baseline': {
        timestamp: new Date().toISOString(),
        data: JSON.stringify({
          current_state: 'BASELINE',
          state_history: ['BASELINE'],
          transition_rules: {
            'BASELINE': ['INITIALIZING', 'SAFE_MODE'],
            'INITIALIZING': ['OPERATIONAL', 'DEGRADED'],
            'OPERATIONAL': ['ACTIVE', 'DEGRADED', 'SHUTDOWN'],
            'DEGRADED': ['RECOVERY', 'SHUTDOWN'],
            'RECOVERY': ['OPERATIONAL', 'DEGRADED'],
            'SAFE_MODE': ['INITIALIZING', 'SHUTDOWN'],
            'SHUTDOWN': ['BASELINE']
          }
        }),
        checksum: null,
        type: 'state_machine'
      }
    };
    
    // Calculate checksums for all snapshots
    Object.keys(memorySnapshots).forEach(key => {
      const snapshot = memorySnapshots[key];
      snapshot.checksum = this.calculateChecksum(snapshot.data);
    });
    
    return memorySnapshots;
  }

  async createIntegrityChecksums(config, snapshots) {
    console.log('🔐 Creating integrity checksums...');
    
    const configChecksum = this.calculateChecksum(JSON.stringify(config));
    const snapshotsChecksum = this.calculateChecksum(JSON.stringify(snapshots));
    const combinedChecksum = this.calculateChecksum(configChecksum + snapshotsChecksum);
    
    return {
      config: configChecksum,
      snapshots: snapshotsChecksum,
      combined: combinedChecksum,
      algorithm: 'SHA-256',
      created_at: new Date().toISOString()
    };
  }

  async persistBaseline(baseline) {
    console.log('💾 Persisting baseline...');
    
    // Save main baseline file
    await fs.writeFile(this.baselinePath, JSON.stringify(baseline, null, 2));
    
    // Save memory snapshots separately for easier access
    await fs.writeFile(this.memoryPath, JSON.stringify(baseline.memory_snapshots, null, 2));
    
    console.log('✅ Baseline persisted successfully');
  }

  calculateChecksum(data) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  async verifyBaselineIntegrity() {
    console.log('🔍 Verifying baseline integrity...');
    
    try {
      // Check if baseline exists
      const baselineExists = await fs.access(this.baselinePath).then(() => true).catch(() => false);
      if (!baselineExists) {
        console.log('❌ No baseline found - must create first');
        return false;
      }
      
      // Load and verify baseline
      const baselineData = await fs.readFile(this.baselinePath, 'utf8');
      const baseline = JSON.parse(baselineData);
      
      // Verify checksums
      const currentConfigChecksum = this.calculateChecksum(JSON.stringify(baseline.config));
      const currentSnapshotsChecksum = this.calculateChecksum(JSON.stringify(baseline.memory_snapshots));
      
      if (currentConfigChecksum !== baseline.integrity_checksums.config) {
        console.log('❌ Config integrity compromised');
        return false;
      }
      
      if (currentSnapshotsChecksum !== baseline.integrity_checksums.snapshots) {
        console.log('❌ Memory snapshots integrity compromised');
        return false;
      }
      
      console.log('✅ Baseline integrity verified');
      return true;
      
    } catch (error) {
      console.error('❌ Baseline verification failed:', error.message);
      return false;
    }
  }

  async loadBaselineIntoProtocol() {
    console.log('📂 Loading baseline into protocol...');
    
    try {
      const baselineData = await fs.readFile(this.baselinePath, 'utf8');
      const baseline = JSON.parse(baselineData);
      
      // Load memory snapshots into protocol state
      this.protocol.state.memory_snapshots = baseline.memory_snapshots;
      
      // Load baseline config
      Object.assign(this.protocol.config, baseline.config);
      
      // Set baseline state
      this.protocol.state.drift_score = baseline.system_state.drift_score;
      this.protocol.state.boot_phase = baseline.system_state.boot_phase;
      
      console.log('✅ Baseline loaded into protocol');
      return true;
      
    } catch (error) {
      console.error('❌ Failed to load baseline:', error.message);
      return false;
    }
  }
}

// Command line interface
if (require.main === module) {
  const initializer = new BaselineInitializer();
  const command = process.argv[2];
  
  switch (command) {
    case 'create':
      initializer.createVerifiedBaseline().then(success => {
        process.exit(success ? 0 : 1);
      });
      break;
      
    case 'verify':
      initializer.verifyBaselineIntegrity().then(success => {
        process.exit(success ? 0 : 1);
      });
      break;
      
    case 'load':
      initializer.loadBaselineIntoProtocol().then(success => {
        process.exit(success ? 0 : 1);
      });
      break;
      
    default:
      console.log('Usage: node baseline-initializer.js [create|verify|load]');
      process.exit(1);
  }
}

module.exports = BaselineInitializer;
