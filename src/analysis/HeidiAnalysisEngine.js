/**
 * HeidiAnalysisEngine - Analyzes telemetry to identify patterns, issues, and capabilities
 *
 * Methods:
 *   - analyzePatterns() — Identify behavioral patterns
 *   - analyzeRootCauses() — Find failure causes
 *   - assessCapabilities() — Evaluate strengths/weaknesses
 *   - detectAnomalies() — Find outliers and behavioral changes
 *   - analyzeTrends() — Analyze long-term trends
 */

const { createClient } = require('@supabase/supabase-js');

class HeidiAnalysisEngine {
  constructor(supabaseUrl, supabaseKey) {
    this.supabaseUrl = supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL;
    this.supabaseKey = supabaseKey || process.env.SUPABASE_SERVICE_ROLE_KEY;
    this.supabase = createClient(this.supabaseUrl, this.supabaseKey);
  }

  /**
   * Run comprehensive analysis on telemetry
   */
  async runComprehensiveAnalysis(timePeriodHours = 24) {
    const results = {
      timestamp: new Date().toISOString(),
      timePeriodHours,
      patterns: null,
      rootCauses: null,
      capabilities: null,
      anomalies: null,
      trends: null,
      overallHealthScore: 0,
    };

    try {
      const periodEnd = new Date();
      const periodStart = new Date(periodEnd.getTime() - timePeriodHours * 3600000);

      // Fetch telemetry for this period
      const telemetry = await this.fetchTelemetry(periodStart, periodEnd);
      const modulePerf = await this.fetchModulePerformance(periodStart, periodEnd);

      if (!telemetry || telemetry.length === 0) {
        return { ...results, error: 'No telemetry data available for analysis' };
      }

      // Run analyses in parallel
      const [patterns, rootCauses, capabilities, anomalies, trends] = await Promise.all([
        this.analyzePatterns(telemetry, modulePerf),
        this.analyzeRootCauses(telemetry),
        this.assessCapabilities(modulePerf),
        this.detectAnomalies(telemetry, modulePerf),
        this.analyzeTrends(modulePerf, 7), // 7-day trend
      ]);

      results.patterns = patterns;
      results.rootCauses = rootCauses;
      results.capabilities = capabilities;
      results.anomalies = anomalies;
      results.trends = trends;
      results.overallHealthScore = this.calculateHealthScore(patterns, rootCauses, capabilities, anomalies);

      // Save comprehensive analysis result
      await this.saveAnalysisResult('comprehensive', results);

      return results;
    } catch (error) {
      console.error('[AnalysisEngine] Comprehensive analysis error:', error.message);
      return { ...results, error: error.message };
    }
  }

  /**
   * PATTERN RECOGNITION - Identify behavioral patterns
   */
  async analyzePatterns(telemetry, modulePerf) {
    const patterns = {
      successPatterns: [],
      failurePatterns: [],
      performancePatterns: [],
    };

    try {
      // Success patterns: what task types succeed most often?
      const successByType = this.groupByMetric(telemetry, 'tags.task_type');
      for (const [taskType, events] of Object.entries(successByType)) {
        const successes = events.filter(e => e.tags?.success === 'true').length;
        const successRate = successes / events.length;

        if (successRate > 0.85) {
          patterns.successPatterns.push({
            pattern: `high_success_on_${taskType}`,
            taskType,
            successRate: (successRate * 100).toFixed(1),
            occurrences: events.length,
            confidence: Math.min(100, successRate * 100 + 20),
          });
        }
      }

      // Failure patterns: what causes failures?
      const failureEvents = telemetry.filter(e => e.tags?.success === 'false');
      if (failureEvents.length > 0) {
        const failuresByType = this.groupByMetric(failureEvents, 'tags.task_type');
        for (const [taskType, events] of Object.entries(failuresByType)) {
          if (events.length >= 3) { // At least 3 occurrences
            patterns.failurePatterns.push({
              pattern: `repeated_failures_on_${taskType}`,
              taskType,
              count: events.length,
              confidence: Math.min(100, (events.length / failureEvents.length) * 100 + 30),
            });
          }
        }
      }

      // Performance patterns: when is performance degraded?
      const slowEvents = telemetry.filter(e => e.value > 500); // > 500ms
      if (slowEvents.length > 0) {
        const slowByMetric = this.groupByMetric(slowEvents, 'metric_name');
        for (const [metricName, events] of Object.entries(slowByMetric)) {
          patterns.performancePatterns.push({
            pattern: `high_latency_${metricName}`,
            metricName,
            avgDuration: (events.reduce((sum, e) => sum + e.value, 0) / events.length).toFixed(0),
            occurrences: events.length,
            confidence: Math.min(100, (events.length / telemetry.length) * 100 + 40),
          });
        }
      }

      return patterns;
    } catch (error) {
      console.error('[AnalysisEngine] Pattern analysis error:', error.message);
      return patterns;
    }
  }

  /**
   * ROOT CAUSE ANALYSIS - Identify failure causes
   */
  async analyzeRootCauses(telemetry) {
    const causes = [];

    try {
      const failureEvents = telemetry.filter(e => e.metric_type === 'error' || e.tags?.success === 'false');

      if (failureEvents.length === 0) return causes;

      // Group failures by metric/error type
      const failuresByType = this.groupByMetric(failureEvents, 'metric_name');

      for (const [failureType, events] of Object.entries(failuresByType)) {
        // Extract module from metric name
        const module = this.extractModuleName(failureType);

        // Analyze correlation with system load
        const avgLoad = events.reduce((sum, e) => sum + (e.metadata?.system_load || 0), 0) / events.length;
        const isCorrelatedWithLoad = avgLoad > 0.7;

        // Analyze temporal pattern (time of day)
        const timeOfDay = this.analyzeTemporal(events);

        causes.push({
          cause: `${module}_failure`,
          module,
          description: `${failureType} failures in ${module}`,
          occurrenceCount: events.length,
          avgImpactOnSuccessRate: (events.length / Math.max(1, events.length + 10) * 100).toFixed(1),
          suggestedMitigations: [
            isCorrelatedWithLoad ? 'Reduce concurrent operations during high load' : null,
            timeOfDay ? `Consider scheduling checks during ${timeOfDay.quietestHour}:00` : null,
            'Add exponential backoff retry logic',
            'Increase timeout thresholds',
          ].filter(Boolean),
          priority: events.length > 5 ? 'high' : 'medium',
          confidence: Math.min(100, (events.length / Math.max(1, failureEvents.length)) * 100 + 20),
        });
      }

      return causes.slice(0, 10); // Return top 10
    } catch (error) {
      console.error('[AnalysisEngine] Root cause analysis error:', error.message);
      return causes;
    }
  }

  /**
   * CAPABILITY ASSESSMENT - Evaluate strengths/weaknesses
   */
  async assessCapabilities(modulePerf) {
    const assessment = {
      strengths: [],
      weaknesses: [],
      neutral: [],
    };

    try {
      if (!modulePerf || modulePerf.length === 0) return assessment;

      for (const module of modulePerf) {
        const score = this.calculateModuleScore(module);

        if (score >= 80) {
          assessment.strengths.push({
            capability: module.module_name,
            score,
            metrics: {
              successRate: ((1 - module.error_rate) * 100).toFixed(1),
              avgDuration: module.avg_duration_ms.toFixed(0),
              qualityScore: module.quality_score.toFixed(1),
            },
            evidence: [
              `${module.successes} successes out of ${module.invocations} invocations`,
              `Error rate: ${(module.error_rate * 100).toFixed(1)}%`,
              `Avg latency: ${module.avg_duration_ms.toFixed(0)}ms`,
            ],
          });
        } else if (score < 60) {
          assessment.weaknesses.push({
            capability: module.module_name,
            score,
            metrics: {
              successRate: ((1 - module.error_rate) * 100).toFixed(1),
              avgDuration: module.avg_duration_ms.toFixed(0),
              qualityScore: module.quality_score.toFixed(1),
            },
            improvements: [
              module.error_rate > 0.2 ? 'Reduce error rate through improved error handling' : null,
              module.avg_duration_ms > 1000 ? 'Optimize performance to reduce latency' : null,
              'Add better observability and logging',
            ].filter(Boolean),
          });
        } else {
          assessment.neutral.push({
            capability: module.module_name,
            score,
            metrics: {
              successRate: ((1 - module.error_rate) * 100).toFixed(1),
              avgDuration: module.avg_duration_ms.toFixed(0),
              qualityScore: module.quality_score.toFixed(1),
            },
          });
        }
      }

      return assessment;
    } catch (error) {
      console.error('[AnalysisEngine] Capability assessment error:', error.message);
      return assessment;
    }
  }

  /**
   * ANOMALY DETECTION - Find outliers and behavioral changes
   */
  async detectAnomalies(telemetry, modulePerf) {
    const anomalies = [];

    try {
      // Statistical outliers (values > 2 sigma from mean)
      const metricGroups = this.groupByMetric(telemetry, 'metric_name');

      for (const [metricName, events] of Object.entries(metricGroups)) {
        if (events.length < 5) continue; // Need at least 5 samples

        const values = events.map(e => e.value).sort((a, b) => a - b);
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
        const sigma = Math.sqrt(variance);

        // Find outliers
        const outliers = values.filter(v => Math.abs(v - mean) > 2 * sigma);
        if (outliers.length > 0) {
          anomalies.push({
            metric: metricName,
            type: 'statistical_outlier',
            baselineValue: mean.toFixed(0),
            anomalousValue: Math.max(...outliers).toFixed(0),
            deviationSigma: (Math.max(...outliers - mean) / sigma).toFixed(1),
            severity: outliers.length > 2 ? 'warning' : 'info',
            occurrenceCount: outliers.length,
            description: `Found ${outliers.length} outliers > 2σ from mean`,
          });
        }
      }

      // Performance regression detection
      if (modulePerf && modulePerf.length > 0) {
        const recentPerf = modulePerf.slice(0, 5);
        const olderPerf = modulePerf.slice(-5);

        if (recentPerf.length > 0 && olderPerf.length > 0) {
          const recentAvgError = recentPerf.reduce((sum, m) => sum + m.error_rate, 0) / recentPerf.length;
          const olderAvgError = olderPerf.reduce((sum, m) => sum + m.error_rate, 0) / olderPerf.length;

          if (recentAvgError > olderAvgError * 1.2) { // 20% regression
            anomalies.push({
              type: 'performance_regression',
              metric: 'error_rate',
              baselineValue: (olderAvgError * 100).toFixed(1),
              anomalousValue: (recentAvgError * 100).toFixed(1),
              deviation_percent: (((recentAvgError - olderAvgError) / olderAvgError) * 100).toFixed(1),
              severity: 'warning',
              description: `Error rate increased ${((recentAvgError - olderAvgError) / olderAvgError * 100).toFixed(1)}%`,
            });
          }
        }
      }

      return anomalies;
    } catch (error) {
      console.error('[AnalysisEngine] Anomaly detection error:', error.message);
      return anomalies;
    }
  }

  /**
   * TREND ANALYSIS - Analyze long-term trends
   */
  async analyzeTrends(modulePerf, days = 7) {
    const trends = [];

    try {
      if (!modulePerf || modulePerf.length < 2) return trends;

      // Sort by date
      const sorted = modulePerf.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

      // Split into old and new halves
      const midpoint = Math.floor(sorted.length / 2);
      const oldPeriod = sorted.slice(0, midpoint);
      const newPeriod = sorted.slice(midpoint);

      if (oldPeriod.length === 0 || newPeriod.length === 0) return trends;

      // Calculate average quality score trend
      const oldQuality = oldPeriod.reduce((sum, m) => sum + m.quality_score, 0) / oldPeriod.length;
      const newQuality = newPeriod.reduce((sum, m) => sum + m.quality_score, 0) / newPeriod.length;

      const qualityChange = newQuality - oldQuality;
      trends.push({
        metricName: 'overall_quality_score',
        timePeriod: `${days}d`,
        trendDirection: qualityChange > 0 ? 'improving' : qualityChange < 0 ? 'degrading' : 'stable',
        startValue: oldQuality.toFixed(1),
        endValue: newQuality.toFixed(1),
        changePercent: ((qualityChange / oldQuality) * 100).toFixed(1),
        velocity: (qualityChange / days).toFixed(3),
        confidence: Math.min(100, (Math.abs(qualityChange) / oldQuality) * 100 + 50),
        implication: qualityChange > 0 ? 'System is improving' : 'System performance degrading',
      });

      // Error rate trend
      const oldErrorRate = oldPeriod.reduce((sum, m) => sum + m.error_rate, 0) / oldPeriod.length;
      const newErrorRate = newPeriod.reduce((sum, m) => sum + m.error_rate, 0) / newPeriod.length;

      const errorChange = newErrorRate - oldErrorRate;
      trends.push({
        metricName: 'error_rate',
        timePeriod: `${days}d`,
        trendDirection: errorChange < 0 ? 'improving' : errorChange > 0 ? 'degrading' : 'stable',
        startValue: (oldErrorRate * 100).toFixed(1),
        endValue: (newErrorRate * 100).toFixed(1),
        changePercent: ((errorChange / Math.max(0.01, oldErrorRate)) * 100).toFixed(1),
        velocity: ((errorChange / days) * 100).toFixed(3),
        confidence: Math.min(100, (Math.abs(errorChange) * 100) + 50),
        implication: errorChange < 0 ? 'Error rate improving' : 'Error rate increasing',
      });

      return trends;
    } catch (error) {
      console.error('[AnalysisEngine] Trend analysis error:', error.message);
      return trends;
    }
  }

  /**
   * HELPER METHODS
   */

  async fetchTelemetry(startTime, endTime) {
    try {
      const { data, error } = await this.supabase
        .from('heidi_telemetry')
        .select('*')
        .gte('created_at', startTime.toISOString())
        .lte('created_at', endTime.toISOString());

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('[AnalysisEngine] Fetch telemetry error:', error.message);
      return [];
    }
  }

  async fetchModulePerformance(startTime, endTime) {
    try {
      const { data, error } = await this.supabase
        .from('heidi_module_performance')
        .select('*')
        .gte('created_at', startTime.toISOString())
        .lte('created_at', endTime.toISOString());

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('[AnalysisEngine] Fetch module performance error:', error.message);
      return [];
    }
  }

  async saveAnalysisResult(analysisType, results) {
    try {
      await this.supabase
        .from('heidi_analysis_results')
        .insert({
          analysis_type: analysisType,
          findings: results,
          confidence_score: Math.min(100, results.patterns?.length * 10 + 50),
          priority: results.anomalies?.some(a => a.severity === 'critical') ? 'critical' : 'medium',
          summary: `${results.patterns?.successPatterns?.length || 0} success patterns, ${results.rootCauses?.length || 0} root causes, health score: ${results.overallHealthScore}`,
        });
    } catch (error) {
      console.error('[AnalysisEngine] Save analysis error:', error.message);
    }
  }

  groupByMetric(events, key) {
    return events.reduce((acc, event) => {
      const value = key.split('.').reduce((obj, k) => obj?.[k], event) || 'unknown';
      if (!acc[value]) acc[value] = [];
      acc[value].push(event);
      return acc;
    }, {});
  }

  extractModuleName(metricName) {
    const match = metricName.match(/heidi_(\w+)_/);
    return match ? match[1].toUpperCase() : 'UNKNOWN';
  }

  analyzeTemporal(events) {
    if (!events || events.length === 0) return null;

    const hourCounts = {};
    events.forEach(e => {
      const hour = new Date(e.created_at).getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });

    const quietestHour = Object.entries(hourCounts).sort((a, b) => a[1] - b[1])[0]?.[0];
    return quietestHour ? { quietestHour } : null;
  }

  calculateModuleScore(module) {
    if (!module) return 0;
    const successRate = (1 - (module.error_rate || 0)) * 100;
    const latencyScore = Math.max(0, 100 - (module.avg_duration_ms || 0) / 10);
    const qualityScore = module.quality_score || 0;

    return (successRate * 0.4 + latencyScore * 0.3 + qualityScore * 0.3) / 100;
  }

  calculateHealthScore(patterns, rootCauses, capabilities, anomalies) {
    let score = 100;

    // Deduct for issues
    if (rootCauses && rootCauses.length > 0) score -= rootCauses.length * 3;
    if (anomalies && anomalies.some(a => a.severity === 'critical')) score -= 10;
    if (capabilities && capabilities.weaknesses && capabilities.weaknesses.length > 2) score -= 5;

    // Add for strengths
    if (patterns && patterns.successPatterns && patterns.successPatterns.length > 2) score += 5;

    return Math.max(0, Math.min(100, score));
  }
}

module.exports = HeidiAnalysisEngine;
