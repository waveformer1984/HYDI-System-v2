// System Contract Guard V2 - ProtoForge Kernel Rule Enforcement
// Hard runtime enforcement layer that prevents unauthorized actions

const fs = require('fs').promises;
const path = require('path');

class SystemContractGuardV2 {
  constructor() {
    // Contract definitions - IMMUTABLE
    this.contracts = {
      KILO: {
        allowedActions: [
          'subscribe_to_events',
          'query_cascade_state',
          'generate_repair_manifest',
          'log_audit_entry'
        ],
        forbiddenActions: [
          'direct_module_execution',
          'side_effect_execution',
          'bypass_event_bus',
          'direct_database_write',
          'system_state_modification'
        ]
      },
      CASCADE: {
        allowedActions: [
          'process_events',
          'classify_events',
          'emit_structured_events',
          'quarantine_events',
          'generate_repair_suggestions'
        ],
        forbiddenActions: [
          'execute_repairs',
          'modify_external_systems',
          'direct_kilo_invocation',
          'bypass_validation'
        ]
      }
    };
    
    // Runtime state tracking
    this.activeModules = new Map();
    this.violationLog = [];
    this.maxViolationLog = 1000;
    
    // Initialize guard
    this.initializeGuard();
  }

  initializeGuard() {
    // Wrap require to monitor module imports
    this.wrapRequire();
    
    // Log guard initialization
    this.logSystemEvent('CONTRACT_GUARD_INITIALIZED', {
      timestamp: new Date().toISOString(),
      contracts: Object.keys(this.contracts)
    });
    
    console.log('[CONTRACT GUARD V2] Runtime enforcement active');
    console.log('[CONTRACT GUARD V2] Monitoring for unauthorized actions');
  }

  // Wrap require to monitor and block forbidden imports
  wrapRequire() {
    const Module = require('module');
    const originalRequire = Module.prototype.require;
    const guard = this; // capture guard instance — 'this' inside the wrapper is the calling module

    Module.prototype.require = function(id) {
      const callingModule = this.filename || 'unknown';

      // Check if this is a forbidden cross-module import
      if (guard.isForbiddenImport(callingModule, id)) {
        const violation = {
          type: 'FORBIDDEN_IMPORT',
          module: callingModule,
          target: id,
          timestamp: new Date().toISOString(),
          stack: new Error().stack
        };
        guard.handleContractViolation(violation);
      }

      // 'this' is the calling module — must preserve it so Node's require resolves correctly
      return originalRequire.call(this, id);
    };
  }

  // Check if import violates contract
  isForbiddenImport(callingModule, targetId) {
    // Normalize paths
    const callingPath = callingModule.toLowerCase();
    const targetPath = targetId.toLowerCase();
    
    // KILO cannot directly import CASCADE modules
    if (callingPath.includes('kilo') && targetPath.includes('cascade')) {
      return true;
    }
    
    // CASCADE cannot directly import KILO execution modules
    if (callingPath.includes('cascade') && targetPath.includes('kilo') && 
        (targetPath.includes('execute') || targetPath.includes('repair'))) {
      return true;
    }
    
    return false;
  }

  // Register module with guard
  registerModule(moduleName, moduleType, capabilities = []) {
    const registration = {
      name: moduleName,
      type: moduleType,
      capabilities: capabilities,
      registeredAt: new Date().toISOString(),
      actionCount: 0
    };
    
    this.activeModules.set(moduleName, registration);
    
    // Validate capabilities against contract
    this.validateModuleCapabilities(moduleName, moduleType, capabilities);
    
    console.log(`[CONTRACT GUARD V2] Module registered: ${moduleName} (${moduleType})`);
  }

  // Validate module capabilities
  validateModuleCapabilities(moduleName, moduleType, capabilities) {
    const contract = this.contracts[moduleType];
    if (!contract) {
      return; // No contract for this module type
    }
    
    // Check for forbidden capabilities
    const forbidden = capabilities.filter(cap => 
      contract.forbiddenActions.some(forbidden => 
        cap.toLowerCase().includes(forbidden.toLowerCase())
      )
    );
    
    if (forbidden.length > 0) {
      const violation = {
        type: 'FORBIDDEN_CAPABILITY',
        module: moduleName,
        moduleType: moduleType,
        forbiddenCapabilities: forbidden,
        timestamp: new Date().toISOString()
      };
      
      this.handleContractViolation(violation);
    }
  }

  // Check action permission before execution
  checkActionPermission(moduleName, action, context = {}) {
    const module = this.activeModules.get(moduleName);
    if (!module) {
      const violation = {
        type: 'UNREGISTERED_MODULE_ACTION',
        module: moduleName,
        action: action,
        timestamp: new Date().toISOString()
      };
      
      this.handleContractViolation(violation);
      return false;
    }
    
    const contract = this.contracts[module.type];
    if (!contract) {
      return true; // No contract restrictions
    }
    
    // Check if action is forbidden
    const isForbidden = contract.forbiddenActions.some(forbidden => 
      action.toLowerCase().includes(forbidden.toLowerCase())
    );
    
    if (isForbidden) {
      const violation = {
        type: 'FORBIDDEN_ACTION',
        module: moduleName,
        moduleType: module.type,
        action: action,
        context: context,
        timestamp: new Date().toISOString()
      };
      
      this.handleContractViolation(violation);
      return false;
    }
    
    // Check if action is allowed
    const isAllowed = contract.allowedActions.some(allowed => 
      action.toLowerCase().includes(allowed.toLowerCase())
    );
    
    if (!isAllowed) {
      const violation = {
        type: 'UNAUTHORIZED_ACTION',
        module: moduleName,
        moduleType: module.type,
        action: action,
        context: context,
        timestamp: new Date().toISOString()
      };
      
      this.handleContractViolation(violation);
      return false;
    }
    
    // Action is permitted
    module.actionCount++;
    return true;
  }

  // Handle contract violation
  handleContractViolation(violation) {
    // Log violation
    this.violationLog.push(violation);
    
    // Trim log if necessary
    if (this.violationLog.length > this.maxViolationLog) {
      this.violationLog = this.violationLog.slice(-this.maxViolationLog);
    }
    
    // Log to system
    const violationMessage = `CONTRACT_VIOLATION: ${violation.type}`;
    console.error(`[CONTRACT GUARD V2] ${violationMessage}`);
    console.error(`[CONTRACT GUARD V2] Module: ${violation.module}`);
    console.error(`[CONTRACT GUARD V2] Action: ${violation.action || violation.target || violation.forbiddenCapabilities?.join(', ')}`);
    
    // Persist violation
    this.persistViolation(violation);
    
    // HARD STOP - Throw error to halt execution
    const error = new Error(violationMessage);
    error.code = 'CONTRACT_VIOLATION';
    error.violation = violation;
    throw error;
  }

  // Persist violation to disk
  async persistViolation(violation) {
    try {
      const violationLogPath = path.join(__dirname, '../data/contract-violations-v2.json');
      
      // Ensure directory exists
      await fs.mkdir(path.dirname(violationLogPath), { recursive: true });
      
      // Read existing violations
      let violations = [];
      try {
        const data = await fs.readFile(violationLogPath, 'utf8');
        violations = JSON.parse(data);
      } catch (error) {
        // File doesn't exist yet
      }
      
      // Add new violation
      violations.push(violation);
      
      // Keep only last 1000 violations
      if (violations.length > 1000) {
        violations = violations.slice(-1000);
      }
      
      // Write back
      await fs.writeFile(
        violationLogPath,
        JSON.stringify(violations, null, 2),
        'utf8'
      );
      
    } catch (error) {
      console.error('[CONTRACT GUARD V2] Failed to persist violation:', error);
    }
  }

  // Log system events
  logSystemEvent(eventType, data) {
    const event = {
      type: eventType,
      timestamp: new Date().toISOString(),
      data: data
    };
    
    // Could emit to event bus or log to file
    console.log(`[CONTRACT GUARD V2] ${eventType}:`, JSON.stringify(data, null, 2));
  }

  // Get guard status
  getStatus() {
    return {
      activeModules: Array.from(this.activeModules.entries()).map(([name, module]) => ({
        name: name,
        type: module.type,
        capabilities: module.capabilities,
        registeredAt: module.registeredAt,
        actionCount: module.actionCount
      })),
      violationCount: this.violationLog.length,
      recentViolations: this.violationLog.slice(-10),
      contracts: Object.keys(this.contracts),
      enforcement: 'STRICT'
    };
  }

  // Create enforcement wrapper for module functions
  enforceModule(moduleName, moduleType, moduleExports) {
    // Register the module
    this.registerModule(moduleName, moduleType, Object.keys(moduleExports));
    
    // Wrap each function to check permissions
    const wrappedExports = {};
    
    for (const [key, value] of Object.entries(moduleExports)) {
      if (typeof value === 'function') {
        wrappedExports[key] = (...args) => {
          // Check permission before execution
          this.checkActionPermission(moduleName, key, {
            args: args.map(arg => typeof arg === 'object' ? '[Object]' : arg)
          });
          
          // Execute original function
          return value.apply(moduleExports, args);
        };
      } else {
        wrappedExports[key] = value;
      }
    }
    
    return wrappedExports;
  }
}

// Create singleton instance
const contractGuardV2 = new SystemContractGuardV2();

// Export enforcement function
module.exports = {
  enforceContract: contractGuardV2.enforceModule.bind(contractGuardV2),
  checkPermission: contractGuardV2.checkActionPermission.bind(contractGuardV2),
  registerModule: contractGuardV2.registerModule.bind(contractGuardV2),
  getStatus: contractGuardV2.getStatus.bind(contractGuardV2),
  guard: contractGuardV2
};
