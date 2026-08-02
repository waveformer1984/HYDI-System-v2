/**
 * Report Generator
 * ================
 *
 * Generates qualification reports from collected data.
 *
 * REPORTING CONTRACT — every finding carries one of these classifications and
 * the report must never promote a finding to a stronger one:
 *
 *   VERIFIED   measured directly during this run by this harness
 *   OBSERVED   recorded during the run, but not a controlled measurement
 *   INFERRED   derived from measured data; not itself measured
 *   PENDING    intended for this run but not completed (e.g. window too short)
 *   NOT TESTED not exercised at all during this run
 *
 * A phase that did not execute is NOT TESTED, never 'pass'. A scenario that
 * was skipped is NOT TESTED, never a success. Criteria that the harness cannot
 * evaluate are emitted with status 'not_tested' and excluded from the pass
 * tally rather than defaulted to pass or fail.
 */

const fs = require('fs');
const path = require('path');
const { OperationalMetrics } = require('../../scripts/lib/soak-metrics');

const CLASSIFICATIONS = {
  VERIFIED: 'VERIFIED',
  OBSERVED: 'OBSERVED',
  INFERRED: 'INFERRED',
  PENDING: 'PENDING',
  NOT_TESTED: 'NOT TESTED',
};

class ReportGenerator {
  constructor(config) {
    this.config = config;
  }

  /**
   * Generate full qualification report
   */
  generateReport(data) {
    const report = {
      metadata: {
        generatedAt: new Date().toISOString(),
        version: this.getVersion(),
        branch: this.getBranch(),
        commit: this.getCommit(),
        qualificationType: data.qualificationType || 'full',
        duration: data.duration,
        chaosEnabled: data.chaosEnabled === true,
        chaosDryRun: data.chaosDryRun === true
      },
      classificationLegend: CLASSIFICATIONS,
      summary: this.generateSummary(data),
      stackLifecycle: this.generateStackLifecycleReport(data.stackLifecycle, data.stackShutdown),
      workloadExecution: this.generateWorkloadReport(data.workloadExecution),
      metrics: this.generateMetricsReport(data.metrics),
      failureInjection: this.generateFailureReport(data.failureInjection, data.chaosEnabled),
      acceptanceCriteria: this.generateAcceptanceCriteria(data),
      scopeStatement: this.generateScopeStatement(data),
      recommendations: this.generateRecommendations(data)
    };

    return report;
  }

  /**
   * Explicit statement of what this run does and does not evidence, so a
   * reader cannot mistake the report's scope.
   */
  generateScopeStatement(data) {
    const notTested = [];

    if (!data.chaosEnabled) {
      notTested.push(
        'supervisor recovery', 'process restart recovery', 'network interruption recovery',
        'database recovery', 'Redis recovery', 'bridge recovery'
      );
    }
    if (!data.metrics || data.metrics.length === 0) {
      notTested.push('resource utilisation and leak trends');
    }
    notTested.push('data integrity across faults (durable state is not snapshotted or diffed)');
    notTested.push('memory behaviour of service processes (only the harness process is instrumented)');

    return {
      chaosEnabled: data.chaosEnabled === true,
      evidenced: data.chaosEnabled
        ? 'stack startup/shutdown, workload success rates, operational metrics, and the resilience scenarios listed as VERIFIED below'
        : 'stack startup/shutdown, workload success rates, and operational metrics only',
      notTested,
      caveat: data.chaosEnabled
        ? 'Scenarios recorded as skipped were not exercised and must not be cited as evidence of recovery.'
        : 'This run performed NO failure injection. It is not evidence of recovery, resilience, or failover behaviour.'
    };
  }

  /**
   * Generate summary
   */
  generateSummary(data) {
    const overallStatus = this.calculateOverallStatus(data);

    return {
      status: overallStatus,
      phases: {
        stackStartup: data.stackLifecycle ? (data.stackLifecycle.status === 'started' ? 'pass' : 'fail') : 'not_executed',
        stackShutdown: data.stackShutdown ? (data.stackShutdown.status === 'stopped' ? 'pass' : 'fail') : 'not_executed',
        workloadExecution: this.calculatePhaseStatus(data.workloadExecution, (d) => d.every((x) => x.success)),
        metrics: this.calculatePhaseStatus(data.metrics, () => true),
        failureInjection: !data.chaosEnabled
          ? 'not_tested'
          : this.calculatePhaseStatus(data.failureInjection, (d) => d.filter((x) => x.executed).every((x) => x.status === 'passed'))
      },
      overallDuration: data.duration,
      issues: this.identifyIssues(data)
    };
  }

  /**
   * Generate stack lifecycle report.
   * Startup and shutdown are separate records; a single object cannot be both
   * 'started' and 'stopped', and grading both from one value guaranteed that
   * one criterion always failed.
   */
  generateStackLifecycleReport(startData, shutdownData) {
    if (!startData && !shutdownData) return null;

    return {
      startup: startData ? {
        startTime: startData.startTime,
        services: startData.services,
        status: startData.status,
        errors: startData.errors || []
      } : { status: 'not_executed' },
      shutdown: shutdownData ? {
        shutdownTime: shutdownData.shutdownTime,
        uptimeMs: shutdownData.uptimeMs,
        status: shutdownData.status,
        error: shutdownData.error || null
      } : { status: 'not_executed' }
    };
  }

  /**
   * Generate workload report
   */
  generateWorkloadReport(data) {
    if (!data) return null;

    const statistics = this.calculateWorkloadStatistics(data);

    return {
      totalExecutions: data.length,
      statistics,
      errors: data.filter(d => !d.success).map(d => ({
        workload: d.workload,
        timestamp: d.timestamp,
        error: d.error
      }))
    };
  }

  /**
   * Generate metrics report
   */
  generateMetricsReport(data) {
    if (!data || data.length === 0) {
      return { classification: CLASSIFICATIONS.NOT_TESTED, note: 'no metric samples collected', totalSamples: 0 };
    }

    const summary = this.calculateMetricsSummary(data);
    const resourceLeaks = this.checkForResourceLeaks(data);

    return {
      classification: CLASSIFICATIONS.VERIFIED,
      totalSamples: data.length,
      // epochMs is the numeric sample time; `timestamp` is an ISO string and
      // subtracting those yields NaN.
      durationMs: data[data.length - 1].epochMs - data[0].epochMs,
      summary,
      resourceLeaks
    };
  }

  /**
   * Generate failure report
   */
  generateFailureReport(data, chaosEnabled) {
    if (!data) {
      return {
        classification: CLASSIFICATIONS.NOT_TESTED,
        note: 'failure injection phase did not run',
        totalScenarios: 0,
        details: []
      };
    }

    const statistics = this.calculateFailureStatistics(data);

    return {
      chaosEnabled: chaosEnabled === true,
      classification: chaosEnabled ? CLASSIFICATIONS.VERIFIED : CLASSIFICATIONS.NOT_TESTED,
      note: chaosEnabled
        ? 'Scenarios marked skipped were NOT exercised and are classified NOT TESTED.'
        : 'Chaos was disabled for this run; no fault was injected and no recovery was exercised.',
      totalScenarios: data.length,
      statistics,
      details: data.map(d => ({
        failure: d.failure,
        scenario: d.scenario || null,
        timestamp: d.timestamp,
        classification: d.executed ? CLASSIFICATIONS.VERIFIED : CLASSIFICATIONS.NOT_TESTED,
        executed: d.executed === true,
        status: d.status,
        reason: d.reason || null,
        injectedFault: d.injectedFault || null,
        observedBehaviour: d.observedBehaviour || null,
        recoveryTime: d.recoveryTime ?? null,
        recoveredBy: d.recoveredBy || null,
        dataIntegrity: d.dataIntegrity ?? null,
        dataIntegrityNote: d.dataIntegrityNote || 'not verified'
      }))
    };
  }

  /**
   * Generate acceptance criteria
   */
  generateAcceptanceCriteria(data) {
    const criteria = [];
    const push = (name, status, classification, evidence) =>
      criteria.push({ name, status, classification, evidence });

    // --- Stack lifecycle ---
    if (data.stackLifecycle) {
      push('Stack starts successfully',
        data.stackLifecycle.status === 'started' ? 'pass' : 'fail',
        CLASSIFICATIONS.VERIFIED,
        `orchestrator reported status "${data.stackLifecycle.status}"`);
    } else {
      push('Stack starts successfully', 'not_tested', CLASSIFICATIONS.NOT_TESTED, 'startup phase did not run');
    }

    if (data.stackShutdown) {
      push('Stack stops gracefully',
        data.stackShutdown.status === 'stopped' ? 'pass' : 'fail',
        CLASSIFICATIONS.VERIFIED,
        `orchestrator reported status "${data.stackShutdown.status}"`);
    } else {
      push('Stack stops gracefully', 'not_tested', CLASSIFICATIONS.NOT_TESTED, 'shutdown phase did not run');
    }

    // --- Workload ---
    if (data.workloadExecution && data.workloadExecution.length > 0) {
      const stats = this.calculateWorkloadStatistics(data.workloadExecution);
      const target = (this.config.acceptanceCriteria && this.config.acceptanceCriteria.workloadSuccessRate) || 0.99;
      push(`Workload success rate >= ${(target * 100).toFixed(0)}%`,
        stats.overallSuccessRate >= target ? 'pass' : 'fail',
        CLASSIFICATIONS.VERIFIED,
        `${stats.successful}/${stats.total} executions succeeded (${(stats.overallSuccessRate * 100).toFixed(2)}%)`);
    } else {
      push('Workload success rate', 'not_tested', CLASSIFICATIONS.NOT_TESTED, 'no workload executions recorded');
    }

    // --- Resource leaks ---
    const leaks = this.checkForResourceLeaks(data.metrics);
    if (leaks.hasLeaks === null) {
      push('No resource leaks detected', 'not_tested', CLASSIFICATIONS.PENDING,
        leaks.reason || 'insufficient data to evaluate a trend');
    } else {
      push('No resource leaks detected (harness process)',
        leaks.hasLeaks ? 'fail' : 'pass',
        CLASSIFICATIONS.VERIFIED,
        `harness heap trend evaluated over the sample window; scope: ${leaks.scope}`);
    }

    // --- Failure injection ---
    // When chaos is disabled nothing was injected, so these criteria are
    // NOT TESTED. They must never default to pass.
    if (!data.chaosEnabled) {
      push('All failure scenarios recover', 'not_tested', CLASSIFICATIONS.NOT_TESTED,
        'chaos disabled; no fault injected');
      push('Recovery time within target', 'not_tested', CLASSIFICATIONS.NOT_TESTED,
        'chaos disabled; no recovery measured');
    } else {
      const stats = this.calculateFailureStatistics(data.failureInjection || []);
      const maxRecovery = (this.config.acceptanceCriteria && this.config.acceptanceCriteria.recoveryTimeMax) || 300000;

      if (stats.executed === 0) {
        push('All failure scenarios recover', 'not_tested', CLASSIFICATIONS.NOT_TESTED,
          `${stats.skipped} scenario(s) registered but none could be injected`);
        push('Recovery time within target', 'not_tested', CLASSIFICATIONS.NOT_TESTED,
          'no recovery was measured');
      } else {
        push('All executed failure scenarios recover',
          stats.successRate === 1 ? 'pass' : 'fail',
          CLASSIFICATIONS.VERIFIED,
          `${stats.passed}/${stats.executed} executed scenarios recovered; ${stats.skipped} skipped (NOT TESTED)`);
        push(`Recovery time < ${(maxRecovery / 1000).toFixed(0)}s`,
          stats.avgRecoveryTime !== null && stats.avgRecoveryTime < maxRecovery ? 'pass' : 'fail',
          CLASSIFICATIONS.VERIFIED,
          stats.avgRecoveryTime === null
            ? 'no recovery times recorded'
            : `mean measured recovery ${(stats.avgRecoveryTime / 1000).toFixed(1)}s`);
      }
    }

    // Data integrity is never asserted: the harness does not snapshot or diff
    // durable state, so it cannot evidence this either way.
    push('Data integrity maintained across faults', 'not_tested', CLASSIFICATIONS.NOT_TESTED,
      'harness does not snapshot or diff durable state; this cannot be evidenced by this run');

    return criteria;
  }

  /**
   * Generate recommendations
   */
  generateRecommendations(data) {
    const recommendations = [];

    // Analyze data and generate recommendations
    if (data.workloadExecution) {
      const stats = this.calculateWorkloadStatistics(data.workloadExecution);
      if (stats.overallSuccessRate < 0.99) {
        recommendations.push({
          priority: 'high',
          category: 'workload',
          message: `Workload success rate is ${(stats.overallSuccessRate * 100).toFixed(1)}%, investigate failed workloads`
        });
      }
    }

    if (data.metrics && data.metrics.length > 0) {
      const resourceLeaks = this.checkForResourceLeaks(data.metrics);
      if (resourceLeaks.hasLeaks === true) {
        recommendations.push({
          priority: 'critical',
          category: 'resources',
          message: 'Resource leak detected in the harness process, investigate memory trend'
        });
      } else if (resourceLeaks.hasLeaks === null) {
        recommendations.push({
          priority: 'medium',
          category: 'coverage',
          message: `Leak detection was inconclusive: ${resourceLeaks.reason}. Run a longer window before citing leak results.`
        });
      }
    }

    if (!data.chaosEnabled) {
      recommendations.push({
        priority: 'high',
        category: 'coverage',
        message: 'No failure injection was performed. Recovery, failover and supervisor behaviour remain unevidenced; run with --chaos to close this gap.'
      });
    } else {
      const stats = this.calculateFailureStatistics(data.failureInjection || []);
      const maxRecovery = (this.config.acceptanceCriteria && this.config.acceptanceCriteria.recoveryTimeMax) || 300000;
      if (stats.skipped > 0) {
        recommendations.push({
          priority: 'high',
          category: 'coverage',
          message: `${stats.skipped} chaos scenario(s) were skipped and remain NOT TESTED; do not cite them as evidence of resilience.`
        });
      }
      if (stats.avgRecoveryTime !== null && stats.avgRecoveryTime > maxRecovery) {
        recommendations.push({
          priority: 'high',
          category: 'resilience',
          message: `Mean measured recovery time is ${(stats.avgRecoveryTime / 1000).toFixed(0)}s, target is < ${(maxRecovery / 1000).toFixed(0)}s`
        });
      }
    }

    return recommendations;
  }

  /**
   * Calculate overall status
   */
  /**
   * Overall status.
   *
   * 'pass' is only reported when every criterion passed AND none was left
   * untested. A run with untested criteria is 'pass_with_gaps', which forces
   * the gaps to be acknowledged rather than absorbed into a green result.
   */
  calculateOverallStatus(data) {
    const criteria = this.generateAcceptanceCriteria(data);
    const failed = criteria.filter(c => c.status === 'fail');
    const passed = criteria.filter(c => c.status === 'pass');
    const notTested = criteria.filter(c => c.status === 'not_tested');

    if (failed.length > 0) return 'fail';
    if (passed.length === 0) return 'incomplete';
    return notTested.length > 0 ? 'pass_with_gaps' : 'pass';
  }

  /**
   * Phase status. A phase with no data is 'not_executed' — previously any
   * non-empty array returned 'pass' regardless of its contents, so a metrics
   * phase full of failures still read as a pass.
   */
  calculatePhaseStatus(data, predicate) {
    if (!data || data.length === 0) return 'not_executed';
    return predicate(data) ? 'pass' : 'fail';
  }

  /**
   * Calculate workload statistics
   */
  calculateWorkloadStatistics(data) {
    const successful = data.filter(d => d.success);
    const failed = data.filter(d => !d.success);

    return {
      total: data.length,
      successful: successful.length,
      failed: failed.length,
      overallSuccessRate: data.length > 0 ? successful.length / data.length : 0,
      avgDuration: successful.length > 0
        ? successful.reduce((sum, d) => sum + d.duration, 0) / successful.length
        : 0
    };
  }

  /**
   * Calculate metrics summary
   */
  /**
   * Metrics summary. Field names track the sample shape produced by
   * OperationalMetrics; the previous implementation read `m.cpu.usage` and
   * `m.memory.usage`, which do not exist on those samples and yielded NaN.
   */
  calculateMetricsSummary(data) {
    if (!data || data.length === 0) return null;

    const windowMs = data[data.length - 1].epochMs - data[0].epochMs;
    const trendPoints = (fn) => data.map((s) => ({ x: s.epochMs - data[0].epochMs, y: fn(s) }));

    return {
      totalSamples: data.length,
      windowMs,
      trendWindowSufficient: windowMs >= OperationalMetrics.MIN_TREND_WINDOW_MS,
      cpu: {
        systemPercent: OperationalMetrics.stats(data.map(m => m.cpu.systemPercent))
      },
      memory: {
        systemUsedPercent: OperationalMetrics.stats(data.map(m => m.memory.systemUsedPercent)),
        harnessHeapUsedBytes: OperationalMetrics.stats(data.map(m => m.memory.harnessHeapUsedBytes)),
        harnessHeapTrendBytesPerHour: OperationalMetrics.trendPerHour(
          trendPoints(m => m.memory.harnessHeapUsedBytes), windowMs
        )
      },
      processCount: OperationalMetrics.stats(data.map(m => m.processCount)),
      harnessHandles: OperationalMetrics.stats(data.map(m => m.harnessHandles)),
      disk: OperationalMetrics.stats(data.map(m => (m.disk ? m.disk.usedPercent : null))),
      dependencies: {
        postgresTcpConnectMs: OperationalMetrics.stats(data.map(m => m.dependencies.postgres.tcpConnectMs)),
        redisTcpConnectMs: OperationalMetrics.stats(data.map(m => m.dependencies.redis.tcpConnectMs))
      }
    };
  }

  /**
   * Resource leak check. Returns `hasLeaks: null` when the window is too short
   * for a trend, so an inconclusive run is not reported as "no leaks".
   */
  checkForResourceLeaks(data) {
    const summary = this.calculateMetricsSummary(data);
    if (!summary) return { hasLeaks: null, reason: 'no metric samples collected' };
    if (!summary.trendWindowSufficient) {
      return {
        hasLeaks: null,
        reason: `sample window ${(summary.windowMs / 60000).toFixed(1)}m is below the ` +
          `${(OperationalMetrics.MIN_TREND_WINDOW_MS / 60000).toFixed(0)}m minimum required for a trend`
      };
    }

    const threshold = (this.config.metrics && this.config.metrics.leakThresholdBytesPerHour) || 5 * 1024 * 1024;
    const trend = summary.memory.harnessHeapTrendBytesPerHour;

    return {
      hasLeaks: typeof trend === 'number' && trend > threshold,
      scope: 'harness process only — service processes are not instrumented',
      details: { harnessHeapTrendBytesPerHour: trend, thresholdBytesPerHour: threshold }
    };
  }

  /**
   * Failure statistics over EXECUTED scenarios only.
   * Skipped scenarios are counted separately and never contribute to a
   * success rate, so a run where nothing could be injected cannot read as
   * 100% success.
   */
  calculateFailureStatistics(data) {
    const all = data || [];
    const executed = all.filter(d => d.executed);
    const passed = executed.filter(d => d.status === 'passed');
    const recoveries = passed.map(d => d.recoveryTime).filter(v => typeof v === 'number');

    return {
      total: all.length,
      executed: executed.length,
      skipped: all.length - executed.length,
      passed: passed.length,
      failed: executed.length - passed.length,
      successRate: executed.length > 0 ? passed.length / executed.length : null,
      avgRecoveryTime: recoveries.length > 0
        ? recoveries.reduce((sum, v) => sum + v, 0) / recoveries.length
        : null,
      dataIntegrityRate: null,
      dataIntegrityNote: 'not verified by this harness'
    };
  }

  /**
   * Identify issues
   */
  identifyIssues(data) {
    const issues = [];

    // Add issue identification logic here
    if (data.workloadExecution) {
      const failed = data.workloadExecution.filter(d => !d.success);
      if (failed.length > 0) {
        issues.push({
          severity: 'high',
          category: 'workload',
          message: `${failed.length} workload executions failed`
        });
      }
    }

    return issues;
  }

  /**
   * Get version
   */
  getVersion() {
    try {
      return require('../../package.json').version;
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Get branch
   */
  getBranch() {
    try {
      const { execSync } = require('child_process');
      return execSync('git branch --show-current', { encoding: 'utf8' }).trim();
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Get commit
   */
  getCommit() {
    try {
      const { execSync } = require('child_process');
      return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Save report to file
   */
  saveReport(report, filename) {
    // Anchored to the repo root so report location does not depend on cwd.
    const reportsDir = path.join(__dirname, '..', '..', 'reports', 'qualification');
    
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const reportPath = path.join(reportsDir, filename);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    console.log(`[ReportGenerator] Report saved: ${reportPath}`);
    return reportPath;
  }
}

module.exports = ReportGenerator;
