'use strict';

/**
 * Heidi persistent memory audit — delegates to the same 7-check logic as chat `memory audit`.
 * Hermetic tests inject a mock store; live runs need heidi-core MemoryRuntime.
 */
class MemoryAuditor {
  /**
   * @param {{ runMemoryAudit?: () => Promise<{ passed: number, total: number, results: Array<[string,string]> }> }} [deps]
   */
  constructor(deps = {}) {
    this.runMemoryAudit = deps.runMemoryAudit || null;
  }

  async audit() {
    if (typeof this.runMemoryAudit === 'function') {
      const r = await this.runMemoryAudit();
      const ok = r.passed === r.total;
      return {
        ok,
        passed: r.passed,
        total: r.total,
        memory_retrieval_accuracy: r.memory_retrieval_accuracy,
        findings: ok ? [] : [{
          severity: 'high',
          subsystem: 'heidi-memory',
          code: 'memory_audit_failed',
          message: `Memory audit ${r.passed}/${r.total} passed`,
          evidence: { results: r.results },
          remediation: 'Inspect heidi-core/memory store connectivity and schema.',
        }],
      };
    }
    return {
      ok: null,
      skipped: true,
      findings: [{
        severity: 'info',
        subsystem: 'heidi-memory',
        code: 'memory_audit_skipped',
        message: 'Memory audit not wired in this runtime (inject runMemoryAudit for live checks).',
        remediation: 'Run `memory audit` in Heidi chat on heidi-core host.',
      }],
    };
  }
}

module.exports = { MemoryAuditor };
