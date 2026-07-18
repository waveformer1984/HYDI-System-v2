/**
 * RUNTIME ENFORCER - Execution Boundary Enforcement
 * 
 * This moves from "observatory governance" to "enforced governance"
 * 
 * Instead of watching the system behave badly, it makes it impossible
 * to behave badly in the first place.
 * 
 * Enforcement points:
 * 1. Module loader validation before import resolves
 * 2. CI build failure on unregistered artifacts  
 * 3. Runtime rejection of unknown services
 * 4. Elimination of free-form creation paths
 * 
 * This is the turnstile that prevents unregistered books from entering
 * the building, not just checks them after they're inside.
 */

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const logger = require('../../lib/structured-logger').child({ component: 'RuntimeEnforcer' });

class RuntimeEnforcer {
  constructor(config = {}) {
    this.config = {
      manifestPath: config.manifestPath || path.resolve(__dirname, '../../system-manifest.json'),
      enforcementMode: config.enforcementMode || 'strict', // 'strict', 'permissive', 'disabled'
      enableModuleHooking: config.enableModuleHooking !== false,
      enableServiceValidation: config.enableServiceValidation !== false,
      enableCreationBlocking: config.enableCreationBlocking !== false,
      
      // Runtime validation
      validateImports: config.validateImports !== false,
      validateServices: config.validateServices !== false,
      validateActions: config.validateActions !== false,
      
      // CI integration
      enableCIFailure: config.enableCIFailure !== false,
      ciExitCode: config.ciExitCode || 1,
      
      // Allowed exceptions
      allowedModules: config.allowedModules || ['fs', 'path', 'events'],
      allowedServices: config.allowedServices || [],
      allowedPaths: config.allowedPaths || []
    };
    
    this.manifest = null;
    this.registeredModules = new Set();
    this.registeredServices = new Map();
    this.enforcementLog = [];
    this.violations = [];
    
    // Hook into Node.js module loading if enabled
    if (this.config.enableModuleHooking) {
      this.hookModuleLoader();
    }
    
    logger.info('Runtime enforcer initialized');
    logger.info('Enforcer mode', { mode: this.config.enforcementMode });
    logger.info('Enforcer module hooking', { moduleHooking: this.config.enableModuleHooking ? 'ENABLED' : 'DISABLED' });
  }
  
  /**
   * 1. Load and validate manifest at runtime
   */
  async loadManifest() {
    try {
      const manifestData = await fs.readFile(this.config.manifestPath, 'utf8');
      this.manifest = JSON.parse(manifestData);
      
      // Build runtime registries
      this.buildRegistries();
      
      logger.info('Manifest loaded and validated');
      logger.info('Registered services count', { registeredServices: this.registeredServices.size });

      return true;
    } catch (error) {
      logger.error('Failed to load manifest', { error });
      
      if (this.config.enforcementMode === 'strict') {
        throw new Error('Runtime enforcement: Manifest not found or invalid');
      }
      
      return false;
    }
  }
  
  buildRegistries() {
    if (!this.manifest) return;
    
    // Register all services from manifest
    for (const [category, services] of Object.entries(this.manifest.services)) {
      for (const [serviceName, serviceInfo] of Object.entries(services)) {
        this.registeredServices.set(serviceName, {
          ...serviceInfo,
          category,
          registeredAt: Date.now()
        });
      }
    }
    
    // Register allowed modules
    for (const module of this.config.allowedModules) {
      this.registeredModules.add(module);
    }
  }
  
  /**
   * 2. Hook into Node.js module loading
   */
  hookModuleLoader() {
    const Module = require('module');
    const originalLoad = Module._load;
    
    Module._load = function (request, parent, isMain) {
      const enforcer = globalThis.__hydiEnforcer;
      
      if (enforcer && enforcer.config.validateImports) {
        const validation = enforcer.validateImport(request, parent);
        
        if (!validation.allowed && enforcer.config.enforcementMode === 'strict') {
          throw new Error(`Runtime enforcement: Import not allowed - ${request}\\n${validation.reason}`);
        }
        
        if (!validation.allowed && enforcer.config.enforcementMode === 'permissive') {
          logger.warn('Import not allowed but permitted', { request, reason: validation.reason });
          enforcer.logViolation('import_violation', request, validation.reason);
        }
      }
      
      return originalLoad.call(this, request, parent, isMain);
    };
    
    // Store enforcer globally for hook access
    globalThis.__hydiEnforcer = this;
    
    logger.info('Module loader hooked');
  }
  
  /**
   * 3. Validate imports at runtime
   */
  validateImport(request, parent) {
    const validation = {
      allowed: true,
      reason: '',
      registered: false,
      type: 'unknown'
    };
    
    // Check if it's a core Node.js module
    const coreModules = ['fs', 'path', 'events', 'util', 'crypto', 'os', 'child_process'];
    if (coreModules.includes(request)) {
      validation.registered = true;
      validation.type = 'core';
      return validation;
    }
    
    // Check if it's an allowed module
    if (this.config.allowedModules.includes(request)) {
      validation.registered = true;
      validation.type = 'allowed';
      return validation;
    }
    
    // Check if it's a relative path within the project
    if (request.startsWith('./') || request.startsWith('../')) {
      const resolvedPath = path.resolve(parent?.filename || '', request);
      const relativePath = path.relative(process.cwd(), resolvedPath);
      
      // Check if it's in allowed paths
      if (this.config.allowedPaths.some(allowed => relativePath.startsWith(allowed))) {
        validation.registered = true;
        validation.type = 'allowed_path';
        return validation;
      }
      
      // Check if it's a registered service
      const serviceName = this.extractServiceNameFromPath(resolvedPath);
      if (this.registeredServices.has(serviceName)) {
        validation.registered = true;
        validation.type = 'registered_service';
        return validation;
      }
      
      validation.allowed = false;
      validation.reason = `Import not registered: ${request} (resolved: ${relativePath})`;
      validation.type = 'unregistered';
      
      return validation;
    }
    
    // Check if it's a registered service
    if (this.registeredServices.has(request)) {
      validation.registered = true;
      validation.type = 'registered_service';
      return validation;
    }
    
    validation.allowed = false;
    validation.reason = `Import not registered: ${request}`;
    validation.type = 'unregistered';
    
    return validation;
  }
  
  extractServiceNameFromPath(filePath) {
    // Extract service name from file path
    const basename = path.basename(filePath, '.js');
    
    // Convert kebab-case or snake_case to CamelCase
    const serviceName = basename
      .replace(/[-_]/g, ' ')
      .replace(/\\b\\w/g, l => l.toUpperCase())
      .replace(/\\s+/g, '');
    
    return serviceName;
  }
  
  /**
   * 4. Validate services at runtime
   */
  validateService(serviceName, operation = 'access') {
    const validation = {
      allowed: true,
      reason: '',
      registered: false,
      service: null
    };
    
    if (!this.manifest) {
      validation.allowed = this.config.enforcementMode !== 'strict';
      validation.reason = 'Manifest not loaded';
      return validation;
    }
    
    const service = this.registeredServices.get(serviceName);
    
    if (!service) {
      validation.allowed = this.config.allowedServices.includes(serviceName);
      validation.reason = validation.allowed ? 'Allowed by exception' : `Service not registered: ${serviceName}`;
      validation.registered = false;
      return validation;
    }
    
    validation.registered = true;
    validation.service = service;
    
    // Check if service is active
    if (service.status !== 'active') {
      validation.allowed = false;
      validation.reason = `Service not active: ${serviceName} (status: ${service.status})`;
      return validation;
    }
    
    // Check if operation is allowed for this service type
    const allowedOperations = this.getServiceOperations(service.type);
    if (!allowedOperations.includes(operation)) {
      validation.allowed = false;
      validation.reason = `Operation '${operation}' not allowed for service type '${service.type}'`;
      return validation;
    }
    
    return validation;
  }
  
  getServiceOperations(serviceType) {
    const operations = {
      'orchestrator': ['access', 'execute', 'configure'],
      'model_router': ['access', 'execute'],
      'memory_manager': ['access', 'read', 'write', 'delete'],
      'action_executor': ['access', 'execute'],
      'governance': ['access', 'enforce'],
      'infrastructure': ['access', 'monitor']
    };
    
    return operations[serviceType] || ['access'];
  }
  
  /**
   * 5. Block free-form creation paths
   */
  blockCreation(creationRequest) {
    if (!this.config.enableCreationBlocking) {
      return { allowed: true, reason: 'Creation blocking disabled' };
    }
    
    const validation = {
      allowed: true,
      reason: '',
      blocked: false
    };
    
    // Check if this is a known creation pattern
    const creationPatterns = [
      'new Function',
      'eval',
      'require()',
      'import()',
      'process.exec',
      'child_process.spawn',
      'vm.runInNewContext'
    ];
    
    const pattern = creationPatterns.find(pattern => 
      creationRequest.code?.includes(pattern) ||
      creationRequest.type?.includes(pattern)
    );
    
    if (pattern) {
      validation.allowed = false;
      validation.blocked = true;
      validation.reason = `Free-form creation blocked: ${pattern}`;
      
      this.logViolation('creation_blocked', pattern, validation.reason);
      
      if (this.config.enforcementMode === 'strict') {
        throw new Error(`Runtime enforcement: Creation blocked - ${validation.reason}`);
      }
    }
    
    return validation;
  }
  
  /**
   * 6. CI Integration - Fail builds on violations
   */
  validateBuild() {
    if (!this.config.enableCIFailure) {
      return { passed: true, violations: 0 };
    }
    
    logger.info('Validating build');
    
    const buildValidation = {
      passed: true,
      violations: [],
      errors: []
    };
    
    // Load and validate manifest
    const manifestLoaded = this.loadManifest();
    if (!manifestLoaded) {
      buildValidation.passed = false;
      buildValidation.errors.push('Manifest not found or invalid');
    }
    
    // Scan for unregistered files
    const unregisteredFiles = this.scanForUnregisteredFiles();
    if (unregisteredFiles.length > 0) {
      buildValidation.passed = false;
      buildValidation.violations.push(...unregisteredFiles.map(file => ({
        type: 'unregistered_file',
        path: file,
        reason: 'File not registered in manifest'
      })));
    }
    
    // Check for circular dependencies
    const circularDeps = this.checkCircularDependencies();
    if (circularDeps.length > 0) {
      buildValidation.passed = false;
      buildValidation.violations.push(...circularDeps.map(dep => ({
        type: 'circular_dependency',
        cycle: dep,
        reason: 'Circular dependency detected'
      })));
    }
    
    // Report results
    logger.info('Build validation result', { passed: buildValidation.passed ? 'PASSED' : 'FAILED' });
    logger.info('Build validation violations', { violations: buildValidation.violations.length });
    logger.info('Build validation errors', { errors: buildValidation.errors.length });

    // Fail build if not passed
    if (!buildValidation.passed && this.config.enforcementMode === 'strict') {
      logger.error('Build failed due to violations');
      process.exit(this.config.ciExitCode);
    }
    
    return buildValidation;
  }
  
  scanForUnregisteredFiles() {
    const unregistered = [];
    
    try {
      // Find all JS files in the project
      const output = execSync('find . -name "*.js" -not -path "./node_modules/*" -not -path "./.git/*"', { encoding: 'utf8' });
      const files = output.trim().split('\n').filter(f => f.length > 0);
      
      for (const file of files) {
        // Check if file is registered
        const serviceName = this.extractServiceNameFromPath(file);
        if (!this.registeredServices.has(serviceName) && !this.isCoreFile(file)) {
          unregistered.push(file);
        }
      }
    } catch (error) {
      logger.error('Failed to scan for unregistered files', { error });
    }
    
    return unregistered;
  }
  
  isCoreFile(filePath) {
    const corePaths = [
      'package.json',
      'system-manifest.json',
      'audit-results.json',
      '.env'
    ];
    
    return corePaths.some(corePath => filePath.includes(corePath));
  }
  
  checkCircularDependencies() {
    // This would require more sophisticated dependency analysis
    // For now, return empty array
    return [];
  }
  
  /**
   * 7. Runtime service access control
   */
  createServiceProxy(serviceName) {
    const validation = this.validateService(serviceName, 'access');
    
    if (!validation.allowed) {
      throw new Error(`Runtime enforcement: Service access denied - ${serviceName}\\n${validation.reason}`);
    }
    
    // Return proxy that validates all operations
    return new Proxy({}, {
      get(target, prop) {
        const operationValidation = this.validateService(serviceName, prop);
        
        if (!operationValidation.allowed) {
          throw new Error(`Runtime enforcement: Operation denied - ${serviceName}.${prop}\\n${operationValidation.reason}`);
        }
        
        // Return the actual service
        return this.getServiceInstance(serviceName);
      },
      
      has(target, prop) {
        const operationValidation = this.validateService(serviceName, 'access');
        return operationValidation.allowed && Object.prototype.hasOwnProperty.call(this.getServiceInstance(serviceName), prop);
      }
    });
  }
  
  getServiceInstance(serviceName) {
    // This would return the actual service instance
    // For now, return a mock
    return {
      name: serviceName,
      type: this.registeredServices.get(serviceName)?.type || 'unknown',
      status: 'active'
    };
  }
  
  /**
   * 8. Violation logging and monitoring
   */
  logViolation(type, target, reason) {
    const violation = {
      timestamp: new Date().toISOString(),
      type,
      target,
      reason,
      enforcementMode: this.config.enforcementMode
    };
    
    this.violations.push(violation);
    this.enforcementLog.push({
      timestamp: violation.timestamp,
      action: 'violation',
      type,
      target,
      reason
    });
    
    // Keep log manageable
    if (this.violations.length > 1000) {
      this.violations = this.violations.slice(-500);
    }
    
    logger.warn('Violation logged', { type, target, reason });
  }
  
  /**
   * 9. Enforcement status and monitoring
   */
  getEnforcementStatus() {
    return {
      mode: this.config.enforcementMode,
      manifestLoaded: !!this.manifest,
      registeredServices: this.registeredServices.size,
      registeredModules: this.registeredModules.size,
      violations: this.violations.length,
      recentViolations: this.violations.slice(-10),
      enforcementLog: this.enforcementLog.length
    };
  }
  
  getComplianceReport() {
    const report = {
      timestamp: new Date().toISOString(),
      enforcementMode: this.config.enforcementMode,
      compliance: {
        manifestCompliant: !!this.manifest,
        registrationCompliant: this.registeredServices.size > 0,
        violationRate: this.violations.length > 0 ? this.violations.length / (this.registeredServices.size + this.registeredModules.size) : 0,
        overallCompliance: 'unknown'
      },
      registered: {
        services: Array.from(this.registeredServices.keys()),
        modules: Array.from(this.registeredModules)
      },
      violations: {
        total: this.violations.length,
        byType: this.groupViolationsByType(),
        recent: this.violations.slice(-5)
      },
      recommendations: this.generateRecommendations()
    };
    
    // Calculate overall compliance
    const complianceScore = (
      (report.compliance.manifestCompliant ? 0.3 : 0) +
      (report.compliance.registrationCompliant ? 0.4 : 0) +
      (1 - Math.min(1, report.compliance.violationRate)) * 0.3
    );
    
    if (complianceScore > 0.8) {
      report.compliance.overallCompliance = 'high';
    } else if (complianceScore > 0.5) {
      report.compliance.overallCompliance = 'medium';
    } else {
      report.compliance.overallCompliance = 'low';
    }
    
    return report;
  }
  
  groupViolationsByType() {
    const groups = {};
    
    for (const violation of this.violations) {
      if (!groups[violation.type]) {
        groups[violation.type] = 0;
      }
      groups[violation.type]++;
    }
    
    return groups;
  }
  
  generateRecommendations() {
    const recommendations = [];
    
    if (this.violations.length > 10) {
      recommendations.push({
        type: 'high_violation_rate',
        message: 'High violation rate detected. Consider reviewing registration requirements.',
        priority: 'high'
      });
    }
    
    if (!this.manifest) {
      recommendations.push({
        type: 'missing_manifest',
        message: 'System manifest not found. Create or load system-manifest.json.',
        priority: 'critical'
      });
    }
    
    if (this.registeredServices.size === 0) {
      recommendations.push({
        type: 'no_registered_services',
        message: 'No services registered. Register services before enforcement.',
        priority: 'high'
      });
    }
    
    return recommendations;
  }
  
  /**
   * 10. Reset and cleanup
   */
  async reset() {
    this.manifest = null;
    this.registeredModules.clear();
    this.registeredServices.clear();
    this.violations = [];
    this.enforcementLog = [];
    
    logger.info('Runtime enforcer reset');
  }
}

module.exports = RuntimeEnforcer;
