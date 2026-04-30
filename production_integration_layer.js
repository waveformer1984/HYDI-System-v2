// PRODUCTION INTEGRATION LAYER - METRICS + LOGGING
// Observability layer for the production idempotency system

class ProductionIntegrationLayer {
  constructor(idempotencyEngine) {
    this.engine = idempotencyEngine;
    this.eventLog = [];
    this.metricsHistory = [];
    this.alertThresholds = {
      idempotency_collisions_per_minute: 10,
      fallback_identity_usage_rate: 0.1, // 10%
      quarantine_rate: 0.05, // 5%
      avg_events_per_causal: 1.1
    };
  }

  // =============================================================================
  // STRUCTURED LOGGING
  // =============================================================================
  
  logEventDecision(decision) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      trace_id: this.generateTraceId(),
      ...decision,
      system_metrics: this.getCurrentMetrics()
    };
    
    this.eventLog.push(logEntry);
    
    // Log to console with structured format
    console.log(`📊 EVENT_DECISION: ${JSON.stringify(logEntry)}`);
    
    // Check for alerts
    this.checkAlerts(logEntry);
    
    // Keep log size manageable
    if (this.eventLog.length > 10000) {
      this.eventLog = this.eventLog.slice(-5000); // Keep last 5000
    }
  }

  generateTraceId() {
    return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // =============================================================================
  // METRICS COLLECTION
  // =============================================================================
  
  getCurrentMetrics() {
    const engineMetrics = this.engine.getMetrics();
    const registryStats = this.engine.getRegistryStats();
    
    return {
      ...engineMetrics,
      ...registryStats,
      timestamp: new Date().toISOString(),
      calculated_metrics: this.calculateDerivedMetrics(engineMetrics, registryStats)
    };
  }

  calculateDerivedMetrics(metrics, stats) {
    const totalEvents = metrics.events_processed_total || 1;
    
    return {
      fallback_identity_usage_rate: metrics.fallback_identity_usage_total / totalEvents,
      quarantine_rate: metrics.quarantine_events_total / totalEvents,
      collision_rate: metrics.idempotency_collisions_total / totalEvents,
      causal_efficiency: stats.causal_registry_size / Math.max(stats.idempotency_registry_size, 1)
    };
  }

  recordMetricsSnapshot() {
    const snapshot = {
      timestamp: new Date().toISOString(),
      metrics: this.getCurrentMetrics()
    };
    
    this.metricsHistory.push(snapshot);
    
    // Keep history manageable
    if (this.metricsHistory.length > 1440) { // 24 hours of minute data
      this.metricsHistory = this.metricsHistory.slice(-720); // Keep last 12 hours
    }
  }

  // =============================================================================
  // ALERTING
  // =============================================================================
  
  checkAlerts(logEntry) {
    const metrics = logEntry.system_metrics;
    const alerts = [];
    
    // Check fallback identity usage rate
    if (metrics.calculated_metrics.fallback_identity_usage_rate > this.alertThresholds.fallback_identity_usage_rate) {
      alerts.push({
        type: 'HIGH_FALLBACK_USAGE',
        severity: 'warning',
        message: `Fallback identity usage rate: ${(metrics.calculated_metrics.fallback_identity_usage_rate * 100).toFixed(2)}%`,
        threshold: `${(this.alertThresholds.fallback_identity_usage_rate * 100)}%`
      });
    }
    
    // Check quarantine rate
    if (metrics.calculated_metrics.quarantine_rate > this.alertThresholds.quarantine_rate) {
      alerts.push({
        type: 'HIGH_QUARANTINE_RATE',
        severity: 'warning',
        message: `Quarantine rate: ${(metrics.calculated_metrics.quarantine_rate * 100).toFixed(2)}%`,
        threshold: `${(this.alertThresholds.quarantine_rate * 100)}%`
      });
    }
    
    // Check average events per causal (should be close to 1)
    if (stats.avg_external_events_per_causal > this.alertThresholds.avg_events_per_causal) {
      alerts.push({
        type: 'IDENTITY_COLLISION_RISK',
        severity: 'critical',
        message: `Average events per causal: ${stats.avg_external_events_per_causal.toFixed(3)}`,
        threshold: this.alertThresholds.avg_events_per_causal
      });
    }
    
    // Log alerts
    alerts.forEach(alert => {
      console.log(`🚨 ALERT: ${alert.type} - ${alert.message}`);
      this.logAlert(alert);
    });
  }

  logAlert(alert) {
    const alertEntry = {
      timestamp: new Date().toISOString(),
      alert_type: alert.type,
      severity: alert.severity,
      message: alert.message,
      threshold: alert.threshold,
      current_metrics: this.getCurrentMetrics()
    };
    
    // In production, this would go to your monitoring system
    console.log(`📋 ALERT_LOG: ${JSON.stringify(alertEntry)}`);
  }

  // =============================================================================
  // HEALTH CHECKS
  // =============================================================================
  
  performHealthCheck() {
    const metrics = this.getCurrentMetrics();
    const health = {
      status: 'healthy',
      checks: {},
      timestamp: new Date().toISOString()
    };
    
    // Check 1: Idempotency registry consistency
    health.checks.idempotency_consistency = {
      status: metrics.idempotency_registry_size === metrics.causal_registry_size ? 'pass' : 'fail',
      message: `Registry sizes: idempotency=${metrics.idempotency_registry_size}, causal=${metrics.causal_registry_size}`
    };
    
    // Check 2: Fallback usage rate
    health.checks.fallback_usage = {
      status: metrics.calculated_metrics.fallback_identity_usage_rate < this.alertThresholds.fallback_identity_usage_rate ? 'pass' : 'warn',
      message: `Fallback rate: ${(metrics.calculated_metrics.fallback_identity_usage_rate * 100).toFixed(2)}%`
    };
    
    // Check 3: Quarantine rate
    health.checks.quarantine_rate = {
      status: metrics.calculated_metrics.quarantine_rate < this.alertThresholds.quarantine_rate ? 'pass' : 'warn',
      message: `Quarantine rate: ${(metrics.calculated_metrics.quarantine_rate * 100).toFixed(2)}%`
    };
    
    // Check 4: Causal efficiency
    health.checks.causal_efficiency = {
      status: metrics.calculated_metrics.causal_efficiency > 0.95 ? 'pass' : 'warn',
      message: `Causal efficiency: ${(metrics.calculated_metrics.causal_efficiency * 100).toFixed(2)}%`
    };
    
    // Overall health status
    const failedChecks = Object.values(health.checks).filter(check => check.status === 'fail');
    const warnChecks = Object.values(health.checks).filter(check => check.status === 'warn');
    
    if (failedChecks.length > 0) {
      health.status = 'unhealthy';
    } else if (warnChecks.length > 0) {
      health.status = 'degraded';
    }
    
    return health;
  }

  // =============================================================================
  // ANALYTICS
  // =============================================================================
  
  getEventAnalytics(timeframeMinutes = 60) {
    const cutoffTime = new Date(Date.now() - timeframeMinutes * 60 * 1000);
    const recentEvents = this.eventLog.filter(event => 
      new Date(event.timestamp) >= cutoffTime
    );
    
    const analytics = {
      timeframe_minutes: timeframeMinutes,
      total_events: recentEvents.length,
      decisions: {},
      providers: {},
      dedupe_reasons: {},
      metrics_trend: this.getMetricsTrend(timeframeMinutes)
    };
    
    // Analyze decisions
    recentEvents.forEach(event => {
      analytics.decisions[event.decision] = (analytics.decisions[event.decision] || 0) + 1;
      
      if (event.provider) {
        analytics.providers[event.provider] = (analytics.providers[event.provider] || 0) + 1;
      }
      
      if (event.dedupe_reason) {
        analytics.dedupe_reasons[event.dedupe_reason] = (analytics.dedupe_reasons[event.dedupe_reason] || 0) + 1;
      }
    });
    
    return analytics;
  }

  getMetricsTrend(timeframeMinutes) {
    const cutoffTime = new Date(Date.now() - timeframeMinutes * 60 * 1000);
    const recentSnapshots = this.metricsHistory.filter(snapshot => 
      new Date(snapshot.timestamp) >= cutoffTime
    );
    
    if (recentSnapshots.length < 2) {
      return { trend: 'insufficient_data' };
    }
    
    const first = recentSnapshots[0].metrics;
    const last = recentSnapshots[recentSnapshots.length - 1].metrics;
    
    return {
      events_processed_trend: last.events_processed_total - first.events_processed_total,
      fallback_usage_trend: last.calculated_metrics.fallback_identity_usage_rate - first.calculated_metrics.fallback_identity_usage_rate,
      quarantine_rate_trend: last.calculated_metrics.quarantine_rate - first.calculated_metrics.quarantine_rate,
      collision_rate_trend: last.calculated_metrics.collision_rate - first.calculated_metrics.collision_rate
    };
  }

  // =============================================================================
  // REPORTING
  // =============================================================================
  
  generateSystemReport() {
    const health = this.performHealthCheck();
    const analytics = this.getEventAnalytics();
    const currentMetrics = this.getCurrentMetrics();
    
    const report = {
      timestamp: new Date().toISOString(),
      system_health: health,
      current_metrics: currentMetrics,
      recent_analytics: analytics,
      recommendations: this.generateRecommendations(health, currentMetrics)
    };
    
    return report;
  }

  generateRecommendations(health, metrics) {
    const recommendations = [];
    
    if (health.checks.fallback_usage.status === 'warn') {
      recommendations.push({
        priority: 'high',
        type: 'infrastructure',
        message: 'High fallback identity usage detected. Review webhook payload formats to ensure external_event_id is always present.',
        action: 'Contact webhook providers to standardize event ID formats'
      });
    }
    
    if (health.checks.quarantine_rate.status === 'warn') {
      recommendations.push({
        priority: 'medium',
        type: 'data_quality',
        message: 'High quarantine rate detected. Review payload validation rules.',
        action: 'Implement pre-validation for common payload format issues'
      });
    }
    
    if (metrics.calculated_metrics.causal_efficiency < 0.95) {
      recommendations.push({
        priority: 'critical',
        type: 'identity_collision',
        message: 'Low causal efficiency indicates potential identity collisions.',
        action: 'Investigate idempotency key generation and collision detection logic'
      });
    }
    
    if (recommendations.length === 0) {
      recommendations.push({
        priority: 'info',
        type: 'operational',
        message: 'System operating within normal parameters.',
        action: 'Continue monitoring and maintain current configuration'
      });
    }
    
    return recommendations;
  }

  // =============================================================================
  // EXPORTS
  // =============================================================================
  
  exportMetrics(format = 'json') {
    const data = {
      timestamp: new Date().toISOString(),
      current_metrics: this.getCurrentMetrics(),
      health_check: this.performHealthCheck(),
      analytics: this.getEventAnalytics()
    };
    
    if (format === 'json') {
      return JSON.stringify(data, null, 2);
    }
    
    return data;
  }

  exportEventLog(timeframeMinutes = 60) {
    const cutoffTime = new Date(Date.now() - timeframeMinutes * 60 * 1000);
    const recentEvents = this.eventLog.filter(event => 
      new Date(event.timestamp) >= cutoffTime
    );
    
    return recentEvents;
  }
}

module.exports = ProductionIntegrationLayer;
