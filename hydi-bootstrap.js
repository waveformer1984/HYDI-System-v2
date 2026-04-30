#!/usr/bin/env node
/**
 * HYDI Bootstrap - Local System that Expands Outward
 * 
 * This script creates a comprehensive bootstrap process for HYDI that:
 * 1. Initializes local HYDI system with all components
 * 2. Establishes Supabase connectivity for persistence
 * 3. Sets up Cascade integration for bidirectional communication
 * 4. Enables world connectivity through external APIs and webhooks
 * 
 * Usage: node hydi-bootstrap.js [--mode=local|supabase|cascade|world|full]
 */

const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class HYDIBootstrap {
  constructor(options = {}) {
    this.mode = options.mode || 'local';
    this.verbose = options.verbose || false;
    this.config = this.loadConfiguration();
    this.components = {
      local: ['server', 'models', 'middleware', 'modules'],
      supabase: ['database', 'auth', 'storage', 'functions'],
      cascade: ['event-bus', 'agent-bridge', 'message-router'],
      world: ['webhooks', 'external-apis', 'monitoring']
    };
    this.healthChecks = new Map();
    this.startTime = Date.now();
  }

  loadConfiguration() {
    try {
      // Load environment variables
      const envPath = path.join(process.cwd(), '.env');
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const env = {};
        envContent.split('\n').forEach(line => {
          if (line.startsWith('#') || line.trim() === '') return;
          const [key, ...valueParts] = line.split('=');
          if (key && valueParts.length > 0) {
            env[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
          }
        });
        return env;
      }
      return {};
    } catch (error) {
      console.warn('⚠️  Could not load .env file:', error.message);
      return {};
    }
  }

  log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = {
      info: '📋',
      success: '✅',
      warning: '⚠️',
      error: '❌',
      debug: '🔍'
    }[level] || '📋';

    console.log(`${prefix} [${timestamp}] ${message}`);
  }

  async checkPrerequisites() {
    this.log('Checking system prerequisites...', 'info');

    const checks = [
      {
        name: 'Node.js',
        check: async () => {
          try {
            const { stdout } = await execAsync('node --version');
            return { success: true, version: stdout.trim() };
          } catch {
            return { success: false, error: 'Node.js not found' };
          }
        }
      },
      {
        name: 'npm',
        check: async () => {
          try {
            const { stdout } = await execAsync('npm --version');
            return { success: true, version: stdout.trim() };
          } catch {
            return { success: false, error: 'npm not found' };
          }
        }
      },
      {
        name: 'Required directories',
        check: async () => {
          const requiredDirs = ['src', 'modules', 'supabase', 'models'];
          const missing = requiredDirs.filter(dir => !fs.existsSync(dir));
          return {
            success: missing.length === 0,
            missing: missing.length > 0 ? missing : undefined
          };
        }
      },
      {
        name: 'Package dependencies',
        check: async () => {
          const packagePath = path.join(process.cwd(), 'package.json');
          const nodeModulesPath = path.join(process.cwd(), 'node_modules');
          
          if (!fs.existsSync(packagePath)) {
            return { success: false, error: 'package.json not found' };
          }
          
          if (!fs.existsSync(nodeModulesPath)) {
            return { success: false, error: 'Dependencies not installed' };
          }
          
          return { success: true };
        }
      }
    ];

    let allPassed = true;
    for (const check of checks) {
      const result = await check.check();
      if (result.success) {
        this.log(`${check.name}: OK`, 'success');
        if (result.version) this.log(`  Version: ${result.version}`, 'debug');
      } else {
        this.log(`${check.name}: FAILED`, 'error');
        if (result.error) this.log(`  Error: ${result.error}`, 'error');
        if (result.missing) this.log(`  Missing: ${result.missing.join(', ')}`, 'error');
        allPassed = false;
      }
    }

    return allPassed;
  }

  async installDependencies() {
    this.log('Installing/updating dependencies...', 'info');
    
    try {
      const { stdout, stderr } = await execAsync('npm install --production=false');
      if (this.verbose) {
        console.log('npm install output:', stdout);
        if (stderr) console.log('npm install stderr:', stderr);
      }
      this.log('Dependencies installed successfully', 'success');
      return true;
    } catch (error) {
      this.log(`Dependency installation failed: ${error.message}`, 'error');
      return false;
    }
  }

  async initializeLocalComponents() {
    this.log('Initializing local HYDI components...', 'info');

    const components = [
      {
        name: 'Express Server',
        init: async () => this.startServer()
      },
      {
        name: 'Local Models',
        init: async () => this.initializeModels()
      },
      {
        name: 'Module System',
        init: async () => this.initializeModules()
      },
      {
        name: 'Event Bus',
        init: async () => this.initializeEventBus()
      }
    ];

    const results = [];
    for (const component of components) {
      try {
        this.log(`Starting ${component.name}...`, 'debug');
        const result = await component.init();
        results.push({ name: component.name, success: true, result });
        this.log(`${component.name}: Initialized`, 'success');
      } catch (error) {
        results.push({ name: component.name, success: false, error: error.message });
        this.log(`${component.name}: Failed - ${error.message}`, 'error');
      }
    }

    return results;
  }

  async startServer() {
    return new Promise((resolve, reject) => {
      const serverPath = path.join(process.cwd(), 'src', 'server.js');
      
      if (!fs.existsSync(serverPath)) {
        reject(new Error('Server file not found'));
        return;
      }

      const server = spawn('node', [serverPath], {
        stdio: this.verbose ? 'inherit' : 'pipe',
        env: { ...process.env, ...this.config }
      });

      let startupTimeout = setTimeout(() => {
        server.kill();
        reject(new Error('Server startup timeout'));
      }, 30000);

      server.on('error', (error) => {
        clearTimeout(startupTimeout);
        reject(error);
      });

      // Wait for server to be ready
      server.stdout?.on('data', (data) => {
        const output = data.toString();
        if (output.includes('Server listening') || output.includes('listening on')) {
          clearTimeout(startupTimeout);
          resolve({ pid: server.pid, port: this.config.PORT || 3005 });
        }
      });

      // Store server reference for health checks
      this.healthChecks.set('server', {
        process: server,
        port: this.config.PORT || 3005,
        healthEndpoint: `http://localhost:${this.config.PORT || 3005}/health`
      });
    });
  }

  async initializeModels() {
    // Initialize local model adapter
    const modelAdapterPath = path.join(process.cwd(), 'src', 'models', 'local-model-adapter.js');
    
    if (fs.existsSync(modelAdapterPath)) {
      try {
        // This would typically be handled by the server initialization
        this.log('Local model adapter available', 'success');
        return { models: 'local-model-adapter initialized' };
      } catch (error) {
        throw new Error(`Model adapter initialization failed: ${error.message}`);
      }
    } else {
      throw new Error('Local model adapter not found');
    }
  }

  async initializeModules() {
    const modulesDir = path.join(process.cwd(), 'modules');
    const requiredModules = [
      'protoforge-event-bus',
      'hydi-contextual-conscience',
      'universal-agent-bus'
    ];

    const availableModules = [];
    for (const module of requiredModules) {
      const modulePath = path.join(modulesDir, `${module}.js`);
      if (fs.existsSync(modulePath)) {
        availableModules.push(module);
      }
    }

    if (availableModules.length === 0) {
      throw new Error('No required modules found');
    }

    return { modules: availableModules };
  }

  async initializeEventBus() {
    // Event bus is typically initialized by the server
    this.log('Event bus will be initialized by server', 'debug');
    return { eventBus: 'server-managed' };
  }

  async connectToSupabase() {
    this.log('Connecting to Supabase...', 'info');

    if (!this.config.SUPABASE_URL || !this.config.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase credentials not found in environment');
    }

    try {
      // Test Supabase connection
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(this.config.SUPABASE_URL, this.config.SUPABASE_SERVICE_ROLE_KEY);

      // Simple health check
      const { data, error } = await supabase.from('hydi_events').select('count', { count: 'exact', head: true });
      
      if (error) {
        throw new Error(`Supabase connection failed: ${error.message}`);
      }

      this.log('Supabase connection established', 'success');
      
      // Store for health checks
      this.healthChecks.set('supabase', {
        client: supabase,
        url: this.config.SUPABASE_URL
      });

      return { 
        connected: true, 
        url: this.config.SUPABASE_URL,
        eventCount: data || 0
      };
    } catch (error) {
      this.log(`Supabase connection failed: ${error.message}`, 'error');
      throw error;
    }
  }

  async setupCascadeIntegration() {
    this.log('Setting up Cascade integration...', 'info');

    // Cascade integration is handled through modules
    const cascadeModule = path.join(process.cwd(), 'modules', 'cascade-complete-v2.js');
    
    if (!fs.existsSync(cascadeModule)) {
      throw new Error('Cascade module not found');
    }

    try {
      // Cascade will be initialized by the server
      this.log('Cascade integration ready', 'success');
      return { cascade: 'integration available' };
    } catch (error) {
      throw new Error(`Cascade setup failed: ${error.message}`);
    }
  }

  async enableWorldConnectivity() {
    this.log('Enabling world connectivity...', 'info');

    const connectivity = {
      webhooks: await this.activateWebhooks(),
      externalAPIs: await this.setupExternalAPIs(),
      monitoring: await this.enableMonitoring()
    };

    return connectivity;
  }

  async activateWebhooks() {
    try {
      // Run the existing passive services activation
      const activateScript = path.join(process.cwd(), 'activate-passive-services.js');
      
      if (fs.existsSync(activateScript)) {
        this.log('Running webhook activation script...', 'debug');
        const { stdout, stderr } = await execAsync(`node "${activateScript}"`, {
          env: { ...process.env, ...this.config }
        });
        
        if (this.verbose) {
          console.log('Webhook activation output:', stdout);
          if (stderr) console.log('Webhook activation stderr:', stderr);
        }
        
        return { webhooks: 'activation script executed' };
      } else {
        this.log('Webhook activation script not found', 'warning');
        return { webhooks: 'manual activation required' };
      }
    } catch (error) {
      this.log(`Webhook activation failed: ${error.message}`, 'error');
      return { webhooks: 'activation failed', error: error.message };
    }
  }

  async setupExternalAPIs() {
    // Setup external API connections
    const apis = [];
    
    // Stripe (if configured)
    if (this.config.STRIPE_SECRET_KEY) {
      apis.push({ name: 'Stripe', status: 'configured' });
    }

    // Other external services can be added here
    
    return { externalAPIs: apis };
  }

  async enableMonitoring() {
    // Enable monitoring services
    const monitoring = {
      local: true,
      remote: false
    };

    // Check if remote monitoring is available
    if (this.config.MONITORING_ENDPOINT) {
      try {
        const response = await fetch(this.config.MONITORING_ENDPOINT, { 
          method: 'GET',
          timeout: 5000 
        });
        monitoring.remote = response.ok;
      } catch {
        monitoring.remote = false;
      }
    }

    return { monitoring };
  }

  async performHealthChecks() {
    this.log('Performing health checks...', 'info');

    const results = new Map();

    // Check server health
    const serverHealth = this.healthChecks.get('server');
    if (serverHealth) {
      try {
        const response = await fetch(serverHealth.healthEndpoint, { timeout: 5000 });
        results.set('server', {
          status: response.ok ? 'healthy' : 'unhealthy',
          statusCode: response.status,
          port: serverHealth.port
        });
      } catch (error) {
        results.set('server', {
          status: 'unreachable',
          error: error.message
        });
      }
    }

    // Check Supabase health
    const supabaseHealth = this.healthChecks.get('supabase');
    if (supabaseHealth) {
      try {
        const { data, error } = await supabaseHealth.client.from('hydi_events').select('count', { count: 'exact', head: true });
        results.set('supabase', {
          status: error ? 'unhealthy' : 'healthy',
          url: supabaseHealth.url,
          eventCount: data || 0
        });
      } catch (error) {
        results.set('supabase', {
          status: 'unreachable',
          error: error.message
        });
      }
    }

    return results;
  }

  async runBootstrap() {
    const startTime = Date.now();
    this.log(`Starting HYDI Bootstrap (Mode: ${this.mode})`, 'info');
    this.log('=====================================', 'info');

    try {
      // 1. Check prerequisites
      const prereqsOk = await this.checkPrerequisites();
      if (!prereqsOk) {
        throw new Error('Prerequisites failed');
      }

      // 2. Install dependencies if needed
      await this.installDependencies();

      // 3. Initialize based on mode
      const results = {
        mode: this.mode,
        startTime: new Date(startTime).toISOString(),
        components: {}
      };

      // Always initialize local components
      results.components.local = await this.initializeLocalComponents();

      // Mode-specific initialization
      if (this.mode === 'supabase' || this.mode === 'full') {
        results.components.supabase = await this.connectToSupabase();
      }

      if (this.mode === 'cascade' || this.mode === 'full') {
        results.components.cascade = await this.setupCascadeIntegration();
      }

      if (this.mode === 'world' || this.mode === 'full') {
        results.components.world = await this.enableWorldConnectivity();
      }

      // 4. Perform health checks
      results.healthChecks = await this.performHealthChecks();

      // 5. Calculate bootstrap time
      results.endTime = new Date().toISOString();
      results.duration = Date.now() - startTime;
      results.success = true;

      // 6. Display results
      this.displayResults(results);

      return results;

    } catch (error) {
      const errorResults = {
        mode: this.mode,
        startTime: new Date(startTime).toISOString(),
        endTime: new Date().toISOString(),
        duration: Date.now() - startTime,
        success: false,
        error: error.message
      };

      this.log(`Bootstrap failed: ${error.message}`, 'error');
      this.displayResults(errorResults);

      throw error;
    }
  }

  displayResults(results) {
    console.log('\n📊 BOOTSTRAP RESULTS');
    console.log('===================');
    console.log(`Mode: ${results.mode}`);
    console.log(`Duration: ${results.duration}ms`);
    console.log(`Status: ${results.success ? 'SUCCESS' : 'FAILED'}`);

    if (results.components) {
      console.log('\n📦 Components:');
      Object.entries(results.components).forEach(([component, status]) => {
        console.log(`  ${component}: ${typeof status === 'object' ? 'INITIALIZED' : status}`);
      });
    }

    if (results.healthChecks) {
      console.log('\n🏥 Health Checks:');
      results.healthChecks.forEach((status, component) => {
        const icon = status.status === 'healthy' ? '✅' : '❌';
        console.log(`  ${icon} ${component}: ${status.status}`);
      });
    }

    if (results.error) {
      console.log(`\n❌ Error: ${results.error}`);
    }

    console.log('\n🌐 Access Points:');
    console.log(`  Local Server: http://localhost:${this.config.PORT || 3005}`);
    console.log(`  Health Check: http://localhost:${this.config.PORT || 3005}/health`);
    console.log(`  Heidi Insights: http://localhost:${this.config.PORT || 3005}/heidi/insights`);
    
    if (results.components?.supabase) {
      console.log(`  Supabase: ${this.config.SUPABASE_URL}`);
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const options = {};
  
  // Parse arguments
  args.forEach(arg => {
    if (arg.startsWith('--mode=')) {
      options.mode = arg.split('=')[1];
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
HYDI Bootstrap - Local System that Expands Outward

Usage: node hydi-bootstrap.js [options]

Options:
  --mode=<mode>     Bootstrap mode (local|supabase|cascade|world|full)
  --verbose, -v     Enable verbose output
  --help, -h        Show this help

Modes:
  local    - Initialize only local HYDI components
  supabase - Local + Supabase connectivity
  cascade  - Local + Cascade integration
  world    - Local + External connectivity
  full     - All components (default)

Examples:
  node hydi-bootstrap.js --mode=local
  node hydi-bootstrap.js --mode=full --verbose
  node hydi-bootstrap.js --mode=supabase
      `);
      process.exit(0);
    }
  });

  // Default to full mode if not specified
  if (!options.mode) {
    options.mode = 'full';
  }

  const bootstrap = new HYDIBootstrap(options);
  
  try {
    const results = await bootstrap.runBootstrap();
    process.exit(results.success ? 0 : 1);
  } catch (error) {
    console.error('Bootstrap failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = HYDIBootstrap;
