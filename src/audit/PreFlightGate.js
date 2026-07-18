/**
 * PRE-FLIGHT GATE - Registration Enforcement
 * 
 * This is where Heidi stops being a builder and starts being a verifier.
 * 
 * Before anything new is allowed to exist:
 * 1. Does this already exist?
 * 2. If yes, why are we not reusing it?
 * 3. If no, what confirms it's new?
 * 4. What breaks if we remove this instead of adding it?
 * 
 * If those answers are missing, execution is blocked.
 */

const SystemAuditor = require('./SystemAuditor');
const fs = require('fs').promises;
const path = require('path');

class PreFlightGate {
  constructor(config = {}) {
    this.config = {
      manifestPath: config.manifestPath || path.resolve(__dirname, '../../system-manifest.json'),
      auditPath: config.auditPath || path.resolve(__dirname, '../../audit-results.json'),
      enableBlocking: config.enableBlocking !== false,
      requireRegistration: config.requireRegistration !== false,
      allowExceptions: config.allowExceptions || [],
      
      // Registration requirements
      requiredFields: [
        'name',
        'type',
        'purpose',
        'location',
        'dependencies',
        'dataAccess'
      ]
    };
    
    this.auditor = new SystemAuditor({
      manifestPath: this.config.manifestPath,
      blockUnregistered: this.config.enableBlocking,
      requireRegistration: this.config.requireRegistration
    });
    
    this.registrationLog = [];
    
    console.log('[PRE-FLIGHT GATE] Initialized');
    console.log(`[GATE] Blocking enabled: ${this.config.enableBlocking}`);
    console.log(`[GATE] Registration required: ${this.config.requireRegistration}`);
  }
  
  /**
   * REGISTRATION STEP - Required before anything new can exist
   */
  async registerComponent(component) {
    console.log(`[GATE] Registering component: ${component.name}`);
    
    // Validate required fields
    const validation = await this.validateRegistration(component);
    if (!validation.valid) {
      throw new Error(`Registration validation failed: ${validation.errors.join(', ')}`);
    }
    
    // Check for duplicates
    const duplicateCheck = await this.checkForDuplicates(component);
    if (duplicateCheck.isDuplicate) {
      throw new Error(`Component already exists: ${duplicateCheck.existing.name} in ${duplicateCheck.existing.location}`);
    }
    
    // Load manifest
    await this.auditor.loadManifest();
    
    // Add to manifest
    const updated = await this.addToManifest(component);
    
    // Log registration
    this.registrationLog.push({
      timestamp: new Date().toISOString(),
      action: 'registered',
      component: component.name,
      type: component.type,
      location: component.location
    });
    
    console.log(`[GATE] Component registered successfully: ${component.name}`);
    
    return updated;
  }
  
  async validateRegistration(component) {
    const errors = [];
    const warnings = [];
    
    // Check required fields
    for (const field of this.config.requiredFields) {
      if (!component[field]) {
        errors.push(`Missing required field: ${field}`);
      }
    }
    
    // Validate type
    const validTypes = ['orchestrator', 'model_router', 'memory_manager', 'action_executor', 'governance', 'infrastructure'];
    if (!validTypes.includes(component.type)) {
      warnings.push(`Unknown component type: ${component.type}`);
    }
    
    // Validate location
    if (!component.location || !await this.fileExists(component.location)) {
      errors.push(`Invalid or missing location: ${component.location}`);
    }
    
    // Validate dependencies
    if (component.dependencies && !Array.isArray(component.dependencies)) {
      errors.push(`Dependencies must be an array`);
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
  
  async checkForDuplicates(component) {
    await this.auditor.loadManifest();
    
    // Check manifest
    if (this.auditor.manifest) {
      for (const [category, services] of Object.entries(this.auditor.manifest.services)) {
        for (const [serviceName, serviceInfo] of Object.entries(services)) {
          if (serviceName === component.name) {
            return {
              isDuplicate: true,
              existing: {
                name: serviceName,
                type: serviceInfo.type,
                location: serviceInfo.location,
                category
              }
            };
          }
        }
      }
    }
    
    // Check inventory
    await this.auditor.scanInventory();
    if (this.auditor.inventory) {
      const existingFunc = this.auditor.inventory.functions.find(f => f.name === component.name);
      if (existingFunc) {
        return {
          isDuplicate: true,
          existing: {
            name: existingFunc.name,
            type: 'function',
            location: existingFunc.file,
            line: existingFunc.line
          }
        };
      }
      
      const existingClass = this.auditor.inventory.classes.find(c => c.name === component.name);
      if (existingClass) {
        return {
          isDuplicate: true,
          existing: {
            name: existingClass.name,
            type: 'class',
            location: existingClass.file,
            line: existingClass.line
          }
        };
      }
    }
    
    return { isDuplicate: false };
  }
  
  async addToManifest(component) {
    const manifestPath = this.config.manifestPath;
    
    try {
      // Read current manifest
      const manifestData = await fs.readFile(manifestPath, 'utf8');
      const manifest = JSON.parse(manifestData);
      
      // Determine category
      const category = this.determineCategory(component.type);
      
      // Add component to appropriate category
      if (!manifest.services[category]) {
        manifest.services[category] = {};
      }
      
      manifest.services[category][component.name] = {
        type: component.type,
        location: component.location,
        purpose: component.purpose,
        triggers: component.triggers || [],
        dataAccess: component.dataAccess || [],
        dependencies: component.dependencies || [],
        status: 'active',
        lastModified: new Date().toISOString()
      };
      
      // Update manifest version and timestamp
      manifest.manifest.lastUpdated = new Date().toISOString();
      
      // Write back to file
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      
      console.log(`[GATE] Added ${component.name} to manifest in category ${category}`);
      
      return manifest;
      
    } catch (error) {
      throw new Error(`Failed to add to manifest: ${error.message}`);
    }
  }
  
  determineCategory(type) {
    const categoryMap = {
      'orchestrator': 'core',
      'governance': 'core',
      'model_router': 'intelligence',
      'memory_manager': 'memory',
      'action_executor': 'actions',
      'revenue_manager': 'actions',
      'self_monitoring': 'memory',
      'infrastructure': 'infrastructure'
    };
    
    return categoryMap[type] || 'core';
  }
  
  fileExists(filePath) {
    try {
      return fs.access(filePath).then(() => true).catch(() => false);
    } catch {
      return false;
    }
  }
  
  /**
   * PRE-FLIGHT CHECK - Before execution
   */
  async preFlightCheck(action, context = {}) {
    console.log(`[GATE] Pre-flight check for action: ${action.type}`);
    
    const check = {
      allowed: true,
      blocked: false,
      violations: [],
      recommendations: [],
      existingAlternatives: [],
      registrationRequired: false
    };
    
    // Check if action is in exception list
    if (this.config.allowExceptions.includes(action.type)) {
      console.log(`[GATE] Action ${action.type} is in exception list - allowed`);
      return check;
    }
    
    // Load manifest and inventory
    await this.auditor.loadManifest();
    await this.auditor.scanInventory();
    
    // Check if this is a new component creation
    if (action.type === 'create_component') {
      const componentCheck = await this.checkComponentCreation(action, context);
      
      if (!componentCheck.allowed) {
        check.allowed = false;
        check.blocked = true;
        check.violations.push(...componentCheck.violations);
        check.recommendations.push(...componentCheck.recommendations);
        check.existingAlternatives.push(...componentCheck.existingAlternatives);
        check.registrationRequired = componentCheck.registrationRequired;
      }
    }
    
    // Check for redundant actions
    const redundancyCheck = await this.checkActionRedundancy(action, context);
    if (redundancyCheck.isRedundant) {
      check.violations.push({
        type: 'redundant_action',
        message: `Action already exists: ${redundancyCheck.existing.name}`,
        severity: 'medium'
      });
      check.existingAlternatives.push(redundancyCheck.existing);
      
      if (this.config.enableBlocking) {
        check.allowed = false;
        check.blocked = true;
      }
    }
    
    // Log check
    this.registrationLog.push({
      timestamp: new Date().toISOString(),
      action: 'pre_flight_check',
      actionType: action.type,
      allowed: check.allowed,
      blocked: check.blocked,
      violations: check.violations.length
    });
    
    console.log(`[GATE] Pre-flight check result: ${check.allowed ? 'ALLOWED' : 'BLOCKED'}`);
    
    if (check.blocked) {
      console.log(`[GATE] BLOCKED: ${check.violations.map(v => v.message).join(', ')}`);
    }
    
    return check;
  }
  
  async checkComponentCreation(action, _context) {
    const componentName = action.params?.name;
    
    if (!componentName) {
      return {
        allowed: false,
        violations: [{
          type: 'missing_name',
          message: 'Component creation requires a name',
          severity: 'high'
        }],
        recommendations: [],
        existingAlternatives: [],
        registrationRequired: true
      };
    }
    
    // Check if already registered
    const duplicateCheck = await this.checkForDuplicates({ name: componentName });
    if (duplicateCheck.isDuplicate) {
      return {
        allowed: false,
        violations: [{
          type: 'already_exists',
          message: `Component ${componentName} already exists in ${duplicateCheck.existing.location}`,
          severity: 'high'
        }],
        recommendations: [{
          type: 'reuse_existing',
          message: `Use existing component: ${duplicateCheck.existing.name}`,
          severity: 'low'
        }],
        existingAlternatives: [duplicateCheck.existing],
        registrationRequired: false
      };
    }
    
    // Check registration requirements
    if (this.config.requireRegistration) {
      return {
        allowed: false,
        violations: [{
          type: 'registration_required',
          message: `Component ${componentName} must be registered before creation`,
          severity: 'high'
        }],
        recommendations: [{
          type: 'register_first',
          message: `Register component using registerComponent() method`,
          severity: 'medium'
        }],
        existingAlternatives: [],
        registrationRequired: true
      };
    }
    
    return {
      allowed: true,
      violations: [],
      recommendations: [],
      existingAlternatives: [],
      registrationRequired: false
    };
  }
  
  async checkActionRedundancy(action, _context) {
    // Look for similar actions in inventory
    if (!this.auditor.inventory) {
      return { isRedundant: false };
    }
    
    const actionName = action.type;
    const similarActions = this.auditor.inventory.functions.filter(f => 
      f.name.toLowerCase().includes(actionName.toLowerCase()) ||
      actionName.toLowerCase().includes(f.name.toLowerCase())
    );
    
    if (similarActions.length > 0) {
      return {
        isRedundant: true,
        existing: similarActions[0]
      };
    }
    
    return { isRedundant: false };
  }
  
  /**
   * VERIFICATION MODE - Heidi as observer, not participant
   */
  async verifyBeforeBuild(proposal) {
    console.log(`[GATE] Verifying build proposal: ${proposal.name}`);
    
    const verification = {
      verified: false,
      blocked: false,
      findings: [],
      recommendations: [],
      existingSolutions: []
    };
    
    // Check if this already exists
    const existing = await this.findExistingSolutions(proposal);
    if (existing.length > 0) {
      verification.findings.push({
        type: 'existing_solutions_found',
        message: `Found ${existing.length} existing solutions for ${proposal.name}`,
        severity: 'high'
      });
      verification.existingSolutions.push(...existing);
      
      if (this.config.enableBlocking) {
        verification.blocked = true;
        verification.findings.push({
          type: 'build_blocked',
          message: 'Build blocked due to existing solutions',
          severity: 'high'
        });
      }
    }
    
    // Check if it would create redundancy
    const redundancyCheck = await this.assessRedundancyRisk(proposal);
    if (redundancyCheck.risk > 0.7) {
      verification.findings.push({
        type: 'high_redundancy_risk',
        message: `High redundancy risk: ${redundancyCheck.risk.toFixed(2)}`,
        severity: 'medium'
      });
    }
    
    // Check if it would make something obsolete
    const obsolescenceCheck = await this.assessObsolescenceRisk(proposal);
    if (obsolescenceCheck.wouldObsolete.length > 0) {
      verification.findings.push({
        type: 'obsolescence_risk',
        message: `Would make ${obsolescenceCheck.wouldObsolete.length} components obsolete`,
        severity: 'medium'
      });
      verification.recommendations.push({
        type: 'consider_replacement',
        message: 'Consider replacing existing components instead of adding new ones',
        severity: 'low'
      });
    }
    
    verification.verified = verification.findings.length === 0 || !verification.blocked;
    
    console.log(`[GATE] Verification result: ${verification.verified ? 'VERIFIED' : 'BLOCKED'}`);
    
    return verification;
  }
  
  async findExistingSolutions(proposal) {
    const solutions = [];
    
    // Search in manifest
    if (this.auditor.manifest) {
      for (const [category, services] of Object.entries(this.auditor.manifest.services)) {
        for (const [serviceName, serviceInfo] of Object.entries(services)) {
          if (this.matchesPurpose(serviceInfo.purpose, proposal.purpose)) {
            solutions.push({
              name: serviceName,
              type: serviceInfo.type,
              location: serviceInfo.location,
              purpose: serviceInfo.purpose,
              category
            });
          }
        }
      }
    }
    
    // Search in inventory
    if (this.auditor.inventory) {
      for (const func of this.auditor.inventory.functions) {
        if (this.matchesName(func.name, proposal.name)) {
          solutions.push({
            name: func.name,
            type: 'function',
            location: func.file,
            line: func.line
          });
        }
      }
    }
    
    return solutions;
  }
  
  matchesPurpose(existingPurpose, newPurpose) {
    // Simple text matching - could be made more sophisticated
    return existingPurpose.toLowerCase().includes(newPurpose.toLowerCase()) ||
           newPurpose.toLowerCase().includes(existingPurpose.toLowerCase());
  }
  
  matchesName(existingName, newName) {
    return existingName.toLowerCase().includes(newName.toLowerCase()) ||
           newName.toLowerCase().includes(existingName.toLowerCase());
  }
  
  async assessRedundancyRisk(proposal) {
    // Simple risk assessment based on similarity to existing components
    let risk = 0;
    
    const existing = await this.findExistingSolutions(proposal);
    risk += existing.length * 0.3;
    
    // Check for similar patterns
    const patterns = ['checkout', 'webhook', 'reflect', 'drift', 'audit', 'payment'];
    for (const pattern of patterns) {
      if (proposal.name.toLowerCase().includes(pattern)) {
        risk += 0.2;
      }
    }
    
    return { risk: Math.min(1, risk) };
  }
  
  async assessObsolescenceRisk(proposal) {
    const wouldObsolete = [];
    
    // Check if this would replace existing functionality
    const existing = await this.findExistingSolutions(proposal);
    for (const solution of existing) {
      if (this.isSuperior(proposal, solution)) {
        wouldObsolete.push(solution);
      }
    }
    
    return { wouldObsolete };
  }
  
  isSuperior(proposal, existing) {
    // Simple heuristic - could be made more sophisticated
    return proposal.name.length > existing.name.length; // Placeholder logic
  }
  
  /**
   * REGISTRATION STATUS
   */
  getRegistrationStatus() {
    return {
      totalRegistered: this.registrationLog.filter(r => r.action === 'registered').length,
      totalBlocked: this.registrationLog.filter(r => r.blocked).length,
      totalChecks: this.registrationLog.filter(r => r.action === 'pre_flight_check').length,
      recentActivity: this.registrationLog.slice(-10)
    };
  }
  
  async getRegistrationLog() {
    return this.registrationLog;
  }
  
  async reset() {
    this.registrationLog = [];
    console.log('[GATE] Registration log reset');
  }
}

module.exports = PreFlightGate;
