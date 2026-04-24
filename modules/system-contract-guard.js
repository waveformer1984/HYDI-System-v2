// System Contract Guard - Enforces architectural boundaries
// Prevents modules from executing unauthorized actions

const CONTRACT_VIOLATIONS = new Map();

class SystemContractGuard {
  constructor() {
    this.violations = new Map();
    this.modulePermissions = new Map();
    this.initializeDefaultPermissions();
  }

  initializeDefaultPermissions() {
    // Define what each module type is allowed to do
    this.modulePermissions.set('CASCADE', new Set([
      'detect_event',
      'classify_event', 
      'emit_event',
      'validate_event',
      'normalize_event',
      'get_status'
    ]));

    this.modulePermissions.set('KILO', new Set([
      'process_event',
      'generate_repair_manifest_suggestion',
      'validate_cascade_state',
      'emit_audit_log',
      'get_status'
    ]));

    this.modulePermissions.set('PROTOFORGE_ORCHESTRATOR', new Set([
      'execute_repair',
      'route_event',
      'monitor_system_health',
      'enforce_contracts'
    ]));
  }

  // Check if a module is allowed to perform an action
  checkPermission(moduleType, action) {
    const permissions = this.modulePermissions.get(moduleType);
    if (!permissions) {
      this.logViolation(moduleType, action, 'UNKNOWN_MODULE_TYPE');
      return false;
    }

    const isAllowed = permissions.has(action);
    if (!isAllowed) {
      this.logViolation(moduleType, action, 'PERMISSION_DENIED');
    }
    return isAllowed;
  }

  logViolation(moduleType, action, reason) {
    const violation = {
      timestamp: new Date().toISOString(),
      moduleType,
      action,
      reason,
      violationType: 'CONTRACT_VIOLATION'
    };

    // Store violation
    const violationKey = `${moduleType}-${action}-${Date.now()}`;
    this.violations.set(violationKey, violation);

    // Emit contract violation event (would go to event bus in real implementation)
    console.error(`CONTRACT_VIOLATION: MODULE_ATTEMPTED_UNAUTHORIZED_ACTION`, {
      moduleType,
      action,
      reason,
      timestamp: violation.timestamp
    });

    // In a real implementation, this would throw and halt execution
    // For now, we'll log and return false to prevent the action
    throw new Error(`CONTRACT_VIOLATION: MODULE_ATTEMPTED_UNAUTHORIZED_ACTION - ${moduleType} attempted ${action}`);
  }

  // Get all violations for auditing
  getViolations() {
    return Array.from(this.violations.values());
  }

  // Clear violations (for testing/reset)
  clearViolations() {
    this.violations.clear();
  }
}

// Singleton instance
const systemContractGuard = new SystemContractGuard();

module.exports = { SystemContractGuard, systemContractGuard };