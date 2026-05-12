// Cascade Graph Reasoner - Graph-based System Reasoning
require('dotenv').config();

class CascadeGraphReasoner {
  constructor() {
    this.systemGraph = null;
    this.dependencyMap = null;
    this.moduleIndex = new Map();
    this.dependencyIndex = new Map();
  }

  async initialize() {
    console.log('=== INITIALIZING CASCADE GRAPH REASONER ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    try {
      // Load cascade-system-graph.json
      await this.loadSystemGraph();
      
      // Build indexes for fast lookup
      await this.buildIndexes();
      
      console.log('=== CASCADE GRAPH REASONER INITIALIZED ===');
      
      return {
        modulesLoaded: this.systemGraph.modules.length,
        dependenciesMapped: Object.keys(this.dependencyMap.direct).length,
        indexesBuilt: this.moduleIndex.size
      };
      
    } catch (error) {
      console.log(`Graph reasoner initialization failed: ${error.message}`);
      throw error;
    }
  }

  async loadSystemGraph() {
    console.log('Loading cascade-system-graph.json...');
    
    const fs = require('fs');
    
    try {
      // Load system graph
      const systemGraphData = fs.readFileSync('cascade-system-graph.json', 'utf8');
      const systemGraph = JSON.parse(systemGraphData);
      
      // Load dependency map
      const dependencyMapData = fs.readFileSync('cascade-dependency-map.json', 'utf8');
      const dependencyMap = JSON.parse(dependencyMapData);
      
      this.systemGraph = systemGraph;
      this.dependencyMap = dependencyMap;
      
      console.log(`Loaded system graph with ${systemGraph.modules.length} modules`);
      console.log(`Loaded dependency map with ${Object.keys(dependencyMap.direct).length} direct dependencies`);
      
    } catch (error) {
      console.log('System graph files not found, generating them...');
      
      // Generate system graph if not exists
      const { CascadeSystemGraph } = require('./cascade-system-graph');
      const graph = new CascadeSystemGraph();
      await graph.buildSystemGraph();
      
      const graphData = graph.getSystemGraph();
      this.systemGraph = graphData.systemGraph;
      this.dependencyMap = graphData.dependencyMap;
    }
  }

  async buildIndexes() {
    console.log('Building indexes for fast lookup...');
    
    // Build module index by name and path
    for (const module of this.systemGraph.modules) {
      this.moduleIndex.set(module.name, module);
      this.moduleIndex.set(module.path, module);
    }
    
    // Build dependency index
    for (const [modulePath, dependencies] of Object.entries(this.dependencyMap.direct)) {
      this.dependencyIndex.set(modulePath, dependencies);
    }
    
    console.log(`Built module index with ${this.moduleIndex.size} entries`);
    console.log(`Built dependency index with ${this.dependencyIndex.size} entries`);
  }

  async queryDownstreamDependencies(moduleName) {
    console.log(`Querying downstream dependencies of: ${moduleName}`);
    
    // Find the module
    const module = this.findModule(moduleName);
    
    if (!module) {
      return {
        summary: `Module "${moduleName}" not found in system graph`,
        dependencies: [],
        risk_level: 'high',
        confidence: 0,
        error: 'MODULE_NOT_FOUND'
      };
    }
    
    // Get downstream dependencies (modules that depend on this module)
    const downstreamModules = this.findDownstreamDependencies(module.path);
    
    // Analyze impact and risk
    const dependencyAnalysis = downstreamModules.map(dep => this.analyzeDependency(dep, module));
    
    // Calculate overall risk level
    const riskLevel = this.calculateRiskLevel(dependencyAnalysis);
    
    // Calculate confidence
    const confidence = this.calculateConfidence(dependencyAnalysis);
    
    // Generate summary
    const summary = this.generateSummary(module, downstreamModules, dependencyAnalysis, riskLevel);
    
    return {
      summary,
      dependencies: dependencyAnalysis,
      risk_level: riskLevel,
      confidence,
      module_info: {
        name: module.name,
        path: module.path,
        functions: module.functions,
        status: module.status
      }
    };
  }

  findModule(moduleName) {
    // Try exact name match first
    if (this.moduleIndex.has(moduleName)) {
      return this.moduleIndex.get(moduleName);
    }
    
    // Try path match
    for (const [path, module] of this.moduleIndex) {
      if (path.includes(moduleName) || module.name === moduleName) {
        return module;
      }
    }
    
    return null;
  }

  findDownstreamDependencies(modulePath) {
    const downstream = [];
    const moduleName = modulePath.split('/').pop().replace('.js', '');
    
    // Find all modules that depend on this module
    for (const [dependentPath, dependencies] of this.dependencyIndex) {
      if (dependencies.some(dep => 
        dep === modulePath || 
        dep === moduleName ||
        dep === `./${moduleName}` ||
        dep.includes(moduleName) ||
        modulePath.includes(dep)
      )) {
        const dependentModule = this.moduleIndex.get(dependentPath);
        if (dependentModule) {
          downstream.push(dependentModule);
        }
      }
    }
    
    // Also check by module name in the system graph
    for (const module of this.systemGraph.modules) {
      if (module.dependencies && module.dependencies.some(dep => 
        dep === moduleName ||
        dep === `./${moduleName}` ||
        dep.includes(moduleName)
      )) {
        if (!downstream.find(m => m.path === module.path)) {
          downstream.push(module);
        }
      }
    }
    
    return downstream;
  }

  analyzeDependency(dependentModule, sourceModule) {
    const dependency = this.dependencyIndex.get(dependentModule.path) || [];
    const directDependency = dependency.find(dep => 
      dep === sourceModule.path || 
      dep.includes(sourceModule.path.split('/').pop())
    );
    
    // Determine role based on module type and functions
    const role = this.determineRole(dependentModule, sourceModule);
    
    // Calculate impact based on dependency type and module importance
    const impact = this.calculateImpact(dependentModule, sourceModule, directDependency);
    
    return {
      file: dependentModule.path,
      name: dependentModule.name,
      role,
      impact,
      dependency_type: directDependency ? 'direct' : 'transitive',
      functions: dependentModule.functions,
      status: dependentModule.status,
      risk_contribution: this.calculateRiskContribution(dependentModule, impact)
    };
  }

  determineRole(dependentModule, sourceModule) {
    // Analyze the relationship between modules
    const dependency = this.dependencyIndex.get(dependentModule.path) || [];
    
    // Check if it's a core dependency
    if (dependentModule.name.includes('core') || dependentModule.name.includes('main')) {
      return 'core_consumer';
    }
    
    // Check if it's a test dependency
    if (dependentModule.name.includes('test') || dependentModule.name.includes('spec')) {
      return 'test_consumer';
    }
    
    // Check if it's an event handler
    if (dependentModule.functions.some(func => func.includes('handle') || func.includes('process'))) {
      return 'event_handler';
    }
    
    // Check if it's a service/module
    if (dependentModule.status === 'server' || dependentModule.status === 'service') {
      return 'service_consumer';
    }
    
    // Default to module consumer
    return 'module_consumer';
  }

  calculateImpact(dependentModule, sourceModule, directDependency) {
    let impact = 'low';
    
    // Higher impact for direct dependencies
    if (directDependency) {
      impact = 'medium';
    }
    
    // Higher impact for critical modules
    if (dependentModule.status === 'server' || dependentModule.status === 'database') {
      impact = 'high';
    }
    
    // Higher impact for modules with many functions
    if (dependentModule.functions.length > 10) {
      impact = 'high';
    } else if (dependentModule.functions.length > 5) {
      impact = 'medium';
    }
    
    // Higher impact for core infrastructure modules
    if (dependentModule.name.includes('core') || dependentModule.name.includes('main') || dependentModule.name.includes('system')) {
      impact = 'high';
    }
    
    return impact;
  }

  calculateRiskContribution(dependentModule, impact) {
    let risk = 0.1; // Base risk
    
    // Add risk based on impact
    switch (impact) {
      case 'high':
        risk += 0.4;
        break;
      case 'medium':
        risk += 0.2;
        break;
      case 'low':
        risk += 0.1;
        break;
    }
    
    // Add risk based on module complexity
    if (dependentModule.functions.length > 10) {
      risk += 0.2;
    }
    
    // Add risk based on module type
    if (dependentModule.status === 'server' || dependentModule.status === 'database') {
      risk += 0.3;
    }
    
    return Math.min(risk, 1.0);
  }

  calculateRiskLevel(dependencies) {
    if (dependencies.length === 0) {
      return 'low';
    }
    
    // Calculate total risk score
    const totalRisk = dependencies.reduce((sum, dep) => sum + dep.risk_contribution, 0);
    const averageRisk = totalRisk / dependencies.length;
    
    // Determine risk level
    if (averageRisk > 0.7) {
      return 'high';
    } else if (averageRisk > 0.4) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  calculateConfidence(dependencies) {
    let confidence = 0.5; // Base confidence
    
    // Higher confidence with more dependencies
    confidence += Math.min(dependencies.length * 0.1, 0.3);
    
    // Higher confidence with direct dependencies
    const directCount = dependencies.filter(dep => dep.dependency_type === 'direct').length;
    confidence += directCount * 0.1;
    
    // Lower confidence with many high-impact dependencies
    const highImpactCount = dependencies.filter(dep => dep.impact === 'high').length;
    confidence -= highImpactCount * 0.05;
    
    return Math.max(0.1, Math.min(1.0, confidence));
  }

  generateSummary(sourceModule, downstreamModules, dependencies, riskLevel) {
    const downstreamCount = downstreamModules.length;
    const directCount = dependencies.filter(dep => dep.dependency_type === 'direct').length;
    const highImpactCount = dependencies.filter(dep => dep.impact === 'high').length;
    
    let summary = `The module "${sourceModule.name}" has ${downstreamCount} downstream dependenc${downstreamCount === 1 ? 'y' : 'ies'}. `;
    
    if (directCount > 0) {
      summary += `${directCount} of these are direct dependencies. `;
    }
    
    if (highImpactCount > 0) {
      summary += `${highImpactCount} high-impact dependencies identified. `;
    }
    
    // Add specific insights based on risk level
    switch (riskLevel) {
      case 'high':
        summary += 'Changes to this module could significantly impact system stability due to critical downstream dependencies.';
        break;
      case 'medium':
        summary += 'Changes to this module may affect several downstream components, requiring careful testing.';
        break;
      case 'low':
        summary += 'This module has minimal downstream impact, making changes relatively safe.';
        break;
    }
    
    // Add module-specific insights
    if (sourceModule.status === 'server') {
      summary += ' As a server module, any changes could affect running services.';
    } else if (sourceModule.status === 'database') {
      summary += ' As a database-related module, schema changes could impact data access.';
    }
    
    return summary;
  }

  validateDependencies(dependencies) {
    const validation = {
      valid: true,
      errors: [],
      warnings: []
    };
    
    for (const dep of dependencies) {
      // Check if file exists
      if (!this.moduleIndex.has(dep.file)) {
        validation.valid = false;
        validation.errors.push(`Dependency file not found: ${dep.file}`);
      }
      
      // Check if role is valid
      const validRoles = ['core_consumer', 'test_consumer', 'event_handler', 'service_consumer', 'module_consumer'];
      if (!validRoles.includes(dep.role)) {
        validation.warnings.push(`Unknown role for ${dep.file}: ${dep.role}`);
      }
      
      // Check if impact is valid
      const validImpacts = ['low', 'medium', 'high'];
      if (!validImpacts.includes(dep.impact)) {
        validation.warnings.push(`Unknown impact for ${dep.file}: ${dep.impact}`);
      }
    }
    
    return validation;
  }

  getStatus() {
    return {
      initialized: !!this.systemGraph,
      modulesLoaded: this.systemGraph ? this.systemGraph.modules.length : 0,
      dependenciesMapped: this.dependencyMap ? Object.keys(this.dependencyMap.direct).length : 0,
      indexesBuilt: this.moduleIndex.size,
      timestamp: new Date().toISOString()
    };
  }
}

// CLI interface
if (require.main === module) {
  const reasoner = new CascadeGraphReasoner();
  
  const command = process.argv[2] || 'query';
  const moduleName = process.argv[3] || 'chaos-engine.js';
  
  (async () => {
    try {
      await reasoner.initialize();
      
      switch (command) {
        case 'query':
          const result = await reasoner.queryDownstreamDependencies(moduleName);
          
          console.log('\n=== DEPENDENCY ANALYSIS ===');
          console.log(`Module: ${result.module_info.name}`);
          console.log(`Path: ${result.module_info.path}`);
          console.log(`Status: ${result.module_info.status}`);
          console.log(`Functions: ${result.module_info.functions.length}`);
          console.log(`\nSummary: ${result.summary}`);
          console.log(`Risk Level: ${result.risk_level}`);
          console.log(`Confidence: ${result.confidence.toFixed(2)}`);
          
          console.log('\n=== DOWNSTREAM DEPENDENCIES ===');
          result.dependencies.forEach((dep, index) => {
            console.log(`\n${index + 1}. ${dep.name}`);
            console.log(`   File: ${dep.file}`);
            console.log(`   Role: ${dep.role}`);
            console.log(`   Impact: ${dep.impact}`);
            console.log(`   Type: ${dep.dependency_type}`);
            console.log(`   Functions: ${dep.functions.length}`);
            console.log(`   Risk: ${(dep.risk_contribution * 100).toFixed(1)}%`);
          });
          
          // Validate dependencies
          const validation = reasoner.validateDependencies(result.dependencies);
          if (!validation.valid) {
            console.log('\n=== VALIDATION ERRORS ===');
            validation.errors.forEach(error => console.log(`ERROR: ${error}`));
          }
          
          if (validation.warnings.length > 0) {
            console.log('\n=== VALIDATION WARNINGS ===');
            validation.warnings.forEach(warning => console.log(`WARNING: ${warning}`));
          }
          
          break;
          
        case 'status':
          const status = reasoner.getStatus();
          console.log('Graph Reasoner Status:', JSON.stringify(status, null, 2));
          break;
          
        default:
          console.log('Usage: node cascade-graph-reasoner.js [query|status] [module_name]');
      }
    } catch (error) {
      console.log('Error:', error.message);
      process.exit(1);
    }
  })();
}

module.exports = { CascadeGraphReasoner };
