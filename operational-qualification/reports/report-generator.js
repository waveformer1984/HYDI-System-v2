/**
 * Report Generator
 * Generates qualification reports from collected data
 */

const fs = require('fs');
const path = require('path');

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
        duration: data.duration
      },
      summary: this.generateSummary(data),
      stackLifecycle: this.generateStackLifecycleReport(data.stackLifecycle),
      workloadExecution: this.generateWorkloadReport(data.workloadExecution),
      metrics: this.generateMetricsReport(data.metrics),
      failureInjection: this.generateFailureReport(data.failureInjection),
      acceptanceCriteria: this.generateAcceptanceCriteria(data),
      recommendations: this.generateRecommendations(data)
    };

    return report;
  }

  /**
   * Generate summary
   */
  generateSummary(data) {
    const overallStatus = this.calculateOverallStatus(data);

    return {
      status: overallStatus,
      phases: {
        stackLifecycle: data.stackLifecycle ? this.calculatePhaseStatus(data.stackLifecycle) : 'not_executed',
        workloadExecution: data.workloadExecution ? this.calculatePhaseStatus(data.workloadExecution) : 'not_executed',
        metrics: data.metrics ? this.calculatePhaseStatus(data.metrics) : 'not_executed',
        failureInjection: data.failureInjection ? this.calculatePhaseStatus(data.failureInjection) : 'not_executed'
      },
      overallDuration: data.duration,
      issues: this.identifyIssues(data)
    };
  }

  /**
   * Generate stack lifecycle report
   */
  generateStackLifecycleReport(data) {
    if (!data) return null;

    return {
      startTime: data.startTime,
      shutdownTime: data.shutdownTime,
      uptimeMs: data.uptimeMs,
      services: data.services,
      status: data.status,
      errors: data.errors || []
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
    if (!data || data.length === 0) return null;

    const summary = this.calculateMetricsSummary(data);
    const resourceLeaks = this.checkForResourceLeaks(data);

    return {
      totalSamples: data.length,
      durationMs: data[data.length - 1].timestamp - data[0].timestamp,
      summary,
      resourceLeaks
    };
  }

  /**
   * Generate failure report
   */
  generateFailureReport(data) {
    if (!data) return null;

    const statistics = this.calculateFailureStatistics(data);

    return {
      totalScenarios: data.length,
      statistics,
      details: data.map(d => ({
        failure: d.failure,
        timestamp: d.timestamp,
        success: d.success,
        recoveryTime: d.recoveryTime,
        dataIntegrity: d.dataIntegrity
      }))
    };
  }

  /**
   * Generate acceptance criteria
   */
  generateAcceptanceCriteria(data) {
    const criteria = [];

    // Stack lifecycle criteria
    if (data.stackLifecycle) {
      criteria.push({
        name: 'Stack starts successfully',
        status: data.stackLifecycle.status === 'started' ? 'pass' : 'fail'
      });
      criteria.push({
        name: 'Stack stops gracefully',
        status: data.stackLifecycle.status === 'stopped' ? 'pass' : 'fail'
      });
    }

    // Workload execution criteria
    if (data.workloadExecution) {
      const stats = this.calculateWorkloadStatistics(data.workloadExecution);
      criteria.push({
        name: 'Workload success rate >= 99%',
        status: stats.overallSuccessRate >= 0.99 ? 'pass' : 'fail'
      });
    }

    // Metrics criteria
    if (data.metrics && data.metrics.length > 0) {
      const resourceLeaks = this.checkForResourceLeaks(data.metrics);
      criteria.push({
        name: 'No resource leaks detected',
        status: !resourceLeaks.hasLeaks ? 'pass' : 'fail'
      });
    }

    // Failure injection criteria
    if (data.failureInjection) {
      const stats = this.calculateFailureStatistics(data.failureInjection);
      criteria.push({
        name: 'All failure scenarios recover',
        status: stats.overallSuccessRate === 1 ? 'pass' : 'fail'
      });
      criteria.push({
        name: 'Recovery time < 5 minutes',
        status: stats.avgRecoveryTime < 300000 ? 'pass' : 'fail'
      });
      criteria.push({
        name: 'Data integrity maintained',
        status: stats.dataIntegrityRate === 1 ? 'pass' : 'fail'
      });
    }

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
      if (resourceLeaks.hasLeaks) {
        recommendations.push({
          priority: 'critical',
          category: 'resources',
          message: 'Resource leak detected, investigate memory and CPU trends'
        });
      }
    }

    if (data.failureInjection) {
      const stats = this.calculateFailureStatistics(data.failureInjection);
      if (stats.avgRecoveryTime > 300000) {
        recommendations.push({
          priority: 'high',
          category: 'resilience',
          message: `Average recovery time is ${(stats.avgRecoveryTime / 1000).toFixed(0)}s, target is < 300s`
        });
      }
    }

    return recommendations;
  }

  /**
   * Calculate overall status
   */
  calculateOverallStatus(data) {
    const criteria = this.generateAcceptanceCriteria(data);
    const failed = criteria.filter(c => c.status === 'fail');
    const passed = criteria.filter(c => c.status === 'pass');

    if (failed.length === 0 && passed.length > 0) {
      return 'pass';
    } else if (failed.length > 0) {
      return 'fail';
    } else {
      return 'incomplete';
    }
  }

  /**
   * Calculate phase status
   */
  calculatePhaseStatus(data) {
    if (!data || data.length === 0) return 'incomplete';
    return 'pass';
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
  calculateMetricsSummary(data) {
    const cpuUsages = data.map(m => m.cpu.usage);
    const memoryUsages = data.map(m => m.memory.usage);

    return {
      cpu: {
        min: Math.min(...cpuUsages),
        max: Math.max(...cpuUsages),
        avg: cpuUsages.reduce((a, b) => a + b, 0) / cpuUsages.length,
        trend: this.calculateTrend(cpuUsages)
      },
      memory: {
        min: Math.min(...memoryUsages),
        max: Math.max(...memoryUsages),
        avg: memoryUsages.reduce((a, b) => a + b, 0) / memoryUsages.length,
        trend: this.calculateTrend(memoryUsages)
      }
    };
  }

  /**
   * Check for resource leaks
   */
  checkForResourceLeaks(data) {
    const summary = this.calculateMetricsSummary(data);
    const threshold = 5; // 5% increase trend

    const cpuLeak = summary.cpu.trend > threshold;
    const memoryLeak = summary.memory.trend > threshold;

    return {
      hasLeaks: cpuLeak || memoryLeak,
      details: {
        cpu: { hasLeak: cpuLeak, trend: summary.cpu.trend },
        memory: { hasLeak: memoryLeak, trend: summary.memory.trend }
      }
    };
  }

  /**
   * Calculate failure statistics
   */
  calculateFailureStatistics(data) {
    const successful = data.filter(d => d.success);
    const failed = data.filter(d => !d.success);

    return {
      total: data.length,
      successful: successful.length,
      failed: failed.length,
      overallSuccessRate: data.length > 0 ? successful.length / data.length : 0,
      avgRecoveryTime: successful.length > 0
        ? successful.reduce((sum, d) => sum + d.recoveryTime, 0) / successful.length
        : 0,
      dataIntegrityRate: successful.length > 0
        ? successful.filter(d => d.dataIntegrity).length / successful.length
        : 0
    };
  }

  /**
   * Calculate trend
   */
  calculateTrend(values) {
    if (values.length < 2) return 0;

    const firstHalf = values.slice(0, Math.floor(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));

    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    return secondAvg - firstAvg;
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
      const versionFile = path.join(process.cwd(), 'VERSION');
      return fs.readFileSync(versionFile, 'utf8').trim();
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
    const reportsDir = path.join(process.cwd(), 'qualification-reports');
    
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
