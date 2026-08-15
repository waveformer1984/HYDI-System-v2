/**
 * HEIDI Operational Control Plane — Audit Log
 *
 * In-memory by default. When a dataDir is provided, every record is appended
 * to dataDir/audit.jsonl as an immutable, timestamped, line-delimited JSON
 * object. Existing records are replayed on construction so the log survives
 * process restarts.
 */

const fs = require('fs');
const path = require('path');

class AuditLog {
  constructor(options = {}) {
    this.entries = [];
    this.redactor = options.redactor;
    this.dataDir = options.dataDir || null;
    this.filePath = this.dataDir ? path.join(this.dataDir, 'audit.jsonl') : null;

    if (this.filePath) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const lines = raw.split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed && typeof parsed.timestamp === 'number') {
              this.entries.push(parsed);
            }
          } catch {
            // corrupted line — do not crash; continue loading valid records
          }
        }
      }
    }
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

    if (this.filePath) {
      try {
        fs.appendFileSync(this.filePath, JSON.stringify(safe) + '\n');
      } catch (err) {
        // append failure is recorded but does not throw; the in-memory entry remains
        safe._appendError = err.message;
      }
    }

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

  getFilePath() {
    return this.filePath;
  }
}

module.exports = { AuditLog };
