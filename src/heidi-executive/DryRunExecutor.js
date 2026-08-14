/**
 * HEIDI Operational Control Plane — Dry Run Executor
 */

class DryRunExecutor {
  constructor(registry) {
    this.registry = registry;
  }

  preview(task) {
    const cap = this.registry.get(task.capabilityId);
    if (!cap) {
      throw new Error(`Unregistered capability: ${task.capabilityId}`);
    }
    return {
      taskId: task.id,
      target: task.target,
      action: cap.id,
      parameters: task.parameters,
      expectedEffect: cap.description,
      risk: cap.riskLevel,
      rollback: cap.reversible ? (task.rollbackProcedure || cap.verificationProcedure) : 'not_reversible',
      requiresApproval: cap.requiresApproval,
      wouldExecute: !cap.requiresApproval && ['READ', 'LOW'].includes(cap.riskLevel),
    };
  }
}

module.exports = { DryRunExecutor };
