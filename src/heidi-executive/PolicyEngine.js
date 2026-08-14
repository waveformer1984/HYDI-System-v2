/**
 * HEIDI Operational Control Plane — Policy Engine
 * Deterministic policy checks.
 */

class PolicyEngine {
  constructor(registry) {
    this.registry = registry;
  }

  evaluate(task, actor = {}) {
    const capability = this.registry.get(task.capabilityId);
    if (!capability) {
      return { allowed: false, reason: 'unregistered_capability', riskLevel: null };
    }

    if (task.target && capability.allowedTargets.length > 0
        && !capability.allowedTargets.includes(task.target)) {
      return { allowed: false, reason: 'target_not_allowed', riskLevel: capability.riskLevel };
    }

    const missing = capability.requiredPermissions.filter(p => !(actor.permissions || []).includes(p));
    if (missing.length > 0) {
      return { allowed: false, reason: 'missing_permissions', riskLevel: capability.riskLevel };
    }

    if (capability.requiresApproval && !task.approval) {
      return { allowed: false, reason: 'approval_required', riskLevel: capability.riskLevel, requiresApproval: true };
    }

    return { allowed: true, reason: 'policy_pass', riskLevel: capability.riskLevel };
  }

  requiresApproval(task) {
    const capability = this.registry.get(task.capabilityId);
    if (!capability) return false;
    return capability.requiresApproval || ['MEDIUM', 'HIGH', 'CRITICAL'].includes(capability.riskLevel);
  }
}

module.exports = { PolicyEngine };
