/**
 * MetricsCollector - Unified telemetry collection for HEIDI self-improvement
 *
 * Usage:
 *   const metrics = new MetricsCollector();
 *   metrics.recordMetric('loop_cycle', 'heidi_core_loop_duration_ms', 125, {agent: 'Hyve'});
 *   await metrics.flush(); // Send to Supabase
 */

const { createClient } = require('@supabase/supabase-js');

class MetricsCollector {
  constructor(supabaseUrl, supabaseKey) {
    this.supabaseUrl = supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL;
    this.supabaseKey = supabaseKey || process.env.SUPABASE_SERVICE_ROLE_KEY;
    this.metrics = [];
    this.sessionId = this.generateSessionId();
    this.supabase = createClient(this.supabaseUrl, this.supabaseKey);
    this.modulePerformance = new Map(); // Track per-module stats
  }

  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Record a single metric
   * @param {string} metricType - 'loop_cycle', 'decision', 'action', 'memory', 'error', 'performance'
   * @param {string} metricName - e.g., 'heidi_core_loop_duration_ms'
   * @param {number} value - numeric value
   * @param {object} tags - metadata tags {agent, module, phase}
   * @param {object} metadata - additional context
   */
  recordMetric(metricType, metricName, value, tags = {}, metadata = {}) {
    this.metrics.push({
      metric_type: metricType,
      metric_name: metricName,
      value,
      tags,
      metadata,
      session_id: this.sessionId,
      created_at: new Date().toISOString(),
    });
  }

  /**
   * Track module invocation (success/failure/duration)
   * @param {string} moduleName - e.g., 'HeidiCoreLoop', 'HeidiOrchestrator'
   * @param {boolean} success - whether invocation succeeded
   * @param {number} durationMs - execution time
   * @param {object} extra - additional data
   */
  trackModuleCall(moduleName, success, durationMs, extra = {}) {
    const key = moduleName;
    if (!this.modulePerformance.has(key)) {
      this.modulePerformance.set(key, {
        invocations: 0,
        successes: 0,
        failures: 0,
        durations: [],
      });
    }

    const stats = this.modulePerformance.get(key);
    stats.invocations++;
    if (success) {
      stats.successes++;
    } else {
      stats.failures++;
    }
    stats.durations.push(durationMs);

    this.recordMetric(
      'performance',
      `${moduleName}_invocation`,
      durationMs,
      { module: moduleName, success: success.toString() },
      extra
    );
  }

  /**
   * Get aggregated stats for a module
   */
  getModuleStats(moduleName) {
    const stats = this.modulePerformance.get(moduleName) || {
      invocations: 0,
      successes: 0,
      failures: 0,
      durations: [],
    };

    const durations = stats.durations;
    const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    const minDuration = durations.length > 0 ? Math.min(...durations) : 0;
    const maxDuration = durations.length > 0 ? Math.max(...durations) : 0;
    const errorRate = stats.invocations > 0 ? stats.failures / stats.invocations : 0;

    return {
      moduleName,
      invocations: stats.invocations,
      successes: stats.successes,
      failures: stats.failures,
      avgDuration,
      minDuration,
      maxDuration,
      errorRate,
      qualityScore: Math.max(0, 100 * (1 - errorRate)), // Simple quality metric
    };
  }

  /**
   * Create snapshot of all metrics and module stats
   */
  createSnapshot(snapshotType = 'manual') {
    const moduleStats = Array.from(this.modulePerformance.keys()).map(moduleName =>
      this.getModuleStats(moduleName)
    );

    return {
      snapshot_type: snapshotType,
      timestamp: new Date().toISOString(),
      metrics_count: this.metrics.length,
      module_stats: moduleStats,
      summary: {
        total_modules: moduleStats.length,
        avg_quality_score: moduleStats.length > 0
          ? moduleStats.reduce((sum, m) => sum + m.qualityScore, 0) / moduleStats.length
          : 0,
        total_invocations: moduleStats.reduce((sum, m) => sum + m.invocations, 0),
        total_errors: moduleStats.reduce((sum, m) => sum + m.failures, 0),
      },
    };
  }

  /**
   * Flush collected metrics to Supabase
   */
  async flush() {
    if (this.metrics.length === 0) {
      return { success: true, written: 0 };
    }

    try {
      const { data, error } = await this.supabase
        .from('heidi_telemetry')
        .insert(this.metrics);

      if (error) {
        console.error('[MetricsCollector] Flush error:', error);
        return { success: false, error: error.message };
      }

      const written = this.metrics.length;
      this.metrics = []; // Clear buffer after successful flush
      return { success: true, written };
    } catch (err) {
      console.error('[MetricsCollector] Flush exception:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Save a metrics snapshot to the database
   */
  async saveSnapshot(snapshotType = 'manual', metrics = null) {
    const snapshot = metrics || this.createSnapshot(snapshotType);

    try {
      const { error } = await this.supabase
        .from('heidi_metrics_snapshots')
        .insert({
          snapshot_type: snapshotType,
          metrics: snapshot.module_stats,
          summary: snapshot.summary,
        });

      if (error) {
        console.error('[MetricsCollector] Snapshot save error:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err) {
      console.error('[MetricsCollector] Snapshot save exception:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Record a detected drift/anomaly
   */
  async recordDrift(driftType, metricName, baselineValue, currentValue, severity = 'info') {
    const deviationPercent = baselineValue > 0
      ? ((currentValue - baselineValue) / baselineValue) * 100
      : 0;

    try {
      const { error } = await this.supabase
        .from('heidi_drift_detection')
        .insert({
          drift_type: driftType,
          metric_name: metricName,
          baseline_value: baselineValue,
          current_value: currentValue,
          deviation_percent: deviationPercent,
          severity,
          description: `${metricName}: ${baselineValue} → ${currentValue}`,
        });

      if (error) {
        console.error('[MetricsCollector] Drift record error:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err) {
      console.error('[MetricsCollector] Drift record exception:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Record module performance snapshot
   */
  async recordModulePerformance(moduleName) {
    const stats = this.getModuleStats(moduleName);

    try {
      const { error } = await this.supabase
        .from('heidi_module_performance')
        .insert({
          module_name: moduleName,
          metric_period_start: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
          metric_period_end: new Date().toISOString(),
          invocations: stats.invocations,
          successes: stats.successes,
          failures: stats.failures,
          avg_duration_ms: stats.avgDuration,
          min_duration_ms: stats.minDuration,
          max_duration_ms: stats.maxDuration,
          error_rate: stats.errorRate,
          quality_score: stats.qualityScore,
        });

      if (error) {
        console.error('[MetricsCollector] Module performance record error:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err) {
      console.error('[MetricsCollector] Module performance record exception:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Get recent metrics (for dashboard)
   */
  async getRecentMetrics(limit = 100, metricType = null) {
    try {
      let query = this.supabase
        .from('heidi_telemetry')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (metricType) {
        query = query.eq('metric_type', metricType);
      }

      const { data, error } = await query;

      if (error) {
        console.error('[MetricsCollector] Get recent metrics error:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data };
    } catch (err) {
      console.error('[MetricsCollector] Get recent metrics exception:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Get module performance summary
   */
  async getModuleSummary(moduleName) {
    try {
      const { data, error } = await this.supabase
        .from('heidi_module_performance')
        .select('*')
        .eq('module_name', moduleName)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) {
        console.error('[MetricsCollector] Get module summary error:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data };
    } catch (err) {
      console.error('[MetricsCollector] Get module summary exception:', err);
      return { success: false, error: err.message };
    }
  }
}

module.exports = MetricsCollector;
