/**
 * HEIDI Operational Control Plane — Approval Manager
 *
 * In-memory by default. When a dataDir is provided, approvals are written to
 * dataDir/approvals.json as a compact JSON object so approval state survives
 * process restarts.
 */

const fs = require('fs');
const path = require('path');

class ApprovalManager {
  constructor(options = {}) {
    this.approvals = new Map();
    this.dataDir = options.dataDir || null;
    this.filePath = this.dataDir ? path.join(this.dataDir, 'approvals.json') : null;

    if (this.filePath) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      if (fs.existsSync(this.filePath)) {
        try {
          const raw = fs.readFileSync(this.filePath, 'utf8');
          const data = JSON.parse(raw);
          if (data && Array.isArray(data)) {
            for (const a of data) {
              if (a && a.taskId) this.approvals.set(a.taskId, a);
            }
          }
        } catch {
          // corrupt or empty — start fresh
        }
      }
    }
  }

  _save() {
    if (this.filePath) {
      fs.writeFileSync(this.filePath, JSON.stringify(Array.from(this.approvals.values()), null, 2));
    }
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
    this._save();
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
      this._save();
      throw new Error('Approval request expired');
    }
    approval.approver = approver;
    approval.decision = 'APPROVED';
    approval.decidedAt = Date.now();
    this._save();
    return approval;
  }

  reject(taskId, approver) {
    const approval = this.approvals.get(taskId);
    if (!approval) throw new Error(`No approval request for ${taskId}`);
    approval.approver = approver;
    approval.decision = 'REJECTED';
    approval.decidedAt = Date.now();
    this._save();
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
