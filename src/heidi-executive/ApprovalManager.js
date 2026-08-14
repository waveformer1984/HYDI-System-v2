/**
 * HEIDI Operational Control Plane — Approval Manager
 */

class ApprovalManager {
  constructor() {
    this.approvals = new Map();
  }

  request(task, requester = 'heidi') {
    const approval = {
      taskId: task.id,
      capabilityId: task.capabilityId,
      target: task.target,
      risk: task.riskLevel,
      requestedAction: task.action,
      proposedParameters: task.parameters,
      expectedSideEffects: task.expectedSideEffects || '',
      rollbackProcedure: task.rollbackProcedure || '',
      requester,
      approver: null,
      requestedAt: Date.now(),
      decidedAt: null,
      decision: 'PENDING',
      expiration: task.approvalExpiration || Date.now() + 3600000,
    };
    this.approvals.set(task.id, approval);
    return approval;
  }

  approve(taskId, approver) {
    const approval = this.approvals.get(taskId);
    if (!approval) throw new Error(`No approval request for ${taskId}`);
    if (approval.requester === approver && approval.risk === 'CRITICAL') {
      throw new Error('Model cannot approve its own critical action');
    }
    if (Date.now() > approval.expiration) {
      approval.decision = 'EXPIRED';
      throw new Error('Approval request expired');
    }
    approval.approver = approver;
    approval.decision = 'APPROVED';
    approval.decidedAt = Date.now();
    return approval;
  }

  reject(taskId, approver) {
    const approval = this.approvals.get(taskId);
    if (!approval) throw new Error(`No approval request for ${taskId}`);
    approval.approver = approver;
    approval.decision = 'REJECTED';
    approval.decidedAt = Date.now();
    return approval;
  }

  isApproved(taskId) {
    const approval = this.approvals.get(taskId);
    return !!approval && approval.decision === 'APPROVED' && Date.now() <= approval.expiration;
  }

  get(taskId) {
    return this.approvals.get(taskId);
  }

  list() {
    return Array.from(this.approvals.values());
  }
}

module.exports = { ApprovalManager };
