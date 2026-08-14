/**
 * HEIDI Operational Control Plane — Audit Log
 */

class AuditLog {
  constructor(options = {}) {
    this.entries = [];
    this.redactor = options.redactor;
  }

  record(entry) {
    const safe = {
      timestamp: entry.timestamp || Date.now(),
      taskId: entry.taskId,
      capabilityId: entry.capabilityId,
      actor: entry.actor,
      target: entry.target,
      inputs: this.redactor ? this.redactor.redact(entry.inputs) : entry.inputs,
      approvalState: entry.approvalState,
      executionResult: entry.executionResult,
      verificationResult: entry.verificationResult,
      duration: entry.duration,
      error: entry.error,
      resultingState: entry.resultingState,
    };
    this.entries.push(safe);
    return safe;
  }

  query(filters = {}) {
    return this.entries.filter(e => {
      if (filters.taskId && e.taskId !== filters.taskId) return false;
      if (filters.capabilityId && e.capabilityId !== filters.capabilityId) return false;
      if (filters.actor && e.actor !== filters.actor) return false;
      if (filters.resultingState && e.resultingState !== filters.resultingState) return false;
      return true;
    });
  }

  last(n = 10) {
    return this.entries.slice(-n);
  }

  getAll() {
    return [...this.entries];
  }
}

module.exports = { AuditLog };
