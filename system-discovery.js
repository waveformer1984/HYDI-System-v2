// System Discovery - Build System Map for HEIDI
require('dotenv').config();

class SystemDiscovery {
  constructor() {
    this.rootPath = process.cwd();
    this.systemMap = {
      paths: {},
      modules: {},
      services: {},
      discovered: false
    };
  }

  async discoverSystem() {
    console.log('=== SYSTEM DISCOVERY ===');
    console.log(`Root Path: ${this.rootPath}`);
    
    try {
      // Discover directories
      await this.discoverDirectories();
      
      // Discover modules
      await this.discoverModules();
      
      // Discover services
      await this.discoverServices();
      
      // Build system map
      this.buildSystemMap();
      
      this.systemMap.discovered = true;
      
      console.log('=== SYSTEM DISCOVERY COMPLETE ===');
      
      return this.systemMap;
      
    } catch (error) {
      console.log(`System discovery failed: ${error.message}`);
      throw error;
    }
  }

  async discoverDirectories() {
    console.log('Discovering system directories...');
    
    const fs = require('fs');
    const path = require('path');
    
    const targetDirectories = [
      'modules',
      'knowledge_base',
      'cascade',
      'kilo',
      'ursula',
      'core',
      'apps',
      'Services'
    ];
    
    for (const dir of targetDirectories) {
      const dirPath = path.join(this.rootPath, dir);
      
      if (fs.existsSync(dirPath)) {
        const stats = fs.statSync(dirPath);
        
        this.systemMap.paths[dir] = {
          path: dirPath,
          exists: true,
          type: 'directory',
          size: 0,
          modified: stats.mtime,
          discovered: new Date().toISOString()
        };
        
        console.log(`  Found: ${dir}`);
        
        // Count files in directory
        try {
          const files = fs.readdirSync(dirPath);
          this.systemMap.paths[dir].fileCount = files.length;
          console.log(`    Files: ${files.length}`);
        } catch (error) {
          console.log(`    Could not read directory: ${error.message}`);
        }
        
      } else {
        this.systemMap.paths[dir] = {
          path: dirPath,
          exists: false,
          type: 'directory',
          discovered: new Date().toISOString()
        };
        
        console.log(`  Missing: ${dir}`);
      }
    }
  }

  async discoverModules() {
    console.log('Discovering system modules...');
    
    const fs = require('fs');
    const path = require('path');
    
    const modulesPath = path.join(this.rootPath, 'modules');
    
    if (fs.existsSync(modulesPath)) {
      const files = fs.readdirSync(modulesPath);
      
      for (const file of files) {
        if (file.endsWith('.js')) {
          const modulePath = path.join(modulesPath, file);
          const stats = fs.statSync(modulePath);
          
          this.systemMap.modules[file] = {
            path: modulePath,
            type: 'module',
            size: stats.size,
            modified: stats.mtime,
            loaded: false,
            discovered: new Date().toISOString()
          };
          
          console.log(`  Module: ${file}`);
        }
      }
    } else {
      console.log('  No modules directory found');
    }
  }

  async discoverServices() {
    console.log('Discovering system services...');
    
    const fs = require('fs');
    const path = require('path');
    
    // Look for service files
    const serviceFiles = [
      'cascade-node.js',
      'cascade-node-simple.js',
      'ursula-dashboard.js',
      'protoforge-mock.js',
      'hydi-orchestrator.js',
      'production-orchestrator.js'
    ];
    
    for (const file of serviceFiles) {
      const filePath = path.join(this.rootPath, file);
      
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        
        this.systemMap.services[file] = {
          path: filePath,
          type: 'service',
          size: stats.size,
          modified: stats.mtime,
          status: 'discovered',
          discovered: new Date().toISOString()
        };
        
        console.log(`  Service: ${file}`);
      }
    }
    
    // Look for running services
    const runningServices = [
      { name: 'Ursula Dashboard', port: 3002, path: '/events/stream' },
      { name: 'ProtoForge', port: 3001, path: '/' },
      { name: 'HYDI System', port: 3000, path: '/health' }
    ];
    
    for (const service of runningServices) {
      try {
        const http = require('http');
        
        const checkService = () => {
          return new Promise((resolve) => {
            const req = http.request({
              hostname: 'localhost',
              port: service.port,
              path: service.path,
              method: 'GET',
              timeout: 2000
            });
            
            req.on('response', (res) => {
              resolve({ running: true, status: res.statusCode });
            });
            
            req.on('error', () => {
              resolve({ running: false, error: 'Connection failed' });
            });
            
            req.on('timeout', () => {
              resolve({ running: false, error: 'Connection timeout' });
            });
            
            req.end();
          });
        };
        
        const result = await checkService();
        
        this.systemMap.services[service.name] = {
          port: service.port,
          path: service.path,
          type: 'running_service',
          status: result.running ? 'processing' : 'stopped',
          discovered: new Date().toISOString(),
          details: result
        };
        
        console.log(`  Service: ${service.name} - ${result.running ? 'processing' : 'STOPPED'}`);
        
      } catch (error) {
        console.log(`  Service: ${service.name} - ERROR: ${error.message}`);
      }
    }
  }

  buildSystemMap() {
    console.log('Building system map...');
    
    this.systemMap.summary = {
      totalPaths: Object.keys(this.systemMap.paths).length,
      existingPaths: Object.values(this.systemMap.paths).filter(p => p.exists).length,
      totalModules: Object.keys(this.systemMap.modules).length,
      totalServices: Object.keys(this.systemMap.services).length,
      runningServices: Object.values(this.systemMap.services).filter(s => s.status === 'processing').length,
      discovered: new Date().toISOString()
    };
    
    console.log(`  Paths: ${this.systemMap.summary.totalPaths} (${this.systemMap.summary.existingPaths} exist)`);
    console.log(`  Modules: ${this.systemMap.summary.totalModules}`);
    console.log(`  Services: ${this.systemMap.summary.totalServices} (${this.systemMap.summary.runningServices} running)`);
  }

  getSystemMap() {
    return this.systemMap;
  }

  saveSystemMap() {
    const fs = require('fs');
    const path = require('path');
    
    const mapPath = path.join(this.rootPath, 'system-map.json');
    
    try {
      fs.writeFileSync(mapPath, JSON.stringify(this.systemMap, null, 2));
      console.log(`System map saved to: ${mapPath}`);
      
      return mapPath;
      
    } catch (error) {
      console.log(`Failed to save system map: ${error.message}`);
      throw error;
    }
  }
}

// CLI interface
if (require.main === module) {
  const discovery = new SystemDiscovery();
  
  (async () => {
    try {
      await discovery.discoverSystem();
      await discovery.saveSystemMap();
      
      console.log('\n=== SYSTEM MAP ===');
      console.log(JSON.stringify(discovery.getSystemMap(), null, 2));
      
    } catch (error) {
      console.log(`System discovery failed: ${error.message}`);
      process.exit(1);
    }
  })();
}

module.exports = { SystemDiscovery };
