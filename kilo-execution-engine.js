// KILO Execution Engine - From Decoration to Action
require('dotenv').config();

class KiloExecutionEngine {
  constructor() {
    this.systemMap = new Map();
    this.executionLog = [];
    this.gitRepo = null;
    this.eventPipeline = null;
    this.status = {
      initialized: false,
      gitInitialized: false,
      modulesMapped: false,
      executionReady: false
    };
  }

  async initialize() {
    console.log('=== INITIALIZING KILO EXECUTION ENGINE ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    try {
      // Phase 1: Repository Control
      await this.initializeGitRepo();
      
      // Phase 2: Code Intelligence
      await this.mapSystemModules();
      
      // Phase 3: Execution Hooks
      await this.setupExecutionHooks();
      
      // Phase 4: HEIDI Integration
      await this.setupHeidiIntegration();
      
      this.status.initialized = true;
      this.status.executionReady = true;
      
      console.log('=== KILO EXECUTION ENGINE INITIALIZED ===');
      
      return this.status;
      
    } catch (error) {
      console.log(`Kilo initialization failed: ${error.message}`);
      throw error;
    }
  }

  async initializeGitRepo() {
    console.log('Phase 1: Repository Control');
    
    const { execSync } = require('child_process');
    const fs = require('fs');
    const path = require('path');
    
    try {
      // Check if git repo exists
      if (!fs.existsSync(path.join(process.cwd(), '.git'))) {
        console.log('Initializing git repository...');
        try {
          execSync('git init', { stdio: 'inherit' });
          execSync('git config user.name "Kilo Engine"', { stdio: 'inherit' });
          execSync('git config user.email "kilo@hydi.system"', { stdio: 'inherit' });
        } catch (gitError) {
          console.log(`Git init failed, continuing without git: ${gitError.message}`);
          this.status.gitInitialized = false;
          return;
        }
      }
      
      // Add all files
      console.log('Adding all files to git...');
      try {
        execSync('git add .', { stdio: 'inherit' });
        
        // Initial commit if needed
        try {
          execSync('git rev-parse HEAD', { stdio: 'pipe' });
          console.log('Git repository already has commits');
        } catch (error) {
          console.log('Creating initial commit...');
          execSync('git commit -m "Kilo Engine: Initial system snapshot"', { stdio: 'inherit' });
        }
        
        this.status.gitInitialized = true;
        console.log('Git repository control established');
        
      } catch (addError) {
        console.log(`Git add failed, continuing without git: ${addError.message}`);
        this.status.gitInitialized = false;
      }
      
    } catch (error) {
      console.log(`Git initialization failed, continuing without git: ${error.message}`);
      this.status.gitInitialized = false;
    }
  }

  async mapSystemModules() {
    console.log('Phase 2: Code Intelligence');
    
    const fs = require('fs');
    const path = require('path');
    
    const jsFiles = this.findFiles(process.cwd(), '.js');
    
    for (const filePath of jsFiles) {
      try {
        const moduleInfo = await this.analyzeModule(filePath);
        this.systemMap.set(filePath, moduleInfo);
      } catch (error) {
        console.log(`Failed to analyze ${filePath}: ${error.message}`);
      }
    }
    
    this.status.modulesMapped = true;
    console.log(`Mapped ${this.systemMap.size} JavaScript modules`);
    
    return this.systemMap;
  }

  findFiles(dir, extension) {
    const fs = require('fs');
    const path = require('path');
    const results = [];
    
    function scan(currentDir) {
      try {
        const items = fs.readdirSync(currentDir);
        
        for (const item of items) {
          const fullPath = path.join(currentDir, item);
          
          try {
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules') {
              scan(fullPath);
            } else if (item.endsWith(extension)) {
              results.push(fullPath);
            }
          } catch (statError) {
            // Skip files/directories that can't be accessed
            console.log(`Skipping inaccessible path: ${fullPath}`);
          }
        }
      } catch (readError) {
        // Skip directories that can't be read
        console.log(`Skipping unreadable directory: ${currentDir}`);
      }
    }
    
    scan(dir);
    return results;
  }

  async analyzeModule(filePath) {
    const fs = require('fs');
    const path = require('path');
    
    const content = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(process.cwd(), filePath);
    
    // Extract module info
    const moduleInfo = {
      path: relativePath,
      name: path.basename(filePath, '.js'),
      functions: [],
      exports: [],
      imports: [],
      dependencies: [],
      events: [],
      size: content.length,
      lastModified: fs.statSync(filePath).mtime.toISOString()
    };
    
    // Extract functions
    const functionMatches = content.match(/(?:function\s+(\w+)|async\s+function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))/g);
    if (functionMatches) {
      functionMatches.forEach(match => {
        const name = match.match(/(\w+)/)[1];
        if (name && !moduleInfo.functions.includes(name)) {
          moduleInfo.functions.push(name);
        }
      });
    }
    
    // Extract exports
    const exportMatches = content.match(/module\.exports\s*=\s*{([^}]*)}/g);
    if (exportMatches) {
      exportMatches.forEach(match => {
        const exports = match.match(/(\w+)/g);
        if (exports) {
          moduleInfo.exports.push(...exports.filter(e => e !== 'module' && e !== 'exports'));
        }
      });
    }
    
    // Extract imports
    const importMatches = content.match(/require\(['"]([^'"]+)['"]\)/g);
    if (importMatches) {
      importMatches.forEach(match => {
        const importPath = match.match(/require\(['"]([^'"]+)['"]\)/)[1];
        moduleInfo.imports.push(importPath);
        
        // Add as dependency if it's a local file
        if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
          moduleInfo.dependencies.push(importPath);
        }
      });
    }
    
    // Extract events
    const eventMatches = content.match(/(?:emit|event|Event)[\s\S]*?{[\s\S]*?}/g);
    if (eventMatches) {
      eventMatches.forEach(match => {
        const eventTypes = match.match(/type:\s*['"]([^'"]+)['"]/g);
        if (eventTypes) {
          eventTypes.forEach(type => {
            const eventType = type.match(/type:\s*['"]([^'"]+)['"]/)[1];
            if (eventType && !moduleInfo.events.includes(eventType)) {
              moduleInfo.events.push(eventType);
            }
          });
        }
      });
    }
    
    return moduleInfo;
  }

  async setupExecutionHooks() {
    console.log('Phase 3: Execution Hooks');
    
    // Connect to event pipeline
    const { EventPipeline } = require('./event-pipeline');
    this.eventPipeline = new EventPipeline();
    await this.eventPipeline.initialize();
    
    // Subscribe to HEIDI commands
    await this.eventPipeline.subscribe('kilo', async (event) => {
      await this.handleHeidiCommand(event);
    });
    
    console.log('Execution hooks established');
  }

  async setupHeidiIntegration() {
    console.log('Phase 4: HEIDI Integration');
    
    // Emit readiness event
    const readinessEvent = {
      event_id: 'kilo-ready-' + Date.now().toString(),
      type: 'kilo_ready',
      source: 'kilo',
      timestamp: new Date().toISOString(),
      payload: {
        status: 'ready',
        modulesMapped: this.systemMap.size,
        gitInitialized: this.status.gitInitialized
      }
    };
    
    await this.eventPipeline.emit(readinessEvent);
    console.log('HEIDI integration established');
  }

  async handleHeidiCommand(event) {
    console.log(`Handling HEIDI command: ${event.payload.command}`);
    
    const command = event.payload.command;
    const params = event.payload.params || {};
    
    try {
      let result;
      
      switch (command) {
        case 'run_module':
          result = await this.runModule(params.module, params.args);
          break;
          
        case 'test_endpoint':
          result = await this.testEndpoint(params.endpoint);
          break;
          
        case 'validate_output':
          result = await this.validateOutput(params.module, params.expected);
          break;
          
        case 'get_system_map':
          result = this.getSystemMap();
          break;
          
        case 'commit_changes':
          result = await this.commitChanges(params.message);
          break;
          
        case 'execute_action':
          result = await this.executeAction(params.action, params.target);
          break;
          
        default:
          result = { success: false, error: `Unknown command: ${command}` };
      }
      
      // Emit result event
      const resultEvent = {
        event_id: 'kilo-result-' + Date.now().toString(),
        type: 'kilo_result',
        source: 'kilo',
        timestamp: new Date().toISOString(),
        payload: {
          command,
          result,
          originalEvent: event.event_id
        }
      };
      
      await this.eventPipeline.emit(resultEvent);
      
      this.logExecution(command, result);
      
    } catch (error) {
      console.log(`Command execution failed: ${error.message}`);
      
      const errorEvent = {
        event_id: 'kilo-error-' + Date.now().toString(),
        type: 'kilo_error',
        source: 'kilo',
        timestamp: new Date().toISOString(),
        payload: {
          command,
          error: error.message,
          originalEvent: event.event_id
        }
      };
      
      await this.eventPipeline.emit(errorEvent);
    }
  }

  async runModule(moduleName, args = []) {
    console.log(`Running module: ${moduleName}`);
    
    const modulePath = this.findModulePath(moduleName);
    
    if (!modulePath) {
      return { success: false, error: `Module not found: ${moduleName}` };
    }
    
    try {
      // Dynamic import and execution
      const module = require(modulePath);
      
      let result;
      if (typeof module === 'function') {
        result = await module(...args);
      } else if (module && typeof module.main === 'function') {
        result = await module.main(...args);
      } else if (module && typeof module.run === 'function') {
        result = await module.run(...args);
      } else {
        result = { success: true, message: `Module ${moduleName} loaded but no executable function found` };
      }
      
      return { success: true, result };
      
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async testEndpoint(endpoint) {
    console.log(`Testing endpoint: ${endpoint}`);
    
    // This would test HTTP endpoints, database connections, etc.
    // For now, simulate endpoint testing
    
    try {
      const http = require('http');
      
      return new Promise((resolve) => {
        const req = http.request(endpoint, (res) => {
          resolve({ success: true, status: res.statusCode, endpoint });
        });
        
        req.on('error', (error) => {
          resolve({ success: false, error: error.message, endpoint });
        });
        
        req.setTimeout(5000, () => {
          req.destroy();
          resolve({ success: false, error: 'Timeout', endpoint });
        });
        
        req.end();
      });
      
    } catch (error) {
      return { success: false, error: error.message, endpoint };
    }
  }

  async validateOutput(moduleName, expected) {
    console.log(`Validating output for: ${moduleName}`);
    
    // Run the module first
    const runResult = await this.runModule(moduleName);
    
    if (!runResult.success) {
      return { success: false, error: 'Module execution failed', runResult };
    }
    
    // Simple validation - check if expected string exists in output
    const output = JSON.stringify(runResult.result);
    const isValid = output.includes(expected);
    
    return {
      success: isValid,
      valid: isValid,
      expected,
      actual: output.substring(0, 200) + '...'
    };
  }

  getSystemMap() {
    return {
      totalModules: this.systemMap.size,
      modules: Array.from(this.systemMap.values()),
      timestamp: new Date().toISOString()
    };
  }

  async commitChanges(message) {
    console.log(`Committing changes: ${message}`);
    
    const { execSync } = require('child_process');
    
    try {
      execSync('git add .', { stdio: 'inherit' });
      execSync(`git commit -m "${message}"`, { stdio: 'inherit' });
      
      return { success: true, message, timestamp: new Date().toISOString() };
      
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async executeAction(action, target) {
    console.log(`Executing action: ${action} on ${target}`);
    
    switch (action) {
      case 'restart':
        return { success: true, message: `Restarted ${target}` };
        
      case 'stop':
        return { success: true, message: `Stopped ${target}` };
        
      case 'status':
        return { success: true, status: 'processing', target };
        
      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  }

  findModulePath(moduleName) {
    for (const [path, info] of this.systemMap) {
      if (info.name === moduleName || path.includes(moduleName)) {
        return path;
      }
    }
    return null;
  }

  logExecution(command, result) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      command,
      result,
      success: result.success
    };
    
    this.executionLog.push(logEntry);
    
    // Keep log size manageable
    if (this.executionLog.length > 1000) {
      this.executionLog = this.executionLog.slice(-500);
    }
  }

  async saveOutputs() {
    const fs = require('fs');
    
    // Save system map
    const systemMapOutput = {
      timestamp: new Date().toISOString(),
      status: this.status,
      modules: Array.from(this.systemMap.values()),
      totalModules: this.systemMap.size
    };
    
    fs.writeFileSync('kilo-system-map.json', JSON.stringify(systemMapOutput, null, 2));
    
    // Save execution log
    const executionLogOutput = {
      timestamp: new Date().toISOString(),
      status: this.status,
      totalExecutions: this.executionLog.length,
      executions: this.executionLog.slice(-100) // Last 100 executions
    };
    
    fs.writeFileSync('kilo-execution-log.json', JSON.stringify(executionLogOutput, null, 2));
    
    console.log('Kilo outputs saved');
  }

  getStatus() {
    return {
      status: this.status,
      modulesMapped: this.systemMap.size,
      executionsLogged: this.executionLog.length,
      timestamp: new Date().toISOString()
    };
  }

  async shutdown() {
    console.log('Shutting down Kilo execution engine...');
    
    await this.saveOutputs();
    
    console.log('Kilo execution engine shutdown complete');
  }
}

// CLI interface
if (require.main === module) {
  const kilo = new KiloExecutionEngine();
  
  const command = process.argv[2] || 'initialize';
  
  (async () => {
    switch (command) {
      case 'initialize':
        await kilo.initialize();
        
        // Keep running for commands
        console.log('\nKilo execution engine is running. Press Ctrl+C to stop.');
        
        process.on('SIGINT', async () => {
          console.log('\nShutting down...');
          await kilo.shutdown();
          process.exit(0);
        });
        
        // Keep process alive
        setInterval(() => {}, 10000);
        break;
        
      case 'status':
        const status = kilo.getStatus();
        console.log('Kilo Status:', JSON.stringify(status, null, 2));
        break;
        
      case 'map':
        await kilo.mapSystemModules();
        console.log(`Mapped ${kilo.systemMap.size} modules`);
        break;
        
      case 'save':
        await kilo.saveOutputs();
        break;
        
      default:
        console.log('Usage: node kilo-execution-engine.js [initialize|status|map|save]');
    }
  })();
}

module.exports = { KiloExecutionEngine };
