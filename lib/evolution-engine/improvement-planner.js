'use strict';

const SEVERITY_IMPACT = { high: 90, moderate: 55, info: 20, low: 30 };

/**
 * Rank audit findings into a prioritized improvement backlog.
 */
class ImprovementPlanner {
  /**
   * @param {Array<object>} findings
   * @returns {{ backlog: Array<object>, generated_at: string }}
   */
  plan(findings = []) {
    const backlog = findings.map((f, idx) => {
      const impact = SEVERITY_IMPACT[f.severity] ?? 40;
      const cost = this._estimateCost(f);
      const risk = this._estimateRisk(f);
      const resources = f.subsystem === 'observation' ? 30 : 50;
      const deps = f.code === 'memory_audit_skipped' ? 10 : 40;
      const verifyDiff = f.subsystem === 'repo' ? 25 : 55;
      const score = impact * 2 - cost - risk - resources * 0.3 - deps * 0.2 - verifyDiff * 0.2;
      return {
        id: f.item_id || `imp-${f.code}-${idx}`,
        title: f.message,
        severity: f.severity,
        subsystem: f.subsystem,
        code: f.code,
        evidence: f.evidence,
        remediation: f.remediation,
        rank_score: Math.round(score * 10) / 10,
        estimates: { impact, implementation_cost: cost, failure_risk: risk, resources, dependencies: deps, verification_difficulty: verifyDiff },
        execution_mode: this._executionMode(f),
        success_criteria: this._successCriteria(f),
      };
    });
    backlog.sort((a, b) => b.rank_score - a.rank_score);
    return { backlog, generated_at: new Date().toISOString() };
  }

  _estimateCost(f) {
    if (f.code === 'idle' || f.code === 'memory_audit_skipped') return 5;
    if (f.severity === 'info') return 15;
    if (f.subsystem === 'observation') return 45;
    return 60;
  }

  _estimateRisk(f) {
    if (f.subsystem === 'cost-gate' || f.subsystem === 'security') return 70;
    if (f.severity === 'high') return 50;
    return 25;
  }

  _executionMode(f) {
    if (f.code === 'paid_llm_enabled') return 'operator_config_only';
    if (f.subsystem === 'observation') return 'diagnostic_then_human';
    if (f.code === 'error_rate' || f.code === 'division_errors') return 'investigate_with_tests';
    return 'document_and_patch';
  }

  _successCriteria(f) {
    if (f.code === 'error_rate') return ['error_rate below threshold on next assessment window'];
    if (f.subsystem === 'observation') return ['fix-list item cleared or downgraded two consecutive passes'];
    return ['finding absent on next evolution audit'];
  }
}

module.exports = { ImprovementPlanner };
