/**
 * HEIDI Self-Awareness Bootloader
 * Automatically wires Ollama + filesystem memory + reflection loop
 */

const OperationalIntrospection = require('./operational-introspection');
const fs = require('fs');
const path = require('path');

class HeidiBootloader {
  constructor() {
    this.heidi = null;
    this.config = this.loadConfiguration();
    this.healthCheckInterval = null;
  }

  /**
   * Load configuration from environment and files
   */
  loadConfiguration() {
    const config = {
      primary: {
        baseURL: process.env.OLLAMA_URL || 'http://localhost:11434',
        model: process.env.OLLAMA_MODEL || 'llama3',
        timeout: parseInt(process.env.HEIDI_TIMEOUT) || 8000
      },
      critic: {
        baseURL: process.env.OLLAMA_URL || 'http://localhost:11434',
        model: process.env.OLLAMA_CRITIC_MODEL || 'llama3:8b',
        timeout: parseInt(process.env.HEIDI_TIMEOUT) || 8000
      },
      memory: {
        dbPath: process.env.HEIDI_DB_PATH || path.join(__dirname, '../data/heidi_memory.db')
      }
    };

    // Load any local config files
    const configPath = path.join(__dirname, '../../config/heidi-config.json');
    if (fs.existsSync(configPath)) {
      try {
        const localConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        config = { ...config, ...localConfig };
      } catch (e) {
        console.warn('[Bootloader] Failed to load local config:', e.message);
      }
    }

    return config;
  }

  /**
   * Verify local model environment
   */
  async verifyLocalEnvironment() {
    console.log('[Bootloader] Verifying local environment...');
    
    const checks = {
      ollama_server: false,
      primary_model: false,
      critic_model: false,
      memory_directory: false,
      config_files: false
    };

    // Check Ollama server
    try {
      const axios = require('axios');
      const response = await axios.get(`${this.config.primary.baseURL}/api/tags`, { timeout: 2000 });
      checks.ollama_server = response.status === 200;
      
      if (checks.ollama_server) {
        const models = response.data.models?.map(m => m.name) || [];
        checks.primary_model = models.includes(this.config.primary.model);
        checks.critic_model = models.includes(this.config.critic.model);
        
        console.log(`[Bootloader] Available models: ${models.join(', ')}`);
      }
    } catch (error) {
      console.error('[Bootloader] Ollama server not accessible:', error.message);
    }

    // Check memory directory
    const memoryDir = path.dirname(this.config.memory.dbPath);
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }
    checks.memory_directory = fs.existsSync(memoryDir);

    // Check config directory
    const configDir = path.join(__dirname, '../../config');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    checks.config_files = fs.existsSync(configDir);

    return checks;
  }

  /**
   * Provision missing components
   */
  async provisionMissingComponents(checks) {
    console.log('[Bootloader] Provisioning missing components...');
    
    const provisioning = [];

    if (!checks.ollama_server) {
      provisioning.push({
        component: 'ollama_server',
        action: 'start_ollama',
        command: 'ollama serve',
        description: 'Start Ollama server'
      });
    }

    if (!checks.primary_model) {
      provisioning.push({
        component: 'primary_model',
        action: 'download_model',
        command: `ollama pull ${this.config.primary.model}`,
        description: `Download primary model: ${this.config.primary.model}`
      });
    }

    if (!checks.critic_model) {
      provisioning.push({
        component: 'critic_model',
        action: 'download_model',
        command: `ollama pull ${this.config.critic_model}`,
        description: `Download critic model: ${this.config.critic_model}`
      });
    }

    if (provisioning.length > 0) {
      console.log('[Bootloader] Provisioning tasks:');
      provisioning.forEach(task => {
        console.log(`  - ${task.description}: ${task.command}`);
      });
      
      console.log('\n[Bootloader] Please run these commands manually, then restart Heidi:');
      provisioning.forEach(task => {
        console.log(`  ${task.command}`);
      });
      
      return false; // Not ready yet
    }

    return true; // Environment ready
  }

  /**
   * Initialize Heidi with operational self-awareness
   */
  async initialize() {
    console.log('[Bootloader] Initializing Heidi operational self-awareness...');
    
    try {
      // Verify environment
      const checks = await this.verifyLocalEnvironment();
      
      // Provision missing components
      const ready = await this.provisionMissingComponents(checks);
      if (!ready) {
        throw new Error('Environment not ready - see provisioning tasks above');
      }

      // Create Heidi instance
      this.heidi = new OperationalIntrospection(this.config);
      
      // Initialize Heidi
      await this.heidi.initialize();
      
      // Start health monitoring
      this.startHealthMonitoring();
      
      console.log('[Bootloader] ✓ Heidi operational self-awareness initialized');
      
      // Test self-awareness loop
      await this.testSelfAwareness();
      
      return this.heidi;
      
    } catch (error) {
      console.error('[Bootloader] Initialization failed:', error.message);
      throw error;
    }
  }

  /**
   * Test operational self-awareness capabilities
   */
  async testSelfAwareness() {
    console.log('[Bootloader] Testing operational self-awareness...');
    
    try {
      // Test basic execution
      const testResult = await this.heidi.selfAwarenessLoop(
        'Hello Heidi. Please demonstrate your self-awareness by describing your decision pipeline.',
        { source: 'bootloader_test', priority: 'high' }
      );
      
      console.log('[Bootloader] ✓ Self-awareness loop test passed');
      console.log(`  - Confidence: ${testResult.confidence_score}`);
      console.log(`  - Coherence: ${testResult.self_awareness_metrics.coherence_score}`);
      console.log(`  - Cycle time: ${testResult.execution_summary.cycle_time}ms`);
      
      // Test operational state query
      const operationalState = await this.heidi.getOperationalState();
      console.log('[Bootloader] ✓ Operational state query working');
      console.log(`  - Execution cycles: ${operationalState.execution_cycles}`);
      console.log(`  - Success rate: ${(operationalState.performance_metrics.success_rate * 100).toFixed(1)}%`);
      
      // Test decision pipeline description
      const pipeline = await this.heidi.describeDecisionPipeline();
      console.log('[Bootloader] ✓ Decision pipeline self-description working');
      console.log(`  - Pipeline: ${pipeline.pipeline}`);
      
      console.log('[Bootloader] ✓ All self-awareness tests passed');
      
    } catch (error) {
      console.error('[Bootloader] Self-awareness test failed:', error.message);
      throw error;
    }
  }

  /**
   * Start health monitoring
   */
  startHealthMonitoring() {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const state = await this.heidi.getOperationalState();
        
        // Log basic health metrics
        console.log(`[Health] Cycles: ${state.execution_cycles}, Success: ${(state.performance_metrics.success_rate * 100).toFixed(1)}%, Models: ${state.model_status.primary ? '✓' : '✗'}/${state.model_status.critic ? '✓' : '✗'}`);
        
        // Check for drift
        if (state.last_reflection?.drift_detected) {
          console.log('[Health] ⚠️ Drift detected in last execution');
        }
        
        // Check for failure patterns
        const patterns = await this.heidi.identifyRecurringFailurePatterns();
        if (patterns.length > 0) {
          console.log(`[Health] ⚠️ ${patterns.length} recurring failure patterns detected`);
        }
        
      } catch (error) {
        console.error('[Health] Monitoring failed:', error.message);
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Get Heidi instance
   */
  getHeidi() {
    return this.heidi;
  }

  /**
   * Shutdown Heidi gracefully
   */
  async shutdown() {
    console.log('[Bootloader] Shutting down Heidi...');
    
    this.stopHealthMonitoring();
    
    if (this.heidi) {
      try {
        await this.heidi.memory.close();
        console.log('[Bootloader] ✓ Memory closed');
      } catch (error) {
        console.error('[Bootloader] Error closing memory:', error.message);
      }
    }
    
    console.log('[Bootloader] ✓ Heidi shutdown complete');
  }
}

// Auto-initialize if run directly
if (require.main === module) {
  const bootloader = new HeidiBootloader();
  
  bootloader.initialize()
    .then(heidi => {
      console.log('\n[Bootloader] Heidi is ready for operational self-awareness');
      console.log('Example usage:');
      console.log('  await heidi.selfAwarenessLoop("Your input here");');
      console.log('  await heidi.getOperationalState();');
      console.log('  await heidi.describeDecisionPipeline();');
      
      // Keep process running
      process.on('SIGINT', async () => {
        await bootloader.shutdown();
        process.exit(0);
      });
    })
    .catch(error => {
      console.error('[Bootloader] Failed to initialize:', error.message);
      process.exit(1);
    });
}

module.exports = HeidiBootloader;
