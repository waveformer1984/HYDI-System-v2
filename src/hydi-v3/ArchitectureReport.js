'use strict';

/**
 * ArchitectureReport renders ArchitectureGuard results into human-readable
 * summaries, JSON, and detailed remediation lists.
 */
class ArchitectureReport {
  static fromRun(run) {
    if (!run) return null;
    return {
      ts: run.ts,
      duration: run.duration,
      status: run.status,
      score: run.score,
      counts: run.counts,
      failures: run.results.filter((r) => r.status === 'fail' || r.status === 'error'),
      warnings: run.results.filter((r) => r.status === 'warning'),
      manual: run.results.filter((r) => r.status === 'manual'),
      passed: run.results.filter((r) => r.status === 'pass'),
      results: run.results,
    };
  }

  static render(run) {
    const r = this.fromRun(run);
    if (!r) return 'No architecture run available';
    const lines = [
      `Architecture Guard Report`,
      `Status: ${r.status.toUpperCase()}`,
      `Score:  ${(r.score * 100).toFixed(0)}%`,
      `Total:  ${r.results.length} invariants`,
      `Pass:   ${r.counts.pass}`,
      `Fail:   ${r.counts.fail}`,
      `Warn:   ${r.counts.warning}`,
      `Manual: ${r.counts.manual}`,
      `Error:  ${r.counts.error}`,
    ];
    if (r.failures.length) {
      lines.push('', 'Failures:');
      for (const f of r.failures) {
        lines.push(`  [${f.category}] ${f.name}: ${f.details}`);
        if (f.affected) lines.push(`    affected: ${f.affected}`);
      }
    }
    if (r.warnings.length) {
      lines.push('', 'Warnings:');
      for (const w of r.warnings) {
        lines.push(`  [${w.category}] ${w.name}: ${w.details}`);
      }
    }
    if (r.manual.length) {
      lines.push('', 'Manual verification required:');
      for (const m of r.manual) {
        lines.push(`  [${m.category}] ${m.name}: ${m.details}`);
      }
    }
    return lines.join('\n');
  }

  static toJson(run) {
    return this.fromRun(run);
  }
}

module.exports = ArchitectureReport;
