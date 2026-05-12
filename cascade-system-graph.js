// Cascade System Graph - Primary Intelligence Core
require('dotenv').config();

class CascadeSystemGraph {
  constructor() {
    this.systemGraph = {
      modules: new Map(),
      services: new Map(),
      events: new Map(),
      dependencies: new Map(),
      timestamp: null
    };
    this.dependencyMap = {
      direct: new Map(),
      transitive: new Map(),
      circular: [],
      orphans: []
    };
  }

  async buildSystemGraph() {
    console.log('=== BUILDING CASCADE SYSTEM GRAPH ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    try {
      // Phase 1: Recursive system scanning
      await this.scanEntireSystem();
      
      // Phase 2: Build dependency maps
      await this.buildDependencyMaps();
      
      // Phase 3: Detect circular dependencies
      await this.detectCircularDependencies();
      
      // Phase 4: Identify orphan modules
      await this.identifyOrphans();
      
      // Phase 5: Generate outputs
      await this.generateOutputs();
      
      console.log('=== CASCADE SYSTEM GRAPH COMPLETE ===');
      
      return {
        modulesCount: this.systemGraph.modules.size,
        servicesCount: this.systemGraph.services.size,
        eventsCount: this.systemGraph.events.size,
        dependenciesCount: this.dependencyMap.direct.size,
        circularDependencies: this.dependencyMap.circular.length,
        orphans: this.dependencyMap.orphans.length
      };
      
    } catch (error) {
      console.log(`System graph building failed: ${error.message}`);
      throw error;
    }
  }

  async scanEntireSystem() {
    console.log('Phase 1: Recursive system scanning...');
    
    const fs = require('fs');
    const path = require('path');
    
    const files = this.findFiles(process.cwd(), '.js');
    
    for (const filePath of files) {
      try {
        const moduleInfo = await this.analyzeModule(filePath);
        this.systemGraph.modules.set(filePath, moduleInfo);
      } catch (error) {
        console.log(`Failed to analyze ${filePath}: ${error.message}`);
      }
    }
    
    // Scan for service configurations
    await this.scanServices();
    
    // Scan for event definitions
    await this.scanEvents();
    
    this.systemGraph.timestamp = new Date().toISOString();
    console.log(`Scanned ${files.length} JavaScript files`);
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
            // Skip inaccessible paths
          }
        }
      } catch (readError) {
        // Skip unreadable directories
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
    
    const moduleInfo = {
      path: relativePath,
      name: path.basename(filePath, '.js'),
      inputs: [],
      outputs: [],
      dependencies: [],
      exports: [],
      functions: [],
      events: [],
      ports: [],
      status: 'unknown',
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
    
    // Extract inputs (parameters)
    const paramMatches = content.match(/\(([^)]+)\)/g);
    if (paramMatches) {
      paramMatches.forEach(match => {
        const params = match.replace(/[()]/g, '').split(',').map(p => p.trim().split('=')[0].trim());
        moduleInfo.inputs.push(...params.filter(p => p && !moduleInfo.inputs.includes(p)));
      });
    }
    
    // Extract outputs (return values)
    const returnMatches = content.match(/return\s+([^;]+)/g);
    if (returnMatches) {
      returnMatches.forEach(match => {
        const output = match.replace('return ', '').trim();
        if (output && !moduleInfo.outputs.includes(output)) {
          moduleInfo.outputs.push(output);
        }
      });
    }
    
    // Extract dependencies (require statements)
    const requireMatches = content.match(/require\(['"]([^'"]+)['"]\)/g);
    if (requireMatches) {
      requireMatches.forEach(match => {
        const dep = match.match(/require\(['"]([^'"]+)['"]\)/)[1];
        if (!moduleInfo.dependencies.includes(dep)) {
          moduleInfo.dependencies.push(dep);
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
    
    // Extract events
    const eventMatches = content.match(/(?:emit|Event)[\s\S]*?{[\s\S]*?}/g);
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
    
    // Extract ports (HTTP servers, database connections)
    const portMatches = content.match(/(?:port|PORT)\s*[:=]\s*(\d+)/g);
    if (portMatches) {
      portMatches.forEach(match => {
        const port = match.match(/(\d+)/)[1];
        if (port && !moduleInfo.ports.includes(port)) {
          moduleInfo.ports.push(port);
        }
      });
    }
    
    // Determine status based on content
    if (content.includes('server') || content.includes('listen')) {
      moduleInfo.status = 'server';
    } else if (content.includes('database') || content.includes('supabase')) {
      moduleInfo.status = 'database';
    } else if (content.includes('event') || content.includes('emit')) {
      moduleInfo.status = 'event_handler';
    } else if (content.includes('test') || content.includes('spec')) {
      moduleInfo.status = 'test';
    } else {
      moduleInfo.status = 'module';
    }
    
    return moduleInfo;
  }

  async scanServices() {
    console.log('Scanning for services...');
    
    const packageJsonPath = require('path').join(process.cwd(), 'package.json');
    
    try {
      const packageJson = require(packageJsonPath);
      
      if (packageJson.scripts) {
        for (const [scriptName, scriptCommand] of Object.entries(packageJson.scripts)) {
          const serviceInfo = {
            name: scriptName,
            command: scriptCommand,
            ports: [],
            status: 'defined'
          };
          
          // Extract ports from script commands
          const portMatches = scriptCommand.match(/(?:port|PORT)\s*(?:=|\s)(\d+)/g);
          if (portMatches) {
            portMatches.forEach(match => {
              const port = match.match(/(\d+)/)[1];
              if (port && !serviceInfo.ports.includes(port)) {
                serviceInfo.ports.push(port);
              }
            });
          }
          
          this.systemGraph.services.set(scriptName, serviceInfo);
        }
      }
    } catch (error) {
      console.log('No package.json found, skipping service scanning');
    }
  }

  async scanEvents() {
    console.log('Scanning for events...');
    
    // Collect all events from modules
    for (const [modulePath, moduleInfo] of this.systemGraph.modules) {
      for (const eventType of moduleInfo.events) {
        if (!this.systemGraph.events.has(eventType)) {
          this.systemGraph.events.set(eventType, {
            type: eventType,
            producers: [],
            consumers: [],
            schema: null
          });
        }
        
        const eventInfo = this.systemGraph.events.get(eventType);
        eventInfo.producers.push(modulePath);
      }
    }
    
    // Try to infer consumers based on event handling patterns
    for (const [modulePath, moduleInfo] of this.systemGraph.modules) {
      for (const eventType of moduleInfo.events) {
        // Check if module handles this event type
        if (moduleInfo.functions.some(func => func.includes('handle') || func.includes('process'))) {
          const eventInfo = this.systemGraph.events.get(eventType);
          if (!eventInfo.consumers.includes(modulePath)) {
            eventInfo.consumers.push(modulePath);
          }
        }
      }
    }
  }

  async buildDependencyMaps() {
    console.log('Phase 2: Building dependency maps...');
    
    // Build direct dependency map
    for (const [modulePath, moduleInfo] of this.systemGraph.modules) {
      this.dependencyMap.direct.set(modulePath, moduleInfo.dependencies);
    }
    
    // Build transitive dependency map
    for (const [modulePath, dependencies] of this.dependencyMap.direct) {
      const transitiveDeps = this.getTransitiveDependencies(modulePath, new Set());
      this.dependencyMap.transitive.set(modulePath, Array.from(transitiveDeps));
    }
  }

  getTransitiveDependencies(modulePath, visited) {
    if (visited.has(modulePath)) {
      return visited;
    }
    
    visited.add(modulePath);
    
    const dependencies = this.dependencyMap.direct.get(modulePath) || [];
    
    for (const dep of dependencies) {
      // Find the actual module file for this dependency
      for (const [depPath, depInfo] of this.systemGraph.modules) {
        if (depInfo.name === dep || depPath.includes(dep)) {
          this.getTransitiveDependencies(depPath, visited);
          break;
        }
      }
    }
    
    return visited;
  }

  async detectCircularDependencies() {
    console.log('Phase 3: Detecting circular dependencies...');
    
    const visited = new Set();
    const recursionStack = new Set();
    
    for (const modulePath of this.systemGraph.modules.keys()) {
      if (!visited.has(modulePath)) {
        const cycle = this.detectCycle(modulePath, visited, recursionStack, new Set());
        if (cycle.length > 0) {
          this.dependencyMap.circular.push(cycle);
        }
      }
    }
  }

  detectCycle(modulePath, visited, recursionStack, path) {
    visited.add(modulePath);
    recursionStack.add(modulePath);
    path.add(modulePath);
    
    const dependencies = this.dependencyMap.direct.get(modulePath) || [];
    
    for (const dep of dependencies) {
      // Find the actual module file for this dependency
      let depModulePath = null;
      for (const [candidatePath, candidateInfo] of this.systemGraph.modules) {
        if (candidateInfo.name === dep || candidatePath.includes(dep)) {
          depModulePath = candidatePath;
          break;
        }
      }
      
      if (depModulePath) {
        if (recursionStack.has(depModulePath)) {
          // Found a cycle
          return Array.from(path).concat(depModulePath);
        }
        
        if (!visited.has(depModulePath)) {
          const cycle = this.detectCycle(depModulePath, visited, recursionStack, path);
          if (cycle.length > 0) {
            return cycle;
          }
        }
      }
    }
    
    recursionStack.delete(modulePath);
    return [];
  }

  async identifyOrphans() {
    console.log('Phase 4: Identifying orphan modules...');
    
    const allDependencies = new Set();
    
    // Collect all dependencies
    for (const dependencies of this.dependencyMap.direct.values()) {
      dependencies.forEach(dep => allDependencies.add(dep));
    }
    
    // Find modules that are not depended upon
    for (const [modulePath, moduleInfo] of this.systemGraph.modules) {
      let isDependedUpon = false;
      
      for (const dependencies of this.dependencyMap.direct.values()) {
        if (dependencies.some(dep => moduleInfo.name === dep || modulePath.includes(dep))) {
          isDependedUpon = true;
          break;
        }
      }
      
      if (!isDependedUpon && modulePath !== 'index.js' && !modulePath.includes('main')) {
        this.dependencyMap.orphans.push(modulePath);
      }
    }
  }

  async generateOutputs() {
    console.log('Phase 5: Generating outputs...');
    
    const fs = require('fs');
    
    // Generate system graph output
    const systemGraphOutput = {
      timestamp: this.systemGraph.timestamp,
      summary: {
        totalModules: this.systemGraph.modules.size,
        totalServices: this.systemGraph.services.size,
        totalEvents: this.systemGraph.events.size,
        totalDependencies: this.dependencyMap.direct.size
      },
      modules: Array.from(this.systemGraph.modules.values()),
      services: Array.from(this.systemGraph.services.values()),
      events: Array.from(this.systemGraph.events.values())
    };
    
    fs.writeFileSync('cascade-system-graph.json', JSON.stringify(systemGraphOutput, null, 2));
    
    // Generate dependency map output
    const dependencyMapOutput = {
      timestamp: new Date().toISOString(),
      summary: {
        totalDependencies: this.dependencyMap.direct.size,
        circularDependencies: this.dependencyMap.circular.length,
        orphanModules: this.dependencyMap.orphans.length
      },
      direct: Object.fromEntries(this.dependencyMap.direct),
      transitive: Object.fromEntries(this.dependencyMap.transitive),
      circular: this.dependencyMap.circular,
      orphans: this.dependencyMap.orphans
    };
    
    fs.writeFileSync('cascade-dependency-map.json', JSON.stringify(dependencyMapOutput, null, 2));
    
    console.log('Outputs generated:');
    console.log('  - cascade-system-graph.json');
    console.log('  - cascade-dependency-map.json');
  }

  getSystemGraph() {
    return {
      systemGraph: {
        modules: Array.from(this.systemGraph.modules.values()),
        services: Array.from(this.systemGraph.services.values()),
        events: Array.from(this.systemGraph.events.values()),
        timestamp: this.systemGraph.timestamp
      },
      dependencyMap: {
        direct: Object.fromEntries(this.dependencyMap.direct),
        transitive: Object.fromEntries(this.dependencyMap.transitive),
        circular: this.dependencyMap.circular,
        orphans: this.dependencyMap.orphans
      }
    };
  }
}

// CLI interface
if (require.main === module) {
  const graph = new CascadeSystemGraph();
  
  (async () => {
    try {
      const results = await graph.buildSystemGraph();
      console.log('System graph building complete:', results);
    } catch (error) {
      console.log('System graph building failed:', error.message);
      process.exit(1);
    }
  })();
}

module.exports = { CascadeSystemGraph };
